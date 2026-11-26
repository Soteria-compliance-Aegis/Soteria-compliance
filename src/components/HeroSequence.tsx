import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

import { cx } from '../lib/cx'
import { SoteriaMark } from './Brand'
import { Eyebrow } from './Typography'

/*
  Hero entry: regulatory noise -> aligned rubrics -> a buyer-ready scorecard.

  The sequence is a timeline of four states on one layout. Nothing is added
  or removed from the layout except the decorative overlay, which is
  absolutely positioned, so the hero reserves its final size from the first
  frame and nothing shifts when the sequence ends.

  Every animated property is transform, opacity or clip-path. The 3.5s run
  happens once per browser session; reduced-motion visitors get the final
  state immediately.
*/

const SEQUENCE_KEY = 'aegis:overview-entry'
const SEQUENCE_MS = [900, 1900, 2900, 3500] as const

type Phase = 0 | 1 | 2 | 3 | 4

const SNIPPETS = [
  '§', '¶', 'AI/ML', 'DATA_USE', 'COMPLY?', 'RISK', 'TRUTH?', 'DPDP', 'LL144', 'CONSENT',
  'BIAS', 'NOTICE', '2027', 'Art. 22', 'opt-out', 'retain', 'disclose', 'audit', 'PII', 'RMF',
  'HB 3773', 'TRAIGA', '§5', 'ADMT', 'SB 26-189', 'redress', 'DPIA', 'model card', 'vendor',
  'policy', 'scope?', 'gap', 'human review', 'training', 'subprocessors', 'log', 'appeal',
]

const RUBRICS = [
  { code: 'FTC §5', name: 'claim substantiation', state: 'gap' },
  { code: 'CA ADMT', name: 'pre-use notice', state: 'gap' },
  { code: 'CO SB 26-189', name: 'risk assessment', state: 'clear' },
  { code: 'TX TRAIGA', name: 'bias testing', state: 'gap' },
  { code: 'NYC LL144', name: 'bias audit summary', state: 'gap' },
  { code: 'IL HB 3773', name: 'notice and accommodation', state: 'clear' },
  { code: 'IN DPDP', name: 'consent notice', state: 'gap' },
] as const

/* Deterministic scatter: the same field on every mount, never re-randomised. */
function scatter(count: number) {
  let seed = 20270101
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  return Array.from({ length: count }, () => ({
    text: SNIPPETS[Math.floor(next() * SNIPPETS.length)],
    x: next() * 100,
    y: next() * 100,
    opacity: 0.04 + next() * 0.08,
    size: 9 + next() * 2.5,
    rotate: (next() - 0.5) * 3,
  }))
}

const NOISE = scatter(120)

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EASE_LINEAR = 'linear'

/* ------------------------------------------------------------------ */
/* Decorative layers                                                  */
/* ------------------------------------------------------------------ */

