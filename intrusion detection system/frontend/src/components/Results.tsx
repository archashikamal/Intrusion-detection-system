import { motion } from 'framer-motion'
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const data = [
  { name: 'Supervised', auroc: 0.956, color: '#22d3ee' },
  { name: 'Isolation Forest', auroc: 0.826, color: '#8b5cf6' },
  { name: 'SSL', auroc: 0.55, color: '#ff2bd6' },
]

export default function Results() {
  return (
    <section className="mx-auto max-w-4xl px-5 py-24">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="glass p-6 sm:p-10"
      >
        <h2 className="text-3xl font-bold text-white sm:text-4xl">Held-out results</h2>
        <p className="mt-2 text-sm text-slate-400">AUROC on held-out data</p>
        <div className="mt-8 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
              <XAxis dataKey="name" stroke="#64748b" tickLine={false} axisLine={false} />
              <YAxis domain={[0, 1]} stroke="#64748b" tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                contentStyle={{ background: 'rgba(5,6,15,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}
              />
              <Bar dataKey="auroc" radius={[8, 8, 0, 0]}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
                <LabelList dataKey="auroc" position="top" fill="#e2e8f0" formatter={(v: unknown) => Number(v).toFixed(3)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-slate-400">
          Supervised wins on this benchmark. The unsupervised methods, especially the SSL scorer alone, catch few attacks at a 1% false-positive rate. Their value is that they need no attack labels and may flag unseen behavior, not that they beat supervised models on known attacks.
        </p>
      </motion.div>
    </section>
  )
}
