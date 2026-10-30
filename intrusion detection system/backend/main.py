import io
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

HERE = Path(__file__).resolve().parent
ART = next((p for p in (HERE / "export_model", HERE.parent) if (p / "inference.py").exists()), None)
if ART is None:
    raise RuntimeError("inference.py not found in backend/export_model or project root")
sys.path.insert(0, str(ART))
from inference import ZeroDayDetector  # noqa: E402

MAX_ROWS = 50_000
TOP_N = 500
state = {}


@asynccontextmanager
async def lifespan(app):
    state["det"] = ZeroDayDetector(ART)
    yield


app = FastAPI(title="Zero-day anomaly detector", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def run(df, mode, extra=None):
    if mode not in ("ensemble", "ssl"):
        raise HTTPException(400, "mode must be 'ensemble' or 'ssl'")
    if len(df) == 0:
        raise HTTPException(400, "no rows")
    if len(df) > MAX_ROWS:
        raise HTTPException(413, f"max {MAX_ROWS} rows")
    try:
        res = state["det"].score(df, mode=mode)
    except ValueError as e:
        raise HTTPException(422, str(e))
    summary = {
        "n": int(len(res)),
        "alerts_1pct": int(res["alert_1pct_fpr"].sum()),
        "alerts_5pct": int(res["alert_5pct_fpr"].sum()),
    }
    top = res.sort_values("anomaly_score", ascending=False).head(TOP_N)
    rows = []
    for idx, r in top.iterrows():
        row = {
            "index": int(idx),
            "anomaly_score": float(r["anomaly_score"]),
            "benign_percentile": float(r["benign_percentile"]),
            "alert_1pct_fpr": bool(r["alert_1pct_fpr"]),
            "top_features": r["top_features"],
        }
        if extra is not None:
            row["true_family"] = str(extra.loc[idx])
        rows.append(row)
    return {"summary": summary, "rows": rows}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": "det" in state}


@app.post("/score")
def score(file: UploadFile = File(...), mode: str = Form("ensemble")):
    try:
        df = pd.read_csv(io.BytesIO(file.file.read()), nrows=MAX_ROWS + 1)
    except Exception as e:
        raise HTTPException(400, f"invalid CSV: {e}")
    df.columns = [str(c).strip() for c in df.columns]
    df = df.drop(columns=["true_family_eval_only"], errors="ignore")
    return run(df, mode)


PRESETS = {
    "benign": ("Benign only", "20 normal flows", {"Benign": 20}),
    "web": ("Web attacks", "15 web attack flows", {"WebAttack": 15}),
    "bot": ("Botnet", "15 bot flows", {"Bot": 15}),
    "mixed": ("Mixed traffic", "15 benign, 5 web, 5 bot", {"Benign": 15, "WebAttack": 5, "Bot": 5}),
    "rare": ("Rare infiltration", "1 infiltration among 19 benign", {"Benign": 19, "Infiltration": 1}),
    "random": ("Random 25", "25 flows drawn at random", None),
}


@app.get("/samples")
def samples():
    return [{"id": k, "label": v[0], "description": v[1]} for k, v in PRESETS.items()]


@app.get("/sample")
def sample(mode: str = "ensemble", preset: str = "mixed"):
    if preset not in PRESETS:
        raise HTTPException(404, "unknown preset")
    df = pd.read_csv(ART / "sample_flows.csv")
    df.columns = [str(c).strip() for c in df.columns]
    spec = PRESETS[preset][2]
    if spec is None:
        df = df.sample(25, random_state=7)
    else:
        df = pd.concat(
            [df[df["true_family_eval_only"] == f].sample(min(n, (df["true_family_eval_only"] == f).sum()), random_state=7)
             for f, n in spec.items()]
        ).sort_index()
    fam = df["true_family_eval_only"]
    return run(df.drop(columns=["true_family_eval_only"]), mode, fam)
