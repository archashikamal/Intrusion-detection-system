export type Mode = 'ensemble' | 'ssl'

export interface Row {
  index: number
  anomaly_score: number
  benign_percentile: number
  alert_1pct_fpr: boolean
  top_features: string
  true_family?: string
}

export interface ScoreResult {
  summary: { n: number; alerts_1pct: number; alerts_5pct: number }
  rows: Row[]
}

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

async function parse(r: Response): Promise<ScoreResult> {
  if (!r.ok) {
    let msg = `Request failed (${r.status})`
    try {
      const j = await r.json()
      if (j.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return r.json()
}

const net = (e: unknown): never => {
  if (e instanceof TypeError) throw new Error(`Cannot reach backend at ${API}. Is it running?`)
  throw e
}

export const scoreFile = (file: File, mode: Mode) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('mode', mode)
  return fetch(`${API}/score`, { method: 'POST', body: fd }).then(parse).catch(net)
}

export interface Preset {
  id: string
  label: string
  description: string
}

export const scoreSample = (mode: Mode, preset: string) =>
  fetch(`${API}/sample?mode=${mode}&preset=${preset}`).then(parse).catch(net)

export const getPresets = (): Promise<Preset[]> => fetch(`${API}/samples`).then((r) => r.json()).catch(net)
