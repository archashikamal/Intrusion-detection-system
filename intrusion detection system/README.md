# Zero-Day Network Anomaly Detector

A research UI for a self-supervised network-flow anomaly detector. It learns what normal traffic looks like and ranks flows by how much they deviate. Scores are anomaly scores, not attack probabilities.

On held-out data the supervised baseline wins (AUROC 0.956 vs Isolation Forest 0.826 vs SSL 0.55), and the unsupervised methods catch few attacks at 1% FPR. Treat alerts as triage hints.

## Structure

```
.claude/CLAUDE.md          project instructions for Claude Code
backend/
  main.py                  FastAPI app (/health, /score, /samples, /sample)
  requirements.txt
  export_model/            trained detector + inference.py + sample_flows.csv
frontend/                  React + Vite + TypeScript + Tailwind
  src/
    pages/                 Landing (/) and App (/app)
    components/            Hero, NetworkScene, HowItWorks, Results, Footer
    api.ts                 backend client
```

## Run

Backend (port 8000):

```
cd backend
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Frontend (port 5173):

```
cd frontend
npm install
npm run dev
```

Production build: `npm run build` in `frontend/`. Set `VITE_API_URL` to point at a different backend (default `http://localhost:8000`).

## API

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness and model-loaded flag |
| `POST /score` | CSV upload (`file`) + form field `mode` = `ensemble` or `ssl`, max 50,000 rows |
| `GET /samples` | List of small sample presets |
| `GET /sample?preset=&mode=` | Score a preset subset of `sample_flows.csv` |

Responses contain `summary` (`n`, `alerts_1pct`, `alerts_5pct`) and the top 500 `rows` by anomaly score.

## Input format

CSV with CIC-IDS2017-style flow feature columns. Required columns are listed in `backend/export_model/meta.json` (`feat_cols`). The model details are in `backend/export_model/README.md`.

## Caveats

Trained on CIC-IDS2017 aggregated flow features only. It may not transfer to other networks without recalibration. The `true_family` badge on sample data is for evaluation only; the detector never sees it.