function NoiseField({ phase }: { phase: Phase }) {
  return (
    <div
      className="absolute inset-0"
      aria-hidden
      style={{
        opacity: phase >= 2 ? 0 : 1,
        clipPath: phase >= 1 ? 'inset(0 0 0 100%)' : 'inset(0 0 0 0)',
        transitionProperty: 'opacity, clip-path',
        transitionDuration: '600ms, 820ms',
        transitionTimingFunction: `${EASE_OUT}, ${EASE_LINEAR}`,
      }}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(rgb(196 208 230 / 0.05) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
      />
      {NOISE.map((item, index) => (
        <span
          key={index}
          className="absolute whitespace-nowrap font-mono text-[#aeb9cc]"
          style={{
            left: `${item.x}%`,
            top: `${item.y}%`,
            fontSize: `${item.size}px`,
            opacity: item.opacity,
            transform: `rotate(${item.rotate}deg)`,
          }}
        >
          {item.text}
        </span>
      ))}
    </div>
  )
}

function Scanner({ phase }: { phase: Phase }) {
  const sweeping = phase >= 1
  return (
    <div
      className="absolute inset-y-0 left-0 w-full"
      aria-hidden
      style={{
        transform: sweeping ? 'translateX(0)' : 'translateX(-100%)',
        opacity: phase >= 2 ? 0 : 1,
        transition: `transform 820ms ${EASE_LINEAR}, opacity 420ms ${EASE_OUT}`,
      }}
    >
      <span className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#7f9ee6]/10 to-transparent" />
      <span className="absolute inset-y-0 right-0 w-px bg-[#8fa9e4]/60" />
    </div>
  )
}

function StreamLayer({ phase }: { phase: Phase }) {
  const visible = phase >= 1
  const converging = phase >= 3
  return (
    <div aria-hidden className="absolute inset-0 hidden md:block">
      <div
        className="absolute inset-0 flex items-stretch justify-between px-2 lg:px-6"
        style={{
          clipPath: visible ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
          opacity: converging ? 0 : 1,
          transform: converging ? 'translate3d(26%, 0, 0) scaleY(0.55)' : 'translate3d(0, 0, 0) scaleY(1)',
          transformOrigin: 'right center',
          transitionProperty: 'clip-path, opacity, transform',
          transitionDuration: '820ms, 400ms, 560ms',
          transitionTimingFunction: `${EASE_LINEAR}, ${EASE_OUT}, ${EASE_OUT}`,
        }}
      >
        {RUBRICS.map((rubric, index) => {
          const accent = rubric.state === 'gap' ? '#cf8054' : '#8fa9e4'
          return (
            <div key={rubric.code} className="relative flex w-[13%] flex-col items-center">
              {/* aligned fragments, phase 1 */}
              <div
                className="flex flex-col items-center gap-2 pt-8 text-center"
                style={{
                  opacity: phase === 1 ? 1 : 0,
                  transform: phase === 1 ? 'translateY(0)' : 'translateY(-4px)',
                  transition: `opacity 300ms ${EASE_OUT}, transform 300ms ${EASE_OUT}`,
                }}
              >
                <span className="font-mono text-[10px] text-soft">{rubric.code}</span>
                <span className="h-px w-6 bg-line-strong" />
                <span className="font-mono text-[9px] leading-relaxed text-faint">{rubric.name}</span>
              </div>

              {/* the same column, now a diagnostic stream */}
              <div
                className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 overflow-hidden bg-line"
                style={{ opacity: phase >= 2 && !converging ? 1 : 0, transition: `opacity 300ms ${EASE_OUT}` }}
              >
                {[22, 10, 10].map((length, packet) => (
                  <span
                    key={packet}
                    className="absolute inset-x-0 top-0 h-full"
                    style={{
                      background: `linear-gradient(to bottom, ${accent} 0 ${length}px, transparent ${length}px)`,
                      opacity: packet === 0 ? 0.6 : 0.28,
                      animation: `stream-flow ${2.4 + index * 0.12}s linear infinite`,
                      animationDelay: `-${packet * 0.7 + index * 0.16}s`,
                    }}
                  />
                ))}
              </div>

              {/* rubric label rides the stream */}
              <span
                className="absolute bottom-3 left-0 w-full text-center font-mono text-[9px]"
                style={{ color: accent, opacity: phase >= 2 && !converging ? 0.7 : 0, transition: `opacity 400ms ${EASE_OUT}` }}
              >
                {rubric.code}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StreamChips({ phase }: { phase: Phase }) {
  const visible = phase >= 2 && phase < 3
  return (
    <div
      aria-hidden
      className="absolute inset-x-6 top-[62%] flex flex-wrap justify-center gap-1.5 md:hidden"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(6px)',
        transition: `opacity 320ms ${EASE_OUT}, transform 320ms ${EASE_OUT}`,
      }}
    >
      {RUBRICS.map((rubric) => (
        <span
          key={rubric.code}
          className={cx(
            'rounded-control px-2 py-1 font-mono text-[9px] ring-1 ring-inset',
            rubric.state === 'gap' ? 'bg-fire-1/10 text-fire-3 ring-fire-1/30' : 'bg-sky/10 text-sky ring-sky/30',
          )}
        >
          {rubric.code}
        </span>
      ))}
    </div>
  )
}

function BrandResolve({ phase }: { phase: Phase }) {
  const visible = phase >= 1 && phase < 3
  return (
    <div
      aria-hidden
      className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 md:top-1/2"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translate(-50%, -50%) scale(${visible ? 1 : 0.72})`,
        transition: `opacity 380ms ${EASE_OUT}, transform 560ms ${EASE_OUT}`,
      }}
    >
      <span className="grid size-24 place-items-center rounded-full bg-bg ring-1 ring-line-strong">
        <span className="block size-12 [&>svg]:size-12">
          <SoteriaMark />
        </span>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Scorecard                                                          */
/* ------------------------------------------------------------------ */

/*
  The settled card is the summary state, not the diagnostic pass: high-risk
  work is resolved, so the rubrics read as one calm, cleared row. Gap colour
  stays where it carries information, in the streams and in the pipeline.
*/
function ReadinessCard({ settled }: { settled: boolean }) {
  return (
    <div
      className="sheet relative overflow-hidden rounded-card p-5"
      style={{
        opacity: settled ? 1 : 0,
        clipPath: settled ? 'inset(0 0 0 0)' : 'inset(0 0 100% 0)',
        transform: settled ? 'translateY(0)' : 'translateY(8px)',
        transition: `opacity 480ms ${EASE_OUT} 120ms, clip-path 620ms ${EASE_OUT} 120ms, transform 480ms ${EASE_OUT} 120ms`,
      }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line pb-3.5">
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] text-faint">ai readiness scorecard</p>
          <p className="mt-1 truncate font-serif text-[15px] text-fg">example.com</p>
        </div>
        <span className="inline-flex h-6 shrink-0 items-center rounded-control bg-white/[0.06] px-2 font-mono text-[9px] tracking-[0.02em] text-soft ring-1 ring-inset ring-line-strong">
          Buyer-review ready
        </span>
      </div>

      <div className="mt-4 flex items-end gap-3">
        <span className="display text-[46px] leading-[0.85] tabular-nums text-fg">0</span>
        <span className="pb-0.5 text-[12.5px] leading-snug text-muted">
          high-risk gaps
          <br />
          across 7 rubrics
        </span>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1" aria-hidden>
        {RUBRICS.map((rubric) => (
          <span key={rubric.code} className="h-7 rounded-[2px] bg-plasma/45" />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 font-mono text-[9.5px] text-faint">
        <span>7 rubrics · 5 lower-risk gaps documented</span>
        <span>sample preview</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Hero                                                               */
/* ------------------------------------------------------------------ */

function firstVisit() {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    return !window.sessionStorage.getItem(SEQUENCE_KEY)
  } catch {
    return false
  }
}

export function OverviewHero() {
  const [play] = useState(firstVisit)
  const [phase, setPhase] = useState<Phase>(play ? 0 : 4)

  useEffect(() => {
    if (!play) return
    try {
      window.sessionStorage.setItem(SEQUENCE_KEY, '1')
    } catch {
      /* storage blocked: the sequence simply runs again */
    }
    const timers = SEQUENCE_MS.map((at, index) =>
      window.setTimeout(() => setPhase((index + 1) as Phase), at),
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [play])

  const settled = phase >= 3
  const copy = (delay: number): CSSProperties => ({
    opacity: settled ? 1 : 0,
    transform: settled ? 'translateY(0)' : 'translateY(14px)',
    transition: `opacity 460ms ${EASE_OUT} ${delay}ms, transform 620ms ${EASE_OUT} ${delay}ms`,
  })

  return (
    <section
      aria-labelledby="overview-title"
      className="relative isolate overflow-hidden pb-10 pt-12 sm:pt-14 lg:min-h-[560px] lg:pt-16"
    >
      {play && phase < 4 ? (
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
          <StreamLayer phase={phase} />
          <NoiseField phase={phase} />
          <Scanner phase={phase} />
          <StreamChips phase={phase} />
          <BrandResolve phase={phase} />
        </div>
      ) : null}

      <div className="relative z-10 grid grid-cols-1 items-center gap-9 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <div>
          <div style={copy(0)}>
            <Eyebrow>AI governance workspace</Eyebrow>
          </div>
          <h1
            id="overview-title"
            className="display mt-3 max-w-[700px] text-balance text-[38px] sm:text-[50px]"
            style={copy(70)}
          >
            Unblock enterprise deals. Master AI operational readiness.
          </h1>
          <p className="mt-4 max-w-[560px] text-pretty text-[16.5px] leading-[1.6] text-muted" style={copy(150)}>
            Soteria provides fast diagnostics for Series A/B AI startups, powered by the Aegis engine.
          </p>
          <p className="mt-4 font-mono text-[10.5px] text-faint" style={copy(220)}>
            Technical readiness, not legal advice.
          </p>
        </div>

        <ReadinessCard settled={settled} />
      </div>
    </section>
  )
}
