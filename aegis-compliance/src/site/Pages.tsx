import { ArrowLeft, ArrowRight, ArrowUpRight, Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import { Link } from '../lib/router'
import { Reveal } from '../lib/useReveal'
import { FRAMEWORKS, POSTS, SAMPLE, SECURITY, SITE, TEAM } from './content'
import { RequestSection } from './Home'

function PageHead({ eyebrow, title, body, children }: { eyebrow: string; title: ReactNode; body?: string; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden pt-32 sm:pt-40">
      <div aria-hidden className="grid-lines pointer-events-none absolute inset-0 mx-auto max-w-[1240px]" />
      <div className="relative mx-auto max-w-[1240px] px-5 pb-16 sm:px-8 sm:pb-24">
        <p className="eyebrow-mono text-faint">{eyebrow}</p>
        <h1 className="site-display mt-5 max-w-[980px] text-[clamp(44px,8vw,112px)]">{title}</h1>
        {body ? <p className="mt-7 max-w-[620px] text-[18px] leading-relaxed text-soft">{body}</p> : null}
        {children}
      </div>
    </section>
  )
}

const STATUS: Record<string, string> = {
  Fail: 'bg-fail/12 text-fail ring-fail/30',
  Warning: 'bg-warn/12 text-warn ring-warn/30',
  Pass: 'bg-pass/12 text-pass ring-pass/30',
  'N/A (Out of Scope)': 'bg-black/[0.06] text-muted ring-black/15',
}

function Pill({ status }: { status: string }) {
  return (
    <span className={cx('inline-flex items-center rounded-control px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] ring-1 ring-inset', STATUS[status])}>
      {status === 'N/A (Out of Scope)' ? 'Out of scope' : status}
    </span>
  )
}

/* ------------------------------------------------------------ frameworks */

export function FrameworksIndex() {
  return (
    <>
      <PageHead
        eyebrow="Frameworks"
        title="Seven rubrics. One reading of your text."
        body="Applicability is decided before grading, so a consumer privacy notice is never failed for missing a hiring-bias audit. Dates are checked by a person against the source before every client report."
      />
      <section className="mx-auto max-w-[1240px] px-5 pb-28 sm:px-8">
        <ul className="divide-y divide-line-strong border-y border-line-strong">
          {FRAMEWORKS.map((f, i) => (
            <Reveal as="li" key={f.slug} delay={i * 0.04}>
              <Link href={`/frameworks/${f.slug}`} className="group grid items-center gap-3 py-7 md:grid-cols-[1.2fr_1.5fr_auto] md:gap-8">
                <div>
                  <h2 className="text-[26px] font-semibold tracking-[-0.03em] transition-colors group-hover:text-plasma-text">{f.name}</h2>
                  <p className="mt-1 font-mono text-[12px] text-faint">{f.jurisdiction} · {f.date}</p>
                </div>
                <p className="max-w-[520px] text-[15px] leading-relaxed text-muted">{f.summary}</p>
                <span className="inline-flex items-center gap-3">
                  <span className={cx('eyebrow-mono rounded-control px-2.5 py-1 ring-1 ring-inset', f.status === 'In force' ? 'text-pass ring-pass/30' : 'text-warn ring-warn/30')}>{f.status}</span>
                  <ArrowUpRight className="size-5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </Reveal>
          ))}
        </ul>
      </section>
      <RequestSection />
    </>
  )
}

export function FrameworkDetail({ slug }: { slug: string }) {
  const idx = FRAMEWORKS.findIndex((f) => f.slug === slug)
  const f = FRAMEWORKS[idx]
  if (!f) return <NotFoundPage />
  const next = FRAMEWORKS[(idx + 1) % FRAMEWORKS.length]
  return (
    <>
      <PageHead eyebrow={`${f.jurisdiction} · ${f.status} · ${f.date}`} title={f.name} body={f.summary}>
        <Link href="/frameworks" className="mt-8 inline-flex items-center gap-2 text-[14px] text-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> All frameworks
        </Link>
      </PageHead>
      <section className="mx-auto grid max-w-[1240px] gap-4 px-5 pb-20 sm:px-8 lg:grid-cols-2">
        <Reveal>
          <div className="h-full rounded-[26px] bg-surface p-8 ring-1 ring-line sm:p-10">
            <p className="eyebrow-mono text-faint">Who it touches</p>
            <p className="mt-4 text-[20px] leading-snug tracking-[-0.015em]">{f.who}</p>
            {f.note ? <p className="mt-6 border-l-2 border-plasma pl-4 text-[14.5px] leading-relaxed text-muted">{f.note}</p> : null}
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="h-full rounded-[26px] bg-ink p-8 text-cream sm:p-10">
            <p className="eyebrow-mono text-cream/50">What Soteria checks</p>
            <ul className="mt-5 space-y-3.5">
              {f.checks.map((c) => (
                <li key={c} className="flex items-start gap-3 text-[16px] leading-snug">
                  <Check className="mt-0.5 size-4 shrink-0 text-plasma" aria-hidden /> {c}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal className="lg:col-span-2">
          <div className="rounded-[26px] p-8 ring-1 ring-line-strong sm:p-10">
            <p className="eyebrow-mono text-faint">Gaps we typically see</p>
            <ul className="mt-5 grid gap-6 md:grid-cols-3">
              {f.gaps.map((g) => (
                <li key={g} className="border-t-2 border-plasma pt-4 text-[15.5px] leading-relaxed text-soft">{g}</li>
              ))}
            </ul>
            <p className="mt-8 text-[13px] text-faint">{SITE.disclaimer}</p>
          </div>
        </Reveal>
      </section>
      <section className="mx-auto max-w-[1240px] px-5 pb-28 sm:px-8">
        <Link href={`/frameworks/${next.slug}`} className="group flex items-center justify-between rounded-[26px] bg-surface p-8 ring-1 ring-line transition-colors hover:bg-raised sm:p-10">
          <span>
            <span className="eyebrow-mono text-faint">Next framework</span>
            <span className="mt-2 block text-[28px] font-semibold tracking-[-0.03em]">{next.name}</span>
          </span>
          <ArrowRight className="size-7 transition-transform group-hover:translate-x-1" aria-hidden />
        </Link>
      </section>
      <RequestSection />
    </>
  )
}

/* ---------------------------------------------------------------- sample */

export function SamplePage() {
  return (
    <>
      <PageHead eyebrow="Sample scorecard" title={<>What <span className="text-plasma">you get</span> back.</>} body={SAMPLE.note} />
      <section className="mx-auto max-w-[1000px] px-5 pb-28 sm:px-8">
        <Reveal>
          <div className="rounded-[30px] bg-raised p-6 shadow-[0_60px_110px_-60px_rgba(5,5,5,0.55)] ring-1 ring-line sm:p-10">
            <div className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-8">
              <div>
                <p className="eyebrow-mono text-faint">AI regulatory scorecard</p>
                <h2 className="mt-2 text-[34px] font-semibold tracking-[-0.035em]">{SAMPLE.company}</h2>
                <p className="mt-1 text-[14px] text-muted">{SAMPLE.summary}</p>
              </div>
              <div className="text-right">
                <p className="eyebrow-mono text-faint">Overall</p>
                <p className="site-display text-[88px] leading-none">{SAMPLE.grade}</p>
              </div>
            </div>
            <ul className="divide-y divide-line">
              {SAMPLE.rows.map((r) => (
                <li key={r.id} className="grid gap-4 py-8 md:grid-cols-[220px_1fr]">
                  <div>
                    <p className="text-[17px] font-semibold tracking-[-0.02em]">{r.name}</p>
                    <div className="mt-2"><Pill status={r.status} /></div>
                  </div>
                  <div className="space-y-3">
                    {r.quote ? <blockquote className="border-l-2 border-plasma pl-4 font-mono text-[13px] leading-relaxed text-soft">{r.quote}</blockquote> : null}
                    <p className="text-[15.5px] leading-relaxed text-soft">{r.gap}</p>
                    {r.fix ? (
                      <p className="rounded-xl bg-surface px-4 py-3 text-[14.5px] leading-relaxed text-soft ring-1 ring-line">
                        <span className="eyebrow-mono mr-2 text-plasma-text">Fix</span>
                        {r.fix}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <p className="border-t border-line pt-6 text-[12.5px] leading-relaxed text-faint">{SITE.disclaimer}</p>
          </div>
        </Reveal>
      </section>
      <RequestSection />
    </>
  )
}

/* ----------------------------------------------------------- about etc. */

export function AboutPage() {
  return (
    <>
      <PageHead
        eyebrow="About"
        title={<>Compliance evidence, <span className="text-plasma">not</span> compliance theatre.</>}
        body="Soteria exists because AI startups lose enterprise deals to paperwork they could have fixed. We find the gap, quote the text and write the fix."
      />
      <section className="mx-auto grid max-w-[1240px] gap-4 px-5 pb-20 sm:px-8 md:grid-cols-3">
        {[
          ['Evidence first', 'If we cannot quote it from your document, we do not report it.'],
          ['People sign off', 'The model drafts. A person verifies every quote and rule date before a client sees it.'],
          ['Honest limits', 'We are a technical risk assessment. We never say violation, and we never give legal advice.'],
        ].map(([t, b], i) => (
          <Reveal key={t} delay={i * 0.07}>
            <div className="h-full rounded-[26px] bg-surface p-8 ring-1 ring-line">
              <h3 className="text-[24px] font-semibold tracking-[-0.03em]">{t}</h3>
              <p className="mt-3 text-[15.5px] leading-relaxed text-muted">{b}</p>
            </div>
          </Reveal>
        ))}
      </section>
      <section className="mx-auto max-w-[1240px] px-5 pb-28 sm:px-8">
        <p className="eyebrow-mono text-faint">Team</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {TEAM.map((m, i) => (
            <Reveal key={i}>
              <div className="flex gap-5 rounded-[26px] p-6 ring-1 ring-line-strong sm:p-8">
                <div aria-hidden className="size-20 shrink-0 rounded-2xl bg-gradient-to-br from-plasma/60 to-ink" />
                <div>
                  <h3 className="text-[22px] font-semibold tracking-[-0.025em]">{m.name}</h3>
                  <p className="font-mono text-[12px] text-faint">{m.role}</p>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{m.bio}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
      <RequestSection />
    </>
  )
}

export function SecurityPage() {
  return (
    <>
      <PageHead eyebrow="Security" title="What we store, and where it goes." body="Plain answers, so your security team can quote them." />
      <section className="mx-auto max-w-[1240px] px-5 pb-28 sm:px-8">
        <div className="grid gap-4 md:grid-cols-2">
          {SECURITY.map((s, i) => (
            <Reveal key={s.title} delay={(i % 2) * 0.06}>
              <div className="h-full rounded-[26px] bg-surface p-8 ring-1 ring-line">
                <h3 className="text-[22px] font-semibold tracking-[-0.025em]">{s.title}</h3>
                <p className="mt-3 text-[15.5px] leading-relaxed text-muted">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
      <RequestSection />
    </>
  )
}

/* ------------------------------------------------------------------ blog */

export function BlogIndex() {
  return (
    <>
      <PageHead eyebrow="Notes" title="Notes on AI rules, evidence and buyers." />
      <section className="mx-auto max-w-[1240px] px-5 pb-28 sm:px-8">
        <ul className="divide-y divide-line-strong border-y border-line-strong">
          {POSTS.map((p) => (
            <Reveal as="li" key={p.slug}>
              <Link href={`/blog/${p.slug}`} className="group grid gap-3 py-8 md:grid-cols-[160px_1fr_auto] md:items-center md:gap-8">
                <span className="font-mono text-[12px] text-faint">{p.date} · {p.read}</span>
                <div>
                  <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] group-hover:text-plasma-text">{p.title}</h2>
                  <p className="mt-2 max-w-[640px] text-[15px] text-muted">{p.excerpt}</p>
                </div>
                <ArrowUpRight className="size-5" aria-hidden />
              </Link>
            </Reveal>
          ))}
        </ul>
      </section>
    </>
  )
}

export function BlogPost({ slug }: { slug: string }) {
  const post = POSTS.find((p) => p.slug === slug)
  if (!post) return <NotFoundPage />
  return (
    <>
      <PageHead eyebrow={`${post.date} · ${post.read} read`} title={post.title}>
        <Link href="/blog" className="mt-8 inline-flex items-center gap-2 text-[14px] text-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> All notes
        </Link>
      </PageHead>
      <article className="mx-auto max-w-[720px] space-y-6 px-5 pb-20 text-[18px] leading-[1.7] text-soft sm:px-8">
        {post.body.map((para, i) => <p key={i}>{para}</p>)}
        <p className="border-t border-line pt-6 text-[13px] text-faint">{SITE.disclaimer}</p>
      </article>
      <RequestSection />
    </>
  )
}

export function NotFoundPage() {
  return (
    <PageHead eyebrow="404" title="Nothing on record here.">
      <Link href="/" className="mt-8 inline-flex h-12 items-center gap-2 rounded-control bg-ink px-6 text-[15px] font-medium text-cream hover:bg-plasma hover:text-ink">
        Back to the home page
      </Link>
    </PageHead>
  )
}
