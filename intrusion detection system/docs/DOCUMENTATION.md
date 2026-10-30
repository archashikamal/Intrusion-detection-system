# Zero-Day Network Anomaly Detector: Project Documentation

## 1. Overview

A research web app around a self-supervised anomaly detector for network flows. The detector is trained on benign traffic only. It scores each flow by how far it deviates from "normal", then ranks flows and raises alerts at fixed false-positive budgets.

- **Backend:** FastAPI service that wraps `ZeroDayDetector` (`backend/export_model/inference.py`).
- **Frontend:** React + Vite + TypeScript, with a landing page (`/`) and a detector dashboard (`/app`).
- **Honesty constraint:** scores are anomaly scores, not attack probabilities. On held-out data the supervised baseline wins, and unsupervised methods catch few attacks at 1% FPR. The UI says so.

### Results shown on the landing page (held-out AUROC)

| Method | AUROC |
|---|---|
| Supervised | 0.956 |
| Isolation Forest | 0.826 |
| SSL (self-supervised) | 0.55 |

## 2. Repository layout

```
.claude/CLAUDE.md              instructions for Claude Code (project rules and style)
README.md                      short overview and run steps
docs/DOCUMENTATION.md          this file
backend/
  main.py                      FastAPI app
  requirements.txt             backend Python dependencies
  export_model/
    inference.py               FlowSSL network + ZeroDayDetector
    meta.json                  model config, feature list, selected scorer
    calibration.json           benign-validation statistics, quantiles, thresholds
    flow_ssl_weights.pt        trained transformer weights
    isolation_forest.joblib    fitted Isolation Forest
    preproc.npz                feature mean (mu) and std (sd)
    scorers.npz                reference arrays for the SSL scorers
    sample_flows.csv           300 labeled sample flows (for demo and evaluation)
    README.md                  original model-export notes
    requirements.txt           model-side dependencies
frontend/
  index.html                   HTML shell, title, favicon, fonts
  package.json                 scripts and dependencies
  vite.config.ts               Vite config (React plugin, port 5173)
  tsconfig.json                TypeScript config (strict)
  tailwind.config.js           Tailwind theme (neon colors, font)
  postcss.config.js            Tailwind + autoprefixer
  public/favicon.svg           favicon
  src/
    main.tsx                   entry, router, page transitions
    index.css                  Tailwind layers, .glass and .btn classes, reduced-motion rules
    api.ts                     backend client and types
    vite-env.d.ts              Vite env typings
    pages/Landing.tsx          landing page composition
    pages/App.tsx              detector dashboard
    components/Hero.tsx        hero section
    components/NetworkScene.tsx  3D network (react-three-fiber)
    components/HowItWorks.tsx  four step cards
    components/Results.tsx     AUROC bar chart and caption
    components/Footer.tsx      footer
```

## 3. How the detector works

### 3.1 Input and preprocessing
Input is a CSV of CICFlowMeter-style flow features (dataset: CIC-IDS2017, `dhoogla/cicids2017`). The 69 required columns are listed in `meta.json` under `feat_cols`. Preprocessing (`ZeroDayDetector.preprocess`):

1. Strip whitespace from column names and check that all 69 columns exist (otherwise `ValueError`).
2. Coerce to numeric, replace NaN with 0 and ±inf with ±1e12.
3. Signed log transform: `sign(x) * log1p(|x|)`.
4. Standardize with `mu` and `sd` from `preproc.npz`, then clip to ±10 (`clip`).

### 3.2 The self-supervised model (`FlowSSL`)
A tabular transformer. Config from `meta.json`: 69 features, embedding size `d=64`, 4 heads, 3 layers, feed-forward multiplier 4, dropout 0.05.

- Each feature value becomes a token: `value * w[f] + b[f]` (a per-feature linear embedding).
- A learned mask token replaces masked features, and a CLS token is prepended.
- The transformer encoder (pre-norm, GELU) produces hidden states.
- A decoder head reconstructs each feature from its token. Training masked random subsets of features (mask ratio 0.3 was selected) and reconstructed them from the rest.
- `embed(x)` returns the CLS vector concatenated with the mean of the feature tokens (128 dims).

