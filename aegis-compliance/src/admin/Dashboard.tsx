import { ArrowUpRight, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cx } from '../lib/cx'
import { Link } from '../lib/router'
import { ago, fetchOverview, STAGES } from '../lib/portal'
import type { Overview } from '../lib/portal'
import { PageTitle } from './AdminShell'

const FINDING_COLORS: Record<string, string> = {
  Fail: '#c0432a',
  Warning: '#d49a2a',
  Pass: '#2f8a5a',
  'N/A (Out of Scope)': '#b7ae9f',
}

function Tile({ label, value, hint, dark, accent, href }: { label: string; value: number | string; hint?: string; dark?: boolean; accent?: boolean; href?: string }) {
  const body = (
    <div
      className={cx(
        'relative h-full overflow-hidden rounded-[24px] p-5 transition-transform duration-300 hover:-translate-y-0.5 sm:p-6',
        dark ? 'bg-ink text-cream' : accent ? 'bg-plasma text-ink' : 'bg-surface ring-1 ring-line',
      )}
    >
      <div className="flex items-start justify-between">
        <span className={cx('text-[13.5px]', dark ? 'text-cream/65' : accent ? 'text-ink/75' : 'text-muted')}>{label}</span>
        {href ? <span className={cx('grid size-7 place-items-center rounded-full ring-1 ring-inset', dark ? 'ring-cream/25' : 'ring-black/20')}><ArrowUpRight className="size-3.5" aria-hidden /></span> : null}
      </div>
      <div className="site-display mt-5 text-[52px] leading-none tabular-nums">{value}</div>
      {hint ? <p className={cx('mt-3 text-[12.5px]', dark ? 'text-cream/55' : accent ? 'text-ink/70' : 'text-faint')}>{hint}</p> : null}
    </div>
  )
  return href ? <Link href={href} className="block h-full">{body}</Link> : body
}

function Card({ title, sub, children, className }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-[24px] bg-surface p-5 ring-1 ring-line sm:p-6', className)}>
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
        {sub ? <span className="font-mono text-[11px] text-faint">{sub}</span> : null}
      </div>
      {children}
    </section>
  )
}

