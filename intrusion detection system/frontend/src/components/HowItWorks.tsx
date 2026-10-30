import { motion } from 'framer-motion'

const steps = [
  { n: '01', t: 'Learn normal', d: 'Train only on benign flows so the model captures what everyday traffic looks like.', c: '#22d3ee' },
  { n: '02', t: 'Mask & predict', d: 'Hide random flow features and ask the transformer to reconstruct them from the rest.', c: '#8b5cf6' },
  { n: '03', t: 'Score deviation', d: 'Flows that are hard to reconstruct, or sit far from normal in embedding space, score higher.', c: '#d946ef' },
  { n: '04', t: 'Rank alerts', d: 'Scores are ranked against benign validation data, with thresholds set at 1% and 5% false positives.', c: '#ff2bd6' },
]

export default function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 py-24">
      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="text-center text-3xl font-bold text-white sm:text-4xl"
      >
        How it works
      </motion.h2>
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ delay: i * 0.1, duration: 0.6 }}
            whileHover={{ y: -6 }}
            className="glass p-6"
          >
            <div className="text-sm font-bold" style={{ color: s.c, textShadow: `0 0 14px ${s.c}` }}>{s.n}</div>
            <h3 className="mt-3 text-xl font-semibold text-white">{s.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.d}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
