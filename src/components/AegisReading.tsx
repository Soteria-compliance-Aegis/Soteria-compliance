import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'

import { cx } from '../lib/cx'
import { Eyebrow } from './Typography'

/*
  The reading pass.

  Documents are laid on the bench and read. As the section scrolls, three
  paper sheets arrive, settle into a quiet stack, and resolve into the
  scorecard the buyer reads. The camera never moves: only the sheets, their
  opacity and the card. Every animated property is transform or opacity, and
  the stage keeps a fixed height so nothing on the page shifts.

  The run is illustrative: the header says so, and the sheets are sample
  documents, not a live audit.
*/

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)
const unit = (progress: number, start: number, end: number) => clamp01((progress - start) / (end - start))

const PAPERS = [
  {
    name: 'product-claims.md',
    meta: '3 pages · 9 claims',
    at: 0.04,
    startX: -420,
    startY: 110,
    spreadX: -158,
    spreadY: -46,
    rotate: -8,
  },
  {
    name: 'privacy-notice.md',
    meta: '1 doc · 34 clauses',
    at: 0.1,
    startX: 420,
    startY: 90,
    spreadX: 158,
    spreadY: 40,
    rotate: 7,
  },
  {
    name: 'ai-disclosure.md',
    meta: '1 doc · 12 clauses',
    at: 0.16,
    startX: -60,
    startY: -380,
    spreadX: -18,
    spreadY: -118,
    rotate: 3,
  },
] as const

const RUBRIC_ROWS = [
  { name: 'FTC §5 — claim substantiation', verdict: 'gap' },
  { name: 'California ADMT — pre-use notice', verdict: 'gap' },
  { name: 'Colorado SB 26-189 — risk assessment', verdict: 'clear' },
  { name: 'Texas TRAIGA — bias testing', verdict: 'gap' },
  { name: 'NYC LL144 — audit summary', verdict: 'gap' },
  { name: 'Illinois HB 3773 — accommodation', verdict: 'clear' },
  { name: 'India DPDP — consent notice', verdict: 'gap' },
] as const

