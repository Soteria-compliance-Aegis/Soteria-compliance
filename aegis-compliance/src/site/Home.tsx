import { ArrowRight, ArrowUpRight, Check, Minus, Plus, X } from 'lucide-react'
import { motion, useReducedMotion, useScroll, useSpring } from 'motion/react'
import { useRef } from 'react'

import { cx } from '../lib/cx'
import { Link } from '../lib/router'
import { Reveal } from '../lib/useReveal'
import { track } from '../lib/analytics'
import { FAQ, FRAMEWORKS, PROBLEM, PRODUCT, SAMPLE, STEPS, TIERS } from './content'
import { LeadForm } from './LeadForm'

/* ---------------------------------------------------------------- hero */

/** The accent word: crisp orchid on top of a breathing motion-blur ghost. */
function Streak({ children }: { children: string }) {
  const reduce = useReducedMotion()
  return (
    <span className="relative inline-block">
      <span
        aria-hidden
        className="absolute inset-0 text-plasma blur-[14px]"
        style={reduce ? { opacity: 0.5 } : { animation: 'streak 5s ease-in-out infinite', transformOrigin: '30% 50%' }}
      >
        {children}
      </span>
      <motion.span
        className="relative text-plasma"
        initial={reduce ? false : { opacity: 0, filter: 'blur(18px)', x: -30 }}
        animate={{ opacity: 1, filter: 'blur(0px)', x: 0 }}
        transition={{ duration: 1.1, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.span>
    </span>
  )
}

const STATUS_STYLE: Record<string, string> = {
  Fail: 'bg-fail/12 text-fail ring-fail/30',
  Warning: 'bg-warn/12 text-warn ring-warn/30',
  Pass: 'bg-pass/12 text-pass ring-pass/30',
  'N/A (Out of Scope)': 'bg-black/[0.06] text-muted ring-black/15',
}

function Chip({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-control px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] ring-1 ring-inset',
        STATUS_STYLE[status] ?? STATUS_STYLE.Pass,
        className,
      )}
    >
      {status === 'N/A (Out of Scope)' ? 'Out of scope' : status}
    </span>
  )
}