function WeekBars({ data }: { data: Overview['leads_by_week'] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const total = data.reduce((a, d) => a + d.count, 0)
  return (
    <div>
      <div className="flex h-[190px] items-end gap-2.5" role="img" aria-label={`Leads per week, last ${data.length} weeks, ${total} in total`}>
        {data.map((d, i) => {
          const last = i === data.length - 1
          const h = d.count === 0 ? 4 : Math.max(10, (d.count / max) * 100)
          return (
            <div key={d.week} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
              <span className="font-mono text-[11px] tabular-nums text-faint opacity-0 transition-opacity group-hover:opacity-100">{d.count}</span>
              <div
                className={cx('w-full rounded-t-xl transition-all duration-700', d.count === 0 ? 'bg-black/10' : last ? 'bg-plasma' : 'bg-ink')}
                style={{ height: `${h}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-2.5">
        {data.map((d) => (
          <span key={d.week} className="flex-1 text-center font-mono text-[10px] text-faint">
            {new Date(d.week + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        ))}
      </div>
    </div>
  )
}

function Donut({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data)
  const total = entries.reduce((a, [, v]) => a + v, 0)
  const r = 54
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 140 140" className="size-[148px] shrink-0 -rotate-90" role="img" aria-label="Findings by status">
        <circle cx="70" cy="70" r={r} fill="none" stroke="rgb(5 5 5 / 0.08)" strokeWidth="18" />
        {total > 0
          ? entries.map(([k, v]) => {
              const len = (v / total) * c
              const el = (
                <circle key={k} cx="70" cy="70" r={r} fill="none" stroke={FINDING_COLORS[k] ?? '#999'} strokeWidth="18" strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-offset} />
              )
              offset += len
              return el
            })
          : null}
        <text x="70" y="70" transform="rotate(90 70 70)" textAnchor="middle" dominantBaseline="central" className="fill-ink text-[26px] font-semibold">{total}</text>
      </svg>
      <ul className="space-y-2 text-[13.5px]">
        {entries.map(([k, v]) => (
          <li key={k} className="flex items-center gap-2.5">
            <span className="size-2.5 rounded-full" style={{ background: FINDING_COLORS[k] ?? '#999' }} />
            <span className="text-soft">{k === 'N/A (Out of Scope)' ? 'Out of scope' : k}</span>
            <span className="ml-auto pl-3 font-mono tabular-nums text-fg">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Funnel({ data }: { data: Overview['pipeline_by_stage'] }) {
  const max = Math.max(1, ...STAGES.map((s) => data[s.id] ?? 0))
  return (
    <ul className="space-y-3">
      {STAGES.map((s) => {
        const n = data[s.id] ?? 0
        return (
          <li key={s.id} className="grid grid-cols-[110px_1fr_28px] items-center gap-3 text-[13.5px]">
            <span className="text-soft">{s.label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-black/[0.07]">
              <span className={cx('block h-full rounded-full', s.id === 'audit_sold' ? 'bg-plasma' : s.id === 'lost' ? 'bg-black/30' : 'bg-ink')} style={{ width: `${(n / max) * 100}%`, minWidth: n ? 8 : 0 }} />
            </span>
            <span className="text-right font-mono tabular-nums">{n}</span>
          </li>
        )
      })}
    </ul>
  )
}

function label(a: string) {
  return a.replace('.', ' ').replace(/^./, (c) => c.toUpperCase())
}

export function Dashboard() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = () => fetchOverview().then((d) => live && (setData(d), setError(null))).catch((e) => live && setError((e as Error).message))
    void load()
    const t = window.setInterval(load, 30000)
    return () => {
      live = false
      window.clearInterval(t)
    }
  }, [])

  const k = data?.kpis
  const empty = k && k.leads_total === 0 && k.prospects === 0 && k.audits === 0

  return (
    <>
      <PageTitle eyebrow="Business overview" title="Everything in one place." />
      {error ? <p role="alert" className="mx-5 mb-4 rounded-xl bg-fail/10 px-4 py-3 text-[14px] text-fail sm:mx-8">{error}</p> : null}
      {empty ? (
        <p className="mx-5 mb-4 rounded-xl bg-surface px-4 py-3 text-[14px] text-muted ring-1 ring-line sm:mx-8">
          Nothing here yet. Leads from the website form, prospects you add and audits you run will appear on this page.
        </p>
      ) : null}
      <div className="grid gap-3 px-5 pb-12 sm:px-8 lg:grid-cols-12">
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-4">
          <Tile dark label="Leads" value={k?.leads_total ?? '—'} hint={k ? `${k.leads_new} new · ${k.leads_7d} in the last 7 days` : undefined} href="/leads" />
          <Tile label="Prospects in pipeline" value={k?.prospects ?? '—'} href="/prospects" />
          <Tile label="Audits run" value={k?.audits ?? '—'} href="/documents" />
          <Tile accent label="Open gaps" value={k?.open_gaps ?? '—'} hint={k ? `${k.high_gaps} high severity` : undefined} />
        </div>

        <Card title="Leads per week" sub="last 8 weeks" className="lg:col-span-7">
          {data ? <WeekBars data={data.leads_by_week} /> : <div className="h-[220px] animate-pulse rounded-xl bg-black/5" />}
        </Card>
        <Card title="Findings by status" sub="all audited documents" className="lg:col-span-5">
          {data ? <Donut data={data.findings_by_status} /> : <div className="h-[148px] animate-pulse rounded-xl bg-black/5" />}
          <div className="mt-6 flex items-center gap-3 rounded-2xl bg-bg px-4 py-3 text-[13.5px]">
            <ShieldAlert className="size-4 text-[#a3208a]" aria-hidden />
            <span className="text-soft">
              {k ? `${k.monitored} pages monitored · ${k.drifted} with drift` : 'Loading monitoring…'}
            </span>
            <Link href="/monitoring" className="ml-auto text-[13px] underline decoration-plasma decoration-2 underline-offset-4">Open</Link>
          </div>
        </Card>

        <Card title="Prospect pipeline" sub="by stage" className="lg:col-span-5">
          {data ? <Funnel data={data.pipeline_by_stage} /> : <div className="h-[200px] animate-pulse rounded-xl bg-black/5" />}
        </Card>
        <Card title="Recent activity" sub="both of you, newest first" className="lg:col-span-7">
          {!data ? (
            <div className="h-[200px] animate-pulse rounded-xl bg-black/5" />
          ) : data.recent_activity.length === 0 ? (
            <p className="text-[14px] text-muted">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.recent_activity.map((a, i) => (
                <li key={i} className="flex items-start gap-3 py-3 text-[14px]">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-plasma" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{a.who}</span> <span className="text-muted">{label(a.action).toLowerCase()}</span>{' '}
                    {a.subject ? <span className="text-soft">{a.subject}</span> : null}
                    {a.detail ? <span className="block truncate text-[12.5px] text-faint">{a.detail}</span> : null}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{ago(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
