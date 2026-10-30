import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { getPresets, scoreFile, scoreSample, type Mode, type Preset, type Row, type ScoreResult } from '../api'

type Source = { kind: 'file'; file: File } | { kind: 'sample'; preset: string }
type SortKey = 'index' | 'anomaly_score' | 'benign_percentile'

const NOTE =
  'Anomaly scores measure how far a flow deviates from benign training traffic. They are not probabilities that a flow is an attack. Higher means more unusual, and unusual is not always malicious.'

function Info() {
  return (
    <span className="group relative inline-flex">
      <span className="grid h-4 w-4 cursor-help place-items-center rounded-full border border-white/30 text-[10px] text-slate-300">?</span>
      <span className="pointer-events-none absolute left-1/2 top-6 z-30 w-64 -translate-x-1/2 rounded-xl border border-white/10 bg-ink/95 p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-300 opacity-0 shadow-xl transition group-hover:opacity-100">
        {NOTE}
      </span>
    </span>
  )
}

function Stat({ label, value, color, delay }: { label: string; value: number; color: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="glass p-5">
      <div className="text-xs uppercase tracking-widest text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-extrabold sm:text-4xl" style={{ color, textShadow: `0 0 20px ${color}66` }}>
        {value.toLocaleString()}
      </div>
    </motion.div>
  )
}

function Gauge({ value, max }: { value: number; max: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, value / max))
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0 -rotate-90">
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
      <motion.circle
        cx="28" cy="28" r={r} fill="none" stroke="#ff2bd6" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - f) }}
        transition={{ duration: 0.9 }} style={{ filter: 'drop-shadow(0 0 4px #ff2bd6)' }}
      />
    </svg>
  )
}

