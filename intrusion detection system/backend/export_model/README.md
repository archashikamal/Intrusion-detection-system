# Zero-Day Flow Anomaly Detector (export)

Selected config (chosen on dev families only): `{'config': 'masked_r0.30', 'mode': 'masked', 'mask_ratio': 0.3, 'scorer': 'kNN-mean'}`

Usage:
    from inference import ZeroDayDetector
    det = ZeroDayDetector("export_model")
    out = det.score(df, mode="ensemble")     # or mode="ssl"

Input: raw CIC-IDS2017-style flow features; required columns are listed in meta.json (feat_cols).
Output columns: anomaly_score, benign_percentile, alert_1pct_fpr, alert_5pct_fpr, ssl_score, iso_score, top_features.

Notes
- Scores are unsupervised anomaly scores, NOT attack probabilities. Thresholds are set on benign validation traffic.
- On held-out families the supervised baseline outperformed this detector in the notebook; treat alerts as triage hints.
- 'ensemble' was preferred after seeing held-out results; 'ssl' is the dev-selected score.
- Trained on CIC-IDS2017 aggregated flow features only; may not transfer to other networks without recalibration
  (det.calibrate(X_benign_preprocessed) on local benign traffic).
- Front-end idea: FastAPI endpoint wrapping det.score(), or Streamlit app uploading a CSV (sample_flows.csv included).