/** A policy sheet being read: lines, a highlighted clause, a sweeping beam and graded callouts. */
function HeroDoc() {
  const reduce = useReducedMotion()
  const lines = [92, 78, 96, 64, 88, 0, 74, 91, 58, 84, 70]
  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <div aria-hidden className="absolute -inset-10 -z-10 rounded-full bg-plasma/25 blur-[90px]" />
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 40, rotate: 2 }}
        animate={{ opacity: 1, y: 0, rotate: -1.2 }}
        transition={{ duration: 1, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-[22px] bg-raised p-6 shadow-[0_50px_90px_-40px_rgba(5,5,5,0.45)] ring-1 ring-black/10 sm:p-8 pb-24 sm:pb-28"
      >
        <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">
          <span>privacy-policy.pdf</span>
          <span>Page 3 of 9</span>
        </div>
        <p className="mt-5 text-[15px] font-semibold tracking-[-0.01em] text-fg">7. Automated processing</p>
        <div className="mt-4 space-y-[9px]">
          {lines.map((w, i) =>
            w === 0 ? (
              <div key={i} className="h-3" />
            ) : (
              <div key={i} className="h-[7px] rounded-full bg-black/[0.09]" style={{ width: `${w}%` }} />
            ),
          )}
        </div>
        <p className="mt-6 text-[14px] leading-relaxed text-soft">
          <span className="mark" style={{ ['--mark-delay' as string]: '1.2s' }}>
            We may use automated processing to improve our services.
          </span>{' '}
          Nothing further is said about decisions.
        </p>
        {reduce ? null : (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-full">
            <div className="h-24 w-full bg-gradient-to-b from-transparent via-plasma/25 to-transparent" style={{ animation: 'scan 5.5s ease-in-out infinite 1s' }}>
              <div className="mt-[46px] h-px w-full bg-plasma" />
            </div>
          </div>
        )}
      </motion.div>

      <motion.div
        initial={reduce ? false : { opacity: 0, x: 24, y: 10 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ duration: 0.8, delay: 1.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute -right-2 -top-6 w-[210px] rounded-[18px] bg-ink p-4 text-cream shadow-[0_30px_60px_-30px_rgba(5,5,5,0.6)] sm:-right-10"
      >
        <div className="eyebrow-mono text-cream/50">Overall</div>
        <div className="mt-1 flex items-end justify-between">
          <span className="site-display text-[54px] leading-none">B−</span>
          <span className="pb-1 font-mono text-[11px] text-cream/60">7 rubrics</span>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span key={i} className={cx('h-1.5 flex-1 rounded-full', i < 2 ? 'bg-[#e0634b]' : i < 4 ? 'bg-[#d9a03a]' : i < 6 ? 'bg-[#5fbf8a]' : 'bg-cream/25')} />
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={reduce ? false : { opacity: 0, x: -24, y: 10 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ duration: 0.8, delay: 1.8, ease: [0.22, 1, 0.36, 1] }}
        className="absolute -bottom-9 -left-2 w-[270px] rounded-[18px] bg-raised p-4 shadow-[0_30px_60px_-30px_rgba(5,5,5,0.4)] ring-1 ring-black/10 sm:-left-12"
      >
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-fg">California ADMT</span>
          <Chip status="Fail" />
        </div>
        <p className="mt-2 text-[12.5px] leading-snug text-muted">No pre-use notice, opt-out or human-review route in the supplied text.</p>
        <p className="mt-2 border-l-2 border-plasma pl-2.5 font-mono text-[11px] leading-snug text-soft">"…automated processing to improve our services."</p>
      </motion.div>
    </div>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden pt-28 sm:pt-32">
      <div aria-hidden className="grid-lines pointer-events-none absolute inset-0 mx-auto max-w-[1240px]" />
      <div className="relative mx-auto grid max-w-[1240px] gap-16 px-5 pb-28 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:gap-10 lg:pb-36">
        <div>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="eyebrow-mono flex items-center gap-2.5 text-soft"
          >
            <span className="size-1.5 rounded-full bg-plasma" />
            AI regulatory risk audits for US Series A and B
          </motion.p>
          <h1 className="site-display mt-6 text-[clamp(48px,7.4vw,108px)]">
            <span className="block">Pass enterprise</span>
            <span className="block">AI review in</span>
            <span className="block">
              <Streak>days</Streak>, not
            </span>
            <span className="block">quarters.</span>
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 max-w-[520px] text-[18px] leading-[1.5] text-soft"
          >
            Soteria grades your privacy policy and AI disclosures against seven regulations, quotes the exact sentence behind every finding, and hands
            you the fix your buyer's reviewer wants to see.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.85, ease: [0.22, 1, 0.36, 1] }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <Link
              href="/#request"
              onClick={() => track('cta_clicked', { where: 'hero' })}
              className="inline-flex h-[54px] items-center gap-2 rounded-control bg-ink px-7 text-[16px] font-medium text-cream transition-colors hover:bg-plasma hover:text-ink"
            >
              Request a free scorecard
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/sample"
              className="inline-flex h-[54px] items-center gap-2 rounded-control px-6 text-[16px] font-medium text-fg ring-1 ring-inset ring-line-strong transition-colors hover:bg-black/[0.05]"
            >
              See a sample
            </Link>
          </motion.div>
        </div>
        <div className="pb-10 pt-4 lg:pb-0">
          <HeroDoc />
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------- marquee */

function Marquee() {
  const names = FRAMEWORKS.map((f) => f.short)
  const row = [...names, ...names]
  return (
    <section aria-label="Frameworks we grade against" className="border-y border-line bg-surface py-5">
      <div className="flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
        <ul className="flex shrink-0 items-center gap-12 pr-12" style={{ animation: 'marquee 38s linear infinite' }}>
          {row.map((n, i) => (
            <li key={i} className="flex items-center gap-12 whitespace-nowrap text-[15px] font-medium text-soft">
              {n}
              <span aria-hidden className="size-1.5 rounded-full bg-plasma" />
            </li>
          ))}
        </ul>
        <ul aria-hidden className="flex shrink-0 items-center gap-12 pr-12" style={{ animation: 'marquee 38s linear infinite' }}>
          {row.map((n, i) => (
            <li key={i} className="flex items-center gap-12 whitespace-nowrap text-[15px] font-medium text-soft">
              {n}
              <span className="size-1.5 rounded-full bg-plasma" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------- sections */

function SectionHead({ eyebrow, title, body, className }: { eyebrow: string; title: string; body?: string; className?: string }) {
  return (
    <Reveal className={cx('max-w-[760px]', className)}>
      <p className="eyebrow-mono text-faint">{eyebrow}</p>
      <h2 className="site-display mt-4 text-[clamp(38px,6vw,76px)]">{title}</h2>
      {body ? <p className="mt-5 max-w-[560px] text-[17px] leading-relaxed text-muted">{body}</p> : null}
    </Reveal>
  )
}

function Problem() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-28 sm:px-8 sm:py-36">
      <SectionHead eyebrow="The problem" title="The deal is ready. The review is not." />
      <div className="mt-16 grid gap-px overflow-hidden rounded-[24px] bg-line ring-1 ring-line md:grid-cols-3">
        {PROBLEM.map((p, i) => (
          <Reveal key={p.n} delay={i * 0.08} className="bg-bg p-8 sm:p-10">
            <span className="font-mono text-[12px] text-plasma-text">{p.n}</span>
            <h3 className="mt-14 text-[24px] font-semibold leading-tight tracking-[-0.025em]">{p.title}</h3>
            <p className="mt-3 text-[15.5px] leading-relaxed text-muted">{p.body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

function Product() {
  return (
    <section id="product" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 pb-28 sm:px-8 sm:pb-36">
      <SectionHead
        eyebrow="Product"
        title="Five checks. One evidence trail."
        body="Each finding points back to a sentence you wrote, so your counsel, your buyer and your engineers argue about the same text."
      />
      <div className="mt-14 grid gap-4 md:grid-cols-6">
        {PRODUCT.map((p, i) => {
          const span = i === 0 ? 'md:col-span-4' : i === 1 ? 'md:col-span-2' : i === 2 ? 'md:col-span-2' : i === 3 ? 'md:col-span-2' : 'md:col-span-2'
          const dark = i === 0 || i === 3
          return (
            <Reveal key={p.id} delay={(i % 3) * 0.07} className={span}>
              <article
                className={cx(
                  'group relative flex h-full min-h-[300px] flex-col justify-between overflow-hidden rounded-[26px] p-8 transition-transform duration-500 hover:-translate-y-1',
                  dark ? 'bg-ink text-cream' : 'bg-surface ring-1 ring-line',
                )}
              >
                <div>
                  <span className={cx('eyebrow-mono', dark ? 'text-cream/50' : 'text-faint')}>{p.meta}</span>
                  <h3 className="mt-4 text-[28px] font-semibold leading-tight tracking-[-0.03em]">{p.title}</h3>
                  <p className={cx('mt-3 max-w-[460px] text-[15.5px] leading-relaxed', dark ? 'text-cream/70' : 'text-muted')}>{p.body}</p>
                </div>
                <ProductArt id={p.id} dark={dark} />
              </article>
            </Reveal>
          )
        })}
      </div>
    </section>
  )
}

/** Small abstract illustrations, drawn in CSS so they stay on-palette. */
function ProductArt({ id, dark }: { id: string; dark: boolean }) {
  const base = dark ? 'bg-cream/15' : 'bg-black/10'
  if (id === 'audit')
    return (
      <div className="mt-8 grid grid-cols-7 gap-2" aria-hidden>
        {['Fail', 'Fail', 'Warning', 'Warning', 'Pass', 'Pass', 'N/A'].map((s, i) => (
          <div key={i} className="rounded-xl bg-cream/10 p-2.5">
            <div className={cx('h-1.5 w-full rounded-full', s === 'Fail' ? 'bg-[#e0634b]' : s === 'Warning' ? 'bg-[#d9a03a]' : s === 'Pass' ? 'bg-[#5fbf8a]' : 'bg-cream/30')} />
            <div className="mt-3 space-y-1.5">
              <div className="h-1 rounded-full bg-cream/25" />
              <div className="h-1 w-2/3 rounded-full bg-cream/25" />
            </div>
          </div>
        ))}
      </div>
    )
  if (id === 'diff')
    return (
      <div className="mt-8 grid grid-cols-2 gap-2" aria-hidden>
        <div className="rounded-xl bg-raised p-3 ring-1 ring-line"><div className="h-1.5 w-full rounded-full bg-plasma/70" /><div className="mt-2 h-1.5 w-2/3 rounded-full bg-black/10" /></div>
        <div className="rounded-xl bg-raised p-3 ring-1 ring-line"><div className="h-1.5 w-full rounded-full bg-black/10" /><div className="mt-2 h-1.5 w-1/2 rounded-full bg-black/10" /></div>
      </div>
    )
  if (id === 'redteam')
    return (
      <div className="mt-8 flex gap-1.5" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className={cx('h-7 flex-1 rounded-md', i === 2 || i === 6 ? 'bg-plasma' : base)} />
        ))}
      </div>
    )
  if (id === 'fix')
    return (
      <div className="mt-8 space-y-2 rounded-xl bg-cream/10 p-3 font-mono text-[11px] leading-snug text-cream/70" aria-hidden>
        <div><span className="text-[#e0634b]">− </span>We may use automated processing.</div>
        <div><span className="text-[#5fbf8a]">+ </span>Automated tools score applicants. You can opt out and ask for human review.</div>
      </div>
    )
  return (
    <div className="mt-8 flex items-end gap-1.5" aria-hidden>
      {[30, 44, 36, 58, 40, 72, 50].map((h, i) => (
        <span key={i} className={cx('flex-1 rounded-t-md', i === 5 ? 'bg-plasma' : base)} style={{ height: h }} />
      ))}
    </div>
  )
}

function How() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 70%', 'end 60%'] })
  const grow = useSpring(scrollYProgress, { stiffness: 120, damping: 24 })
  return (
    <section id="how" className="scroll-mt-20 bg-surface py-28 sm:py-36">
      <div className="mx-auto grid max-w-[1240px] gap-16 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <SectionHead eyebrow="How it works" title="From policy to proof in four steps." body="No product access is needed for the first scorecard. A person signs off before anything reaches you." />
        </div>
        <div ref={ref} className="relative pl-10 sm:pl-14">
          <div aria-hidden className="absolute bottom-0 left-[11px] top-2 w-px bg-line-strong sm:left-[15px]" />
          <motion.div aria-hidden style={{ scaleY: grow }} className="absolute bottom-0 left-[10px] top-2 w-[3px] origin-top rounded-full bg-plasma sm:left-[14px]" />
          <ol className="space-y-16">
            {STEPS.map((s) => (
              <Reveal as="li" key={s.n} className="relative">
                <span className="absolute -left-10 top-0 grid size-6 place-items-center rounded-full bg-ink font-mono text-[11px] text-cream sm:-left-14 sm:size-8 sm:text-[12px]">{s.n}</span>
                <h3 className="text-[26px] font-semibold tracking-[-0.03em]">{s.title}</h3>
                <p className="mt-2.5 max-w-[520px] text-[16px] leading-relaxed text-muted">{s.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

function SampleTeaser() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-28 sm:px-8 sm:py-36">
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <SectionHead eyebrow="Sample scorecard" title="This is what you get back." body={SAMPLE.note} />
        <Reveal>
          <div className="rounded-[28px] bg-raised p-6 shadow-[0_50px_90px_-50px_rgba(5,5,5,0.5)] ring-1 ring-line sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow-mono text-faint">Scorecard · {SAMPLE.company}</p>
                <p className="mt-2 text-[13.5px] text-muted">{SAMPLE.summary}</p>
              </div>
              <span className="site-display text-[64px] leading-none">{SAMPLE.grade}</span>
            </div>
            <ul className="mt-6 divide-y divide-line">
              {SAMPLE.rows.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-4 py-3.5">
                  <span className="text-[15px] font-medium">{r.name}</span>
                  <Chip status={r.status} />
                </li>
              ))}
            </ul>
            <Link href="/sample" className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-medium underline decoration-plasma decoration-2 underline-offset-[6px]">
              Read the full sample <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-20 bg-ink py-28 text-cream sm:py-36">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <Reveal className="max-w-[760px]">
          <p className="eyebrow-mono text-cream/50">Pricing</p>
          <h2 className="site-display mt-4 text-[clamp(38px,6vw,76px)]">Start free. Scope the rest together.</h2>
          <p className="mt-5 max-w-[560px] text-[17px] leading-relaxed text-cream/65">
            We price the core audit and the retainer to your product and number of surfaces, so we quote after a short call.
          </p>
        </Reveal>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {TIERS.map((t, i) => (
            <Reveal key={t.id} delay={i * 0.08}>
              <article
                className={cx(
                  'flex h-full flex-col rounded-[26px] p-8',
                  t.featured ? 'bg-plasma text-ink' : 'bg-cream/[0.06] ring-1 ring-inset ring-cream/15',
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-[24px] font-semibold tracking-[-0.03em]">{t.name}</h3>
                  <span className={cx('eyebrow-mono', t.featured ? 'text-ink/70' : 'text-cream/50')}>{t.tag}</span>
                </div>
                <p className={cx('mt-2 text-[15px]', t.featured ? 'text-ink/75' : 'text-cream/65')}>{t.blurb}</p>
                <ul className="mt-7 flex-1 space-y-3">
                  {t.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2.5 text-[15px] leading-snug">
                      <Check className={cx('mt-0.5 size-4 shrink-0', t.featured ? 'text-ink' : 'text-plasma')} aria-hidden />
                      {pt}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/#request"
                  onClick={() => track('cta_clicked', { where: `pricing_${t.id}` })}
                  className={cx(
                    'mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-control text-[15px] font-medium transition-colors',
                    t.featured ? 'bg-ink text-cream hover:bg-cream hover:text-ink' : 'bg-cream text-ink hover:bg-plasma',
                  )}
                >
                  {t.cta} <ArrowRight className="size-4" aria-hidden />
                </Link>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function Faq() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-28 sm:px-8 sm:py-36">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHead eyebrow="FAQ" title="Straight answers." />
        <div className="divide-y divide-line-strong border-y border-line-strong">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[19px] font-medium tracking-[-0.015em] [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="grid size-8 shrink-0 place-items-center rounded-full ring-1 ring-inset ring-line-strong">
                  <Plus className="size-4 group-open:hidden" aria-hidden />
                  <Minus className="hidden size-4 group-open:block" aria-hidden />
                </span>
              </summary>
              <p className="mt-4 max-w-[620px] text-[16px] leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

export function RequestSection() {
  return (
    <section id="request" className="scroll-mt-16 px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="relative mx-auto max-w-[1360px] overflow-hidden rounded-[32px] bg-ink px-6 py-20 text-cream sm:rounded-[40px] sm:px-12 sm:py-28">
        <div aria-hidden className="absolute -right-40 -top-40 size-[520px] rounded-full bg-plasma/30 blur-[120px]" />
        <div className="relative grid gap-14 lg:grid-cols-[1fr_1fr]">
          <Reveal>
            <p className="eyebrow-mono text-cream/50">Request a scorecard</p>
            <h2 className="site-display mt-4 text-[clamp(40px,6.4vw,88px)]">
              Find the gaps before your <span className="text-plasma">buyer</span> does.
            </h2>
            <ul className="mt-8 space-y-3 text-[16px] text-cream/75">
              {['One page across seven rubrics', 'Your top three gaps, quoted from your own text', 'A person verifies it before it reaches you'].map((x) => (
                <li key={x} className="flex items-center gap-3">
                  <Check className="size-4 text-plasma" aria-hidden /> {x}
                </li>
              ))}
            </ul>
            <p className="mt-8 flex items-start gap-2 text-[13px] leading-relaxed text-cream/50">
              <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Not legal advice. A technical risk assessment of the text you send.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-[26px] bg-cream/[0.05] p-6 ring-1 ring-inset ring-cream/10 sm:p-8">
              <LeadForm dark />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

export function Home() {
  return (
    <>
      <Hero />
      <Marquee />
      <Problem />
      <Product />
      <How />
      <SampleTeaser />
      <Pricing />
      <Faq />
      <RequestSection />
    </>
  )
}