function PctBar({ v }: { v: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-magenta"
        initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, v))}%` }} transition={{ duration: 0.9 }}
      />
    </div>
  )
}

const feats = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

function Chips({ s }: { s: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {feats(s).map((f) => (
        <span key={f} className="rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-2 py-0.5 text-[11px] text-neon-cyan">{f}</span>
      ))}
    </div>
  )
}

function Family({ f }: { f?: string }) {
  if (!f) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300">
      {f} <span className="text-[9px] uppercase opacity-70">eval only</span>
    </span>
  )
}

export default function App() {
  const [mode, setMode] = useState<Mode>('ensemble')
  const [src, setSrc] = useState<Source | null>(null)
  const [data, setData] = useState<ScoreResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: 'anomaly_score', asc: false })
  const [sel, setSel] = useState<Row | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const input = useRef<HTMLInputElement>(null)
  const req = useRef(0)

  const run = useCallback(async (s: Source, m: Mode) => {
    const id = ++req.current
    setSrc(s); setLoading(true); setError(null); setSel(null)
    try {
      const r = s.kind === 'file' ? await scoreFile(s.file, m) : await scoreSample(m, s.preset)
      if (id === req.current) setData(r)
    } catch (e) {
      if (id === req.current) { setError(e instanceof Error ? e.message : 'Unknown error'); setData(null) }
    } finally {
      if (id === req.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    getPresets().then(setPresets).catch(() => {})
  }, [])

  const changeMode = (m: Mode) => {
    setMode(m)
    if (src) run(src, m)
  }

  const onFile = (f?: File) => {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.csv')) return setError('Please upload a .csv file.')
    run({ kind: 'file', file: f }, mode)
  }

  const rows = useMemo(() => {
    if (!data) return []
    const d = sort.asc ? 1 : -1
    return [...data.rows].sort((a, b) => (a[sort.k] - b[sort.k]) * d)
  }, [data, sort])

  const top = data?.rows.slice(0, 8) ?? []
  const maxScore = data ? Math.max(...data.rows.map((r) => r.anomaly_score), 1e-9) : 1
  const hasFamily = !!data?.rows.some((r) => r.true_family)

  const th = (k: SortKey, label: string) => (
    <th className="cursor-pointer select-none px-3 py-2 text-left hover:text-white" onClick={() => setSort((s) => ({ k, asc: s.k === k ? !s.asc : false }))}>
      {label} {sort.k === k ? (sort.asc ? '↑' : '↓') : ''}
    </th>
  )

  return (
    <div className="relative min-h-screen overflow-x-hidden px-4 pb-24 pt-6 sm:px-8">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.12),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(255,43,214,0.12),transparent_40%)]" />
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-3">
          <Link to="/" className="text-sm text-slate-400 hover:text-white">← Home</Link>
          <h1 className="flex items-center gap-2 text-lg font-bold text-white">Detector <Info /></h1>
        </header>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_auto]">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]) }}
            onClick={() => input.current?.click()}
            className={`glass flex cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-6 text-center transition sm:p-10 ${drag ? 'border-neon-cyan bg-neon-cyan/10' : ''}`}
          >
            <input ref={input} type="file" accept=".csv" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
            <div className="text-white">Drop a CSV of flows here, or click to browse</div>
            <div className="text-xs text-slate-400">CICFlowMeter-style columns · max 50,000 rows{src?.kind === 'file' ? ` · ${src.file.name}` : ''}</div>
          </div>
          <div className="glass flex flex-col justify-center gap-4 p-6">
            <div className="flex rounded-full border border-white/10 p-1">
              {(['ensemble', 'ssl'] as Mode[]).map((m) => (
                <button key={m} onClick={() => changeMode(m)} className={`flex-1 rounded-full px-4 py-1.5 text-sm font-semibold transition ${mode === m ? 'bg-neon-cyan text-ink' : 'text-slate-300 hover:text-white'}`}>
                  {m}
                </button>
              ))}
            </div>
            <div className="text-xs uppercase tracking-widest text-slate-400">Sample sets</div>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((p) => (
                <button
                  key={p.id} title={p.description} onClick={() => run({ kind: 'sample', preset: p.id }, mode)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs transition hover:bg-white/10 ${src?.kind === 'sample' && src.preset === p.id ? 'border-neon-cyan bg-neon-cyan/10 text-white' : 'border-white/10 text-slate-300'}`}
                >
                  <div className="font-semibold">{p.label}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{p.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
        )}

        {loading && (
          <div className="mt-16 flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
            <div className="text-sm text-slate-400">Scoring flows…</div>
          </div>
        )}

        {!loading && data && (
          <div className="mt-8">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Flows scored" value={data.summary.n} color="#e2e8f0" delay={0} />
              <Stat label="Alerts @ 1% FPR" value={data.summary.alerts_1pct} color="#ff2bd6" delay={0.1} />
              <Stat label="Alerts @ 5% FPR" value={data.summary.alerts_5pct} color="#22d3ee" delay={0.2} />
            </div>

            <h2 className="mt-10 flex items-center gap-2 text-xl font-bold text-white">Top alerts <Info /></h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {top.map((r, i) => (
                <motion.button
                  key={r.index} onClick={() => setSel(r)}
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -4 }}
                  className="glass flex gap-4 p-4 text-left"
                >
                  <div className="relative">
                    <Gauge value={r.anomaly_score} max={maxScore} />
                    <div className="absolute inset-0 grid place-items-center text-[11px] font-bold text-white">{r.anomaly_score.toFixed(2)}</div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                      <span>Flow #{r.index}</span>
                      <span className="flex items-center gap-2">
                        <Family f={r.true_family} />
                        {r.alert_1pct_fpr && <span className="text-neon-magenta">alert</span>}
                      </span>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] text-slate-400">Benign percentile {r.benign_percentile.toFixed(1)}</div>
                      <PctBar v={r.benign_percentile} />
                    </div>
                    <Chips s={r.top_features} />
                  </div>
                </motion.button>
              ))}
            </div>

            <div className="mt-10 grid gap-5 lg:grid-cols-[1fr_1fr]">
              <div className="glass p-5">
                <h3 className="mb-2 text-sm font-semibold text-white">Score vs percentile (top {data.rows.length})</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="benign_percentile" type="number" domain={['auto', 100]} stroke="#64748b" name="percentile" />
                      <YAxis dataKey="anomaly_score" type="number" stroke="#64748b" name="score" />
                      <ZAxis range={[30, 30]} />
                      <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.2)' }} contentStyle={{ background: 'rgba(5,6,15,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }} />
                      <Scatter data={data.rows.filter((r) => !r.alert_1pct_fpr)} fill="#22d3ee" fillOpacity={0.6} />
                      <Scatter data={data.rows.filter((r) => r.alert_1pct_fpr)} fill="#ff2bd6" fillOpacity={0.9} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">Magenta = alert at 1% FPR.</div>
              </div>
              <div className="glass p-5 text-sm leading-relaxed text-slate-400">
                <h3 className="mb-2 font-semibold text-white">Reading these results</h3>
                <p>{NOTE}</p>
                <p className="mt-2">
                  "Benign percentile" shows how the flow ranks against benign validation flows: 99 means more anomalous than 99% of them. Alerts are set by a false-positive budget, so some alerts will be benign.
                </p>
                {hasFamily && <p className="mt-2">Family labels come from the sample file for evaluation only. The detector never sees them.</p>}
              </div>
            </div>

            <div className="glass mt-10 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    {th('index', 'Flow')}
                    {th('anomaly_score', 'Score')}
                    {th('benign_percentile', 'Percentile')}
                    <th className="px-3 py-2 text-left">1% FPR</th>
                    <th className="px-3 py-2 text-left">Top features</th>
                    {hasFamily && <th className="px-3 py-2 text-left">Family</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.index} onClick={() => setSel(r)} className="cursor-pointer border-t border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 text-slate-300">#{r.index}</td>
                      <td className="px-3 py-2 font-mono text-white">{r.anomaly_score.toFixed(3)}</td>
                      <td className="px-3 py-2 font-mono">{r.benign_percentile.toFixed(1)}</td>
                      <td className="px-3 py-2">{r.alert_1pct_fpr ? <span className="text-neon-magenta">alert</span> : <span className="text-slate-500">–</span>}</td>
                      <td className="max-w-xs truncate px-3 py-2 text-slate-400">{r.top_features}</td>
                      {hasFamily && <td className="px-3 py-2"><Family f={r.true_family} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && !data && !error && (
          <p className="mt-16 text-center text-sm text-slate-500">Upload flows or use the sample data to see ranked alerts.</p>
        )}
      </div>

      <AnimatePresence>
        {sel && (
          <>
            <motion.div key="bg" className="fixed inset-0 z-40 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSel(null)} />
            <motion.aside
              key="drawer" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="glass fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto rounded-r-none bg-ink/90 p-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Flow #{sel.index}</h3>
                <button onClick={() => setSel(null)} aria-label="Close" className="text-2xl leading-none text-slate-400 hover:text-white">×</button>
              </div>
              <div className="mt-6 flex items-center gap-4">
                <div className="relative">
                  <Gauge value={sel.anomaly_score} max={maxScore} />
                  <div className="absolute inset-0 grid place-items-center text-[11px] font-bold text-white">{sel.anomaly_score.toFixed(2)}</div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">Anomaly score <Info /></div>
                  <div className="text-2xl font-bold text-white">{sel.anomaly_score.toFixed(4)}</div>
                </div>
              </div>
              <div className="mt-6">
                <div className="mb-1 text-xs text-slate-400">Benign percentile {sel.benign_percentile.toFixed(2)}</div>
                <PctBar v={sel.benign_percentile} />
              </div>
              <div className="mt-6 text-sm">
                Status: {sel.alert_1pct_fpr ? <span className="text-neon-magenta">flagged at 1% FPR</span> : <span className="text-slate-400">below the 1% FPR threshold</span>}
              </div>
              <div className="mt-6">
                <div className="mb-2 text-xs uppercase tracking-widest text-slate-400">Most unusual features</div>
                <Chips s={sel.top_features} />
              </div>
              {sel.true_family && (
                <div className="mt-6">
                  <div className="mb-2 text-xs uppercase tracking-widest text-slate-400">True family</div>
                  <Family f={sel.true_family} />
                </div>
              )}
              <p className="mt-8 text-xs leading-relaxed text-slate-500">{NOTE}</p>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