### 3.3 Raw scores (`raw_scores`)
For each batch, features are masked group by group (`groups` from `scorers.npz`) and reconstructed. Squared error is accumulated per feature, then normalized by a benign reference error (`ref`). Scores computed:

| Score | Meaning |
|---|---|
| Recon | mean raw reconstruction error |
| ReconNorm | mean normalized error |
| ReconTop8 | mean of the 8 largest normalized errors |
| Mahal | Mahalanobis distance of the embedding from the benign mean |
| kNN-cls / kNN-mean / kNN-both | mean distance to the k=5 nearest benign embeddings, using the CLS part, the mean-token part, or both |

### 3.4 Final scores
- **SSL score:** the selected scorer. This export uses `kNN-mean` (`meta.json`). If the selected scorer were `Fused`, it would average z-scores of `ReconNorm` and `kNN-both`.
- **Isolation Forest score:** `-iso.score_samples(X)`, computed on the preprocessed features.
- **Ensemble:** average of the z-scored `log(ssl)` and `log(iso)`, using `ens_stats` from `calibration.json`.
- **mode:** `ensemble` uses the ensemble score. `ssl` uses the SSL score alone.

### 3.5 Calibration and alerts
`calibration.json` holds benign-validation statistics:

- `q` and `quantiles`: score quantiles at 0.5-percent steps, per mode.
- `thresholds`: score cutoffs at 1% and 5% false-positive rates on benign validation data.

| Threshold | Value |
|---|---|
| ssl 1% | 2.312 |
| ssl 5% | 1.332 |
| ensemble 1% | 1.620 |
| ensemble 5% | 1.244 |

`score()` returns, per flow:

- `anomaly_score`: the selected score.
- `benign_percentile`: the score interpolated against the benign quantiles. 99 means more anomalous than 99% of benign validation flows.
- `alert_1pct_fpr` / `alert_5pct_fpr`: score above the corresponding threshold.
- `ssl_score`, `iso_score`: both components.
- `top_features`: the 3 features with the highest normalized reconstruction error, as a comma-separated string.

### 3.6 Recalibration
`calibrate(X_benign_preprocessed)` recomputes `calibration.json`-style stats on local benign data. This is needed for networks that differ from CIC-IDS2017.

### 3.7 Limitations
- Trained on CIC-IDS2017 aggregated flow features only.
- The supervised baseline outperforms this detector on held-out families.
- `ensemble` was preferred after seeing held-out results. `ssl` is the dev-selected score.
- Alerts are triage hints. A false-positive budget means some alerts will be benign, and unusual flows are not always malicious.

## 4. Backend: `backend/main.py`

### 4.1 Startup
- Locates the model directory: `backend/export_model/` if it contains `inference.py`, otherwise the project root. It raises `RuntimeError` if neither does.
- Adds that directory to `sys.path` and imports `ZeroDayDetector`.
- Loads the detector once at startup using FastAPI's `lifespan` context and stores it in a module-level `state` dict.
- CORS is open for `http://localhost:5173` and `http://127.0.0.1:5173`.

### 4.2 Constants
- `MAX_ROWS = 50000`: upload row limit.
- `TOP_N = 500`: number of rows returned.
- `PRESETS`: sample set definitions (see below).

### 4.3 Helper: `run(df, mode, extra=None)`
1. Validates `mode` (400 if not `ensemble` or `ssl`), rejects empty input (400) and more than 50,000 rows (413).
2. Calls `detector.score(df, mode)`. A `ValueError` (for example, missing columns) becomes a 422.
3. Builds `summary` (`n`, `alerts_1pct`, `alerts_5pct`).
4. Sorts by `anomaly_score` descending, keeps the top 500, and builds rows with `index`, `anomaly_score`, `benign_percentile`, `alert_1pct_fpr`, `top_features`, plus `true_family` when `extra` is given (sample data only).

