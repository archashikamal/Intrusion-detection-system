import { lazy, Suspense } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'

const NetworkScene = lazy(() => import('./NetworkScene'))

export default function Hero() {
  const reduce = useReducedMotion()
  return (
    <section className="relative h-[100svh] min-h-[600px] w-full overflow-hidden">
      <div className="absolute inset-0">
        {reduce ? (
          <div className="h-full w-full bg-[radial-gradient(circle_at_30%_30%,rgba(34,211,238,0.25),transparent_45%),radial-gradient(circle_at_70%_60%,rgba(255,43,214,0.22),transparent_45%)]" />
        ) : (
          <Suspense fallback={null}>
            <NetworkScene />
          </Suspense>
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,#05060f_85%)]" />
      <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col items-center justify-center px-5 text-center">
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass mb-6 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-neon-cyan"
        >
          Research detector · anomaly scores, not probabilities
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.7 }}
          className="text-4xl font-extrabold leading-tight text-white drop-shadow-[0_0_30px_rgba(34,211,238,0.35)] sm:text-6xl md:text-7xl"
        >
          Catch attacks <span className="bg-gradient-to-r from-neon-cyan to-neon-magenta bg-clip-text text-transparent">no one has seen</span> yet
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.7 }}
          className="mt-6 max-w-2xl text-base text-slate-300 sm:text-lg"
        >
          A self-supervised model learns what normal network flows look like, then flags the ones that deviate — no attack labels required.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.7 }}
          className="mt-10 flex flex-col gap-3 sm:flex-row"
        >
          <Link to="/app" className="btn bg-neon-cyan text-ink shadow-[0_0_30px_rgba(34,211,238,0.5)] hover:brightness-110">
            Try the detector
          </Link>
          <a href="#how" className="btn glass text-white hover:bg-white/10">
            How it works
          </a>
        </motion.div>
      </div>
    </section>
  )
}