const TICKER = [
  'FTC §5 claim substantiation',
  'California ADMT',
  'Colorado SB 26-189',
  'Texas TRAIGA',
  'NYC Local Law 144',
  'Illinois HB 3773',
  'India DPDP',
  'Enforcement window 2027',
]

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches))
  useEffect(() => {
    const mq = window.matchMedia(query)
    const sync = () => setMatches(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return matches
}

/* ------------------------------------------------------------------ */
/* Artwork                                                            */
/* ------------------------------------------------------------------ */

function Paper({ paper }: { paper: (typeof PAPERS)[number] }) {
  return (
    <div className="w-[196px] rounded-[10px] bg-[#e9edf4] p-3 text-[#141821] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.95)] ring-1 ring-black/5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[8.5px] tracking-[0.01em] text-[#141821]/70">{paper.name}</span>
        <span className="round size-1.5 shrink-0 rounded-full bg-[#3f68d8]/70" />
      </div>
      <div className="mt-2 flex flex-col gap-[5px]">
        {[96, 74, 88, 62, 92, 70, 84].map((width, index) => (
          <span key={index} className="h-[2px] rounded-full bg-[#141821]/12" style={{ width: `${width}%` }} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-[#141821]/10 pt-2 font-mono text-[8px] text-[#141821]/70">
        <span>{paper.meta}</span>
        <span className="inline-flex items-center gap-1 text-[#2a4c9e]">
          <Check className="size-2.5" strokeWidth={3} aria-hidden />
          read
        </span>
      </div>
    </div>
  )
}

function paperStyle(paper: (typeof PAPERS)[number], p: number, still: boolean): CSSProperties {
  if (still) {
    return {
      opacity: 0.92,
      transform: `translate(-50%, -50%) translate3d(${paper.spreadX}px, ${paper.spreadY}px, 0) rotate(${paper.rotate}deg)`,
    }
  }
  const enter = unit(p, paper.at - 0.12, paper.at + 0.12)
  const gather = unit(p, 0.46, 0.82)
  const x = paper.startX * (1 - enter) + paper.spreadX * gather * 0.4
  const y = paper.startY * (1 - enter) + paper.spreadY * gather * 0.4
  return {
    opacity: enter * (1 - gather),
    transform: `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) rotate(${paper.rotate}deg) scale(${1 - gather * 0.14})`,
  }
}

function Scorecard({ p, still }: { p: number; still: boolean }) {
  const card = still ? 1 : unit(p, 0.44, 0.74)
  const graded = still ? 7 : Math.round(unit(p, 0.1, 0.6) * 7)

  return (
    <div
      className="absolute left-1/2 top-1/2 w-[min(330px,86%)] rounded-[14px] border border-line-strong bg-surface-2 p-4 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.95)]"
      style={{
        opacity: card,
        transform: `translate(-50%, -50%) translateY(${(1 - card) * 20}px) scale(${0.985 + card * 0.015})`,
      }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <p className="font-mono text-[9.5px] text-faint">ai readiness scorecard</p>
          <p className="mt-1 truncate font-serif text-[16px] text-fg">example.com</p>
        </div>
        <span className="inline-flex h-6 shrink-0 items-center rounded-control bg-white/[0.06] px-2 font-mono text-[8.5px] text-soft ring-1 ring-inset ring-line-strong">
          {graded} of 7 graded
        </span>
      </div>

      <ul className="mt-1 flex flex-col">
        {RUBRIC_ROWS.map((row, index) => {
          const amount = still ? 1 : unit(p, 0.3 + index * 0.035, 0.44 + index * 0.035)
          return (
            <li
              key={row.name}
              className="flex items-center justify-between gap-3 border-b border-line py-1.5 last:border-0"
              style={{ opacity: amount }}
            >
              <span className="min-w-0 truncate text-[11px] text-soft">{row.name}</span>
              <span
                className={cx('round size-1.5 shrink-0 rounded-full', row.verdict === 'gap' ? 'bg-fire-2' : 'bg-plasma-text')}
                aria-hidden
              />
            </li>
          )
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5 font-mono text-[9px] text-faint">
        <span>5 open · 2 clear</span>
        <span>sample preview</span>
      </div>
    </div>
  )
}

function ReaderStage({ p, still }: { p: number; still: boolean }) {
  const clauses = still ? 142 : Math.round(unit(p, 0.04, 0.62) * 142)

  return (
    <div
      className="depth relative h-full overflow-hidden rounded-panel border border-line-strong bg-[radial-gradient(85%_110%_at_50%_105%,#131a29_0%,#0d1017_55%,#0a0b0d_100%)]"
      role="img"
      aria-label="Sample documents being read by Aegis and resolved into an AI readiness scorecard"
    >
      <div className="absolute inset-x-0 top-0 flex h-10 items-center justify-between gap-3 border-b border-line px-4 font-mono text-[10.5px]" aria-hidden>
        <span className="flex items-baseline gap-1.5">
          <span className="text-soft">aegis</span>
          <span className="text-faint">/ reading pass</span>
        </span>
        <span className="truncate text-faint">illustrative · sample documents</span>
      </div>

      <div className="absolute inset-x-0 bottom-9 top-10" aria-hidden>
        <span aria-hidden className="absolute left-3 top-3 size-3 border-l border-t border-line-strong" />
        <span aria-hidden className="absolute right-3 top-3 size-3 border-r border-t border-line-strong" />
        <span aria-hidden className="absolute bottom-3 left-3 size-3 border-b border-l border-line-strong" />
        <span aria-hidden className="absolute bottom-3 right-3 size-3 border-b border-r border-line-strong" />

        {PAPERS.map((paper) => (
          <div key={paper.name} className="absolute left-1/2 top-1/2" style={paperStyle(paper, p, still)}>
            <Paper paper={paper} />
          </div>
        ))}

        <Scorecard p={p} still={still} />
      </div>

      <div className="absolute inset-x-0 bottom-0 flex h-9 items-center justify-between gap-3 px-4 font-mono text-[10px]" aria-hidden>
        <span className="tabular-nums text-soft">{clauses} of 142 clauses read</span>
        <span className="tabular-nums text-faint">{still ? 'pass complete' : `${Math.round(unit(p, 0, 0.7) * 100)}% read`}</span>
      </div>
    </div>
  )
}

function Ticker() {
  const row = (
    <div className="flex shrink-0 items-center gap-8 pr-8">
      {TICKER.map((item) => (
        <span key={item} className="flex items-center gap-8 whitespace-nowrap font-mono text-[10.5px] text-faint">
          {item}
          <span className="round size-1 rounded-full bg-line-strong" aria-hidden />
        </span>
      ))}
    </div>
  )
  return (
    <div
      className="mt-5 overflow-hidden border-y border-line py-3 [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]"
      aria-hidden
    >
      <div className="flex w-max animate-[marquee_46s_linear_infinite] motion-reduce:animate-none">
        {row}
        {row}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Section                                                            */
/* ------------------------------------------------------------------ */

function Copy({ p, still }: { p: number; still: boolean }) {
  const line = (index: number): CSSProperties => {
    if (still) return {}
    const amount = 0.5 + 0.5 * unit(p, 0.02 + index * 0.05, 0.14 + index * 0.05)
    return { opacity: amount, transform: `translateY(${(1 - amount) * 8}px)` }
  }

  return (
    <div>
      <Eyebrow>Diagnostic pass</Eyebrow>
      <h2 id="reading-title" className="display mt-3 max-w-[520px] text-[34px] leading-[1.02] sm:text-[42px] lg:text-[46px]">
        <span className="block" style={line(0)}>
          It reads the clause
        </span>
        <span className="block" style={line(1)}>
          before it grades
        </span>
        <span className="block" style={line(2)}>
          the claim.
        </span>
      </h2>
      <p className="mt-4 max-w-[470px] text-pretty text-[15.5px] leading-[1.6] text-muted">
        The homepage, the privacy notice and the AI disclosure go in together. Aegis reads every clause, grades the seven
        rubrics, and quotes the line behind each finding.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10.5px] text-faint">
        <span className="tabular-nums">142 clauses read</span>
        <span className="tabular-nums">7 rubrics graded</span>
        <span className="tabular-nums">5 findings quoted</span>
      </div>
    </div>
  )
}

export function AegisReading() {
  const desktop = useMedia('(min-width: 1024px)')
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const choreographed = desktop && !reduced
  const track = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!choreographed) {
      setProgress(0)
      return
    }
    let raf = 0
    const measure = () => {
      raf = 0
      const node = track.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const sticky = window.innerHeight - 64
      const travel = Math.max(1, rect.height - sticky)
      const next = clamp01((64 - rect.top) / travel)
      setProgress(Math.round(next * 400) / 400)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [choreographed])

  if (!choreographed) {
    return (
      <section aria-labelledby="reading-title" className="mt-8 border-t border-line pt-10">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div>
            <Eyebrow>Diagnostic pass</Eyebrow>
            <h2 id="reading-title" className="display mt-3 max-w-[520px] text-[34px] leading-[1.02] sm:text-[42px]">
              It reads the clause
              <br />
              before it grades
              <br />
              the claim.
            </h2>
            <p className="mt-4 max-w-[470px] text-pretty text-[15.5px] leading-[1.6] text-muted">
              The homepage, the privacy notice and the AI disclosure go in together. Aegis reads every clause, grades the
              seven rubrics, and quotes the line behind each finding.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10.5px] text-faint">
              <span>142 clauses read</span>
              <span>7 rubrics graded</span>
              <span>5 findings quoted</span>
            </div>
          </div>
          <div className="h-[420px] sm:h-[480px]">
            <ReaderStage p={1} still />
          </div>
        </div>
        <Ticker />
      </section>
    )
  }

  return (
    <section aria-labelledby="reading-title" className="mt-8">
      <div ref={track} className="lg:h-[200vh]">
        <div className="lg:sticky lg:top-16 lg:flex lg:h-[calc(100svh-4rem)] lg:flex-col lg:justify-center">
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10">
            <Copy p={progress} still={false} />
            <div className="h-[440px] sm:h-[500px] lg:h-[min(560px,calc(100svh-9.5rem))]">
              <ReaderStage p={progress} still={false} />
            </div>
          </div>
          <Ticker />
        </div>
      </div>
    </section>
  )
}