### 4.4 Endpoints

| Method and path | Description |
|---|---|
| `GET /health` | `{"status": "ok", "model_loaded": true}` |
| `POST /score` | Multipart form: `file` (CSV) and `mode` (default `ensemble`). Reads at most `MAX_ROWS + 1` rows so oversize files are rejected without full parsing. Strips column names and drops `true_family_eval_only` if present. Returns `{summary, rows}`. |
| `GET /samples` | List of `{id, label, description}` for each preset. |
| `GET /sample?preset=&mode=` | Scores a small subset of `sample_flows.csv`. Default preset is `mixed`. Drops `true_family_eval_only` before scoring and returns it as `true_family` in each row. Unknown preset returns 404. |

### 4.5 Sample presets
Sampling uses `random_state=7`, so results are reproducible. Original row indices are preserved.

| id | Label | Contents |
|---|---|---|
| `benign` | Benign only | 20 benign flows |
| `web` | Web attacks | 15 web attack flows |
| `bot` | Botnet | 15 bot flows |
| `mixed` | Mixed traffic | 15 benign, 5 web, 5 bot |
| `rare` | Rare infiltration | 19 benign, 1 infiltration |
| `random` | Random 25 | 25 random flows |

The full sample file has 300 rows: 150 Benign, 84 WebAttack, 65 Bot, 1 Infiltration.

### 4.6 Response shape
```json
{
  "summary": { "n": 15, "alerts_1pct": 0, "alerts_5pct": 0 },
  "rows": [
    {
      "index": 169,
      "anomaly_score": 1.155,
      "benign_percentile": 93.0,
      "alert_1pct_fpr": false,
      "top_features": "Feature A, Feature B, Feature C",
      "true_family": "Bot"
    }
  ]
}
```
`true_family` appears only for sample endpoints.

### 4.7 Dependencies (`backend/requirements.txt`)
fastapi, uvicorn, python-multipart, torch, numpy, pandas, scikit-learn, joblib.

## 5. Frontend

Stack: React 18, Vite 5, TypeScript (strict), Tailwind 3, `@react-three/fiber` 8, `@react-three/drei` 9, three, framer-motion, recharts, react-router-dom.

### 5.1 Config and entry files

