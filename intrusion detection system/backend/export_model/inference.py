"""Standalone inference for the zero-day flow anomaly detector (no notebook state needed).

    from inference import ZeroDayDetector
    det = ZeroDayDetector("export_model")
    out = det.score(pd.read_csv("flows.csv"))      # CICFlowMeter-style raw feature columns
CLI: python inference.py flows.csv alerts.csv
"""
import json, sys
from pathlib import Path
import numpy as np, pandas as pd, torch, torch.nn as nn, joblib


class FlowSSL(nn.Module):
    def __init__(self, n_feat, d=64, heads=4, layers=3, ff=4, drop=0.05):
        super().__init__()
        self.n_feat, self.d = n_feat, d
        self.w = nn.Parameter(torch.randn(n_feat, d) * 0.1)
        self.b = nn.Parameter(torch.zeros(n_feat, d))
        self.mask_tok = nn.Parameter(torch.randn(n_feat, d) * 0.1)
        self.cls = nn.Parameter(torch.randn(1, 1, d) * 0.1)
        layer = nn.TransformerEncoderLayer(d, heads, d * ff, drop, activation="gelu", batch_first=True, norm_first=True)
        self.enc = nn.TransformerEncoder(layer, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(d)
        self.dec_mlp = nn.Sequential(nn.Linear(d, d), nn.GELU())
        self.dec_w = nn.Parameter(torch.randn(n_feat, d) * 0.1)
        self.dec_b = nn.Parameter(torch.zeros(n_feat))
        self.proj = nn.Sequential(nn.Linear(d, d), nn.GELU(), nn.Linear(d, 64))

    def tokens(self, x, mask=None):
        t = x.unsqueeze(-1) * self.w + self.b
        if mask is not None:
            t = torch.where(mask.unsqueeze(-1), self.mask_tok.unsqueeze(0).expand_as(t), t)
        return t

    def encode(self, x, mask=None):
        t = torch.cat([self.cls.expand(x.size(0), -1, -1), self.tokens(x, mask)], 1)
        return self.norm(self.enc(t))

    def reconstruct(self, x, mask):
        h = self.dec_mlp(self.encode(x, mask)[:, 1:])
        return (h * self.dec_w).sum(-1) + self.dec_b

    def embed(self, x):
        h = self.encode(x)
        return torch.cat([h[:, 0], h[:, 1:].mean(1)], 1)


def _lg(a):
    return np.log(np.maximum(a, 0) + 1e-8)


class ZeroDayDetector:
    def __init__(self, artifact_dir, device=None):
        a = Path(artifact_dir)
        self.meta = json.load(open(a / "meta.json"))
        self.dev = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.feat_cols = self.meta["feat_cols"]; self.clip = self.meta["clip"]; self.k = self.meta["knn_k"]
        self.sel = self.meta["selected"]["scorer"]
        self.model = FlowSSL(**self.meta["model"]).to(self.dev)
        self.model.load_state_dict(torch.load(a / "flow_ssl_weights.pt", map_location=self.dev))
        self.model.eval()
        self.d = self.meta["model"]["d"]
        self.sl = {"cls": slice(0, self.d), "mean": slice(self.d, 2 * self.d), "both": slice(0, 2 * self.d)}
        p = np.load(a / "preproc.npz"); self.mu, self.sd = p["mu"], p["sd"]
        s = np.load(a / "scorers.npz")
        t = lambda x: torch.from_numpy(x).float().to(self.dev)
        self.ref = t(s["ref"]); self.groups = torch.from_numpy(s["groups"]).bool().to(self.dev)
        self.bank = t(s["knn_bank"]); self.knn_mu = t(s["knn_mu"]); self.knn_sd = t(s["knn_sd"])
        self.mah_mu = s["mah_mu"]; self.mah_prec = s["mah_prec"]
        self.iso = joblib.load(a / "isolation_forest.joblib")
        cp = a / "calibration.json"
        self.calib = json.load(open(cp)) if cp.exists() else None

    # ---------- preprocessing: raw CICFlowMeter-style columns -> model input ----------
    def preprocess(self, df):
        df = df.copy(); df.columns = [str(c).strip() for c in df.columns]
        missing = [c for c in self.feat_cols if c not in df.columns]
        if missing:
            raise ValueError(f"Missing {len(missing)} required columns, e.g. {missing[:5]}")
        X = df[self.feat_cols].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=np.float64)
        X = np.nan_to_num(X, nan=0.0, posinf=1e12, neginf=-1e12)
        X = np.sign(X) * np.log1p(np.abs(X))
        return np.clip((X - self.mu) / self.sd, -self.clip, self.clip).astype(np.float32)

    # ---------- raw SSL scores on preprocessed input ----------
    @torch.no_grad()
    def raw_scores(self, Xp, bs=512):
        names = ["Recon", "ReconNorm", "ReconTop8", "Mahal", "kNN-cls", "kNN-mean", "kNN-both"]
        out = {n: [] for n in names}; norms = []
        for i in range(0, len(Xp), bs):
            xb = torch.from_numpy(Xp[i:i + bs]).float().to(self.dev)
            err = torch.zeros_like(xb)
            for g in self.groups:
                m = g.unsqueeze(0).expand(len(xb), -1)
                err += ((self.model.reconstruct(xb, m) - xb) ** 2) * m
            norm = err / self.ref
            emb = self.model.embed(xb)
            q = (emb - self.knn_mu) / self.knn_sd
            out["Recon"].append(err.mean(1).cpu().numpy())
            out["ReconNorm"].append(norm.mean(1).cpu().numpy())
            out["ReconTop8"].append(norm.topk(8, dim=1).values.mean(1).cpu().numpy())
            for kind, sl in self.sl.items():
                dist = torch.cdist(q[:, sl], self.bank[:, sl])
                out[f"kNN-{kind}"].append(dist.topk(self.k, largest=False).values.mean(1).cpu().numpy())
            dm = emb.cpu().numpy() - self.mah_mu
            out["Mahal"].append(np.sqrt(np.clip(((dm @ self.mah_prec) * dm).sum(1), 0, None)))
            norms.append(norm.cpu().numpy())
        return {k: np.concatenate(v) for k, v in out.items()}, np.concatenate(norms)

    def _iso(self, Xp):
        return -self.iso.score_samples(Xp)

    def _ssl_score(self, raw):
        if self.sel == "Fused":
            st = self.calib["fused_stats"]
            return np.mean([(_lg(raw[m]) - st[m][0]) / st[m][1] for m in ("ReconNorm", "kNN-both")], axis=0)
        return raw[self.sel]

    def _ens(self, ssl, iso):
        e = self.calib["ens_stats"]
        return np.mean([(_lg(ssl) - e["ssl"][0]) / e["ssl"][1], (_lg(iso) - e["iso"][0]) / e["iso"][1]], axis=0)

    # ---------- calibration on BENIGN validation data (preprocessed) ----------
    def calibrate(self, Xp_val):
        raw, _ = self.raw_scores(Xp_val)
        c = {"fused_stats": {m: [float(_lg(raw[m]).mean()), float(_lg(raw[m]).std() + 1e-8)] for m in ("ReconNorm", "kNN-both")}}
        self.calib = c
        ssl, iso = self._ssl_score(raw), self._iso(Xp_val)
        c["ens_stats"] = {"ssl": [float(_lg(ssl).mean()), float(_lg(ssl).std() + 1e-8)],
                          "iso": [float(_lg(iso).mean()), float(_lg(iso).std() + 1e-8)]}
        ens = self._ens(ssl, iso)
        q = np.arange(0, 100.5, 0.5)
        c["q"] = q.tolist()
        c["quantiles"] = {"ssl": np.percentile(ssl, q).tolist(), "ensemble": np.percentile(ens, q).tolist()}
        c["thresholds"] = {f"{k}_{n}": float(np.quantile(v, p)) for k, v in (("ssl", ssl), ("ensemble", ens))
                           for n, p in (("1pct", 0.99), ("5pct", 0.95))}
        return c

    # ---------- main API ----------
    def score(self, df, mode="ensemble", top_features=3):
        """mode: 'ensemble' (SSL + Isolation Forest) or 'ssl' (selected SSL score only)."""
        assert self.calib is not None, "calibration.json missing - run calibrate() first"
        Xp = self.preprocess(df)
        raw, norm = self.raw_scores(Xp)
        ssl, iso = self._ssl_score(raw), self._iso(Xp)
        ens = self._ens(ssl, iso)
        s = ens if mode == "ensemble" else ssl
        q = np.array(self.calib["q"]); qs = np.array(self.calib["quantiles"][mode if mode == "ensemble" else "ssl"])
        res = pd.DataFrame(index=df.index)
        res["anomaly_score"] = s
        res["benign_percentile"] = np.interp(s, qs, q)     # 99.0 = more anomalous than 99% of benign validation flows
        res["alert_1pct_fpr"] = s > self.calib["thresholds"][f"{mode}_1pct"]
        res["alert_5pct_fpr"] = s > self.calib["thresholds"][f"{mode}_5pct"]
        res["ssl_score"] = ssl; res["iso_score"] = iso
        top = np.argsort(-norm, axis=1)[:, :top_features]
        res["top_features"] = [", ".join(self.feat_cols[j] for j in r) for r in top]
        return res


if __name__ == "__main__":
    det = ZeroDayDetector(Path(__file__).parent)
    out = det.score(pd.read_csv(sys.argv[1]))
    out.to_csv(sys.argv[2] if len(sys.argv) > 2 else "alerts.csv")
    print(out.sort_values("anomaly_score", ascending=False).head(10))