| File | Purpose |
|---|---|
| `index.html` | Title "Zero-Day Anomaly Detector", favicon, theme color, meta description, Inter font. |
| `package.json` | Scripts: `dev` (Vite), `build` (`tsc -b && vite build`), `preview`. |
| `vite.config.ts` | React plugin, dev server port 5173. |
| `tailwind.config.js` | Adds `neon.cyan` (#22d3ee), `neon.magenta` (#ff2bd6), `ink` (#05060f), Inter font. |
| `src/index.css` | Tailwind layers, dark body, `.glass` (blur, border, soft glow) and `.btn` classes, `prefers-reduced-motion` overrides. |
| `src/main.tsx` | Mounts the app. `MotionConfig reducedMotion="user"` honors the OS setting. A `Shell` component wraps routes in `AnimatePresence` for fade and slide page transitions. Routes: `/` Landing, `/app` dashboard. |
| `src/api.ts` | Types (`Mode`, `Row`, `ScoreResult`, `Preset`) and calls: `scoreFile`, `scoreSample`, `getPresets`. Base URL from `VITE_API_URL`, default `http://localhost:8000`. Error responses are parsed into readable messages. Network failures become "Cannot reach backend". |

### 5.2 Landing page (`/`)

- **`pages/Landing.tsx`:** stacks Hero, HowItWorks, Results, Footer.
- **`components/Hero.tsx`:** full-height section. The 3D scene is lazy-loaded. If the user prefers reduced motion, a static radial gradient replaces it. Contains the title "Catch attacks no one has seen yet", subtitle, a note that scores are not probabilities, and two buttons: "Try the detector" (`/app`) and "How it works" (anchor `#how`).
- **`components/NetworkScene.tsx`:** react-three-fiber canvas with device pixel ratio capped at 1.5, no antialiasing and no post-processing, to keep the GPU light. 150 nodes are drawn as one `InstancedMesh` and edges as one `LineSegments` (each node linked to its two nearest neighbors). Eight random nodes are magenta and pulse in scale. The rest are cyan. The group rotates slowly and follows the mouse (parallax).
- **`components/HowItWorks.tsx`:** four glass cards that animate in on scroll: Learn normal, Mask and predict, Score deviation, Rank alerts.
- **`components/Results.tsx`:** recharts bar chart of the three AUROC values with an honest caption: supervised wins on this benchmark, and unsupervised methods catch few attacks at 1% FPR.
- **`components/Footer.tsx`:** research-prototype disclaimer.

### 5.3 Dashboard (`/app`): `pages/App.tsx`

**State:** mode, current source (uploaded file or sample preset), results, loading, error, table sort, selected row, preset list.

**Behavior:**
- Loads presets from `GET /samples` on mount and shows them as six buttons.
- Drag-and-drop or click-to-browse CSV upload (only `.csv` accepted).
- Mode toggle (`ensemble` / `ssl`). Changing it re-runs the current source.
- A request counter ignores out-of-date responses, so rapid clicks cannot show stale results.

**Result views:**
- **Stat cards:** flows scored, alerts at 1% FPR, alerts at 5% FPR.
- **Top alerts:** the top 8 as cards, each with a score ring (relative to the highest score), a benign-percentile bar, feature chips, an "alert" tag if above the 1% threshold, and a "true family, eval only" badge for sample data.
- **Scatter chart:** score versus percentile for the returned rows, with 1% alerts in magenta.
- **Explainer card:** what the score and percentile mean.
- **Sortable table:** all returned rows. Click a header to sort by flow, score, or percentile. Click a row to open the drawer.
- **Detail drawer:** slides in from the right with the score, percentile, alert status, feature chips and the true family (sample data only).
- A "?" tooltip explains that scores are anomaly scores, not attack probabilities.
- Loading spinner, error banner, and an empty-state message are shown as appropriate.

## 6. Running the project

Backend:
```
cd backend
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Frontend:
```
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in frontend/dist
```

Set `VITE_API_URL` (for example in `frontend/.env`) to use a different backend address. If you change the frontend port or host, add the new origin to the CORS list in `backend/main.py`.

## 7. Using your own data

Upload a CSV that has all 69 columns in `meta.json` under `feat_cols`. Extra columns are ignored. A column named `true_family_eval_only` is dropped before scoring. Missing columns return an error that names a few of them. Files over 50,000 rows are rejected. For traffic from a different network, recalibrate with `calibrate()` on local benign data first.

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Cannot reach backend" | Backend is not running, or `VITE_API_URL` is wrong. |
| CORS error in the browser console | Frontend origin is not in the backend CORS list. |
| Sample buttons missing | `/samples` failed. Check the backend is running and restart it after code changes (it does not auto-reload). |
| 422 "Missing N required columns" | The CSV lacks required feature columns. |
| 413 | More than 50,000 rows. |
| Slow first request | The model and the 47 MB `scorers.npz` load at startup. Scoring runs on CPU unless CUDA is available. |

## 9. How to read the results

- **Anomaly score:** how unusual a flow is compared with benign training traffic. Higher means more unusual. It is not a probability of attack.
- **Benign percentile:** the share of benign validation flows this flow is more anomalous than.
- **Alerts at 1% / 5% FPR:** flows above the score that only 1% (or 5%) of benign validation flows exceed. The 5% setting catches more but raises more false alarms.
- **Feature chips:** the features the model reconstructed worst for that flow. They hint at what looks unusual.
- **True family badge:** for evaluation only, from the sample file. The detector never sees it.
