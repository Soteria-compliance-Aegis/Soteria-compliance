import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowUpRight, Clock, Globe, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Badge, EmptyState, Notice } from '../components/Controls'
import { Field, Input, Select } from '../components/Field'
import { Eyebrow } from '../components/Typography'
import {
  createMonitoringTarget,
  deleteMonitoringTarget,
  fetchMonitoringHistory,
  fetchMonitoringTargets,
  formatWhen,
  sweepAllMonitoring,
  sweepMonitoringTarget,
} from '../lib/aegis'
import type {
  MonitoringCounts,
  MonitoringHistoryItem,
  MonitoringTarget,
  SweepDigest,
  SweepResult,
} from '../lib/aegis'
import { cx } from '../lib/cx'
import { Link } from '../lib/router'

/*
  Continuous monitoring control center: the fleet strip, the watched-URL
  manager and the drift log. A clean check is free (hash diff, no Groq call);
  only moved content pays for the five-part remediation audit.
*/

const PAGE_LABELS = [
  'Homepage',
  'Privacy Policy',
  'Terms of Service',
  'AI Disclosure',
  'Pricing',
  'Security / Trust Page',
]

function StatusStrip({ sweeping, onSweep }: { sweeping: boolean; onSweep: () => void }) {
  const agents = [
    {
      icon: Activity,
      name: 'Watcher Agent',
      state: 'Active',
      tone: 'plasma' as const,
      meta: 'Hash diff engine · 0-token idle checks',
    },
    {
      icon: ShieldCheck,
      name: 'Auditor Agent',
      state: 'Standby / Ready',
      tone: 'neutral' as const,
      meta: '5-part remediation engine',
    },
    {
      icon: Clock,
      name: 'Next Scheduled Sweep',
      state: '02:00 UTC Daily',
      tone: 'neutral' as const,
      meta: 'via n8n',
    },
  ]

  return (
    <Card tone="plain" className="p-5 sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
        {agents.map((agent) => (
          <div key={agent.name} className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-black/[0.06] text-plasma-text">
              <agent.icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] text-faint">{agent.name}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <Badge tone={agent.tone}>{agent.state}</Badge>
              </span>
              <span className="mt-1 block text-[12.5px] leading-snug text-muted">{agent.meta}</span>
            </span>
          </div>
        ))}
        <div className="lg:justify-self-end">
          <Button onClick={onSweep} loading={sweeping}>
            <RefreshCw className="size-4" aria-hidden />
            {sweeping ? 'Sweeping all…' : 'Run All Sweeps Now'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function DriftPill({ target }: { target: MonitoringTarget }) {
  if (!target.active) return <Badge tone="neutral">Paused</Badge>
  if (target.lastStatus === 'drift_detected') return <Badge tone="fire">Drift Detected</Badge>
  if (target.lastStatus === 'clean') return <Badge tone="plasma">Zero Drift</Badge>
  if (target.lastStatus === 'error') return <Badge tone="fire">Check Failed</Badge>
  return <Badge tone="neutral">Not checked</Badge>
}

function DeltaPill({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-[12px] text-faint">baseline</span>
  if (delta === 0) return <span className="text-[12px] text-faint">no change</span>
  return (
    <span className={cx('text-[12px] tabular-nums', delta > 0 ? 'text-fire-3' : 'text-plasma-text')}>
      {delta > 0 ? `+${delta}` : delta} gaps
    </span>
  )
}

export function Monitoring() {
  const [targets, setTargets] = useState<MonitoringTarget[] | null>(null)
  const [counts, setCounts] = useState<MonitoringCounts | null>(null)
  const [history, setHistory] = useState<MonitoringHistoryItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [sweepingAll, setSweepingAll] = useState(false)
  const [sweepingId, setSweepingId] = useState<string | null>(null)
  const [digest, setDigest] = useState<SweepDigest | null>(null)
  const [rowResult, setRowResult] = useState<SweepResult | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [clientName, setClientName] = useState('')
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState(PAGE_LABELS[0])
  const [webhook, setWebhook] = useState('')
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<{ clientName?: string; url?: string }>({})

  const reload = useCallback(async () => {
    try {
      const [list, log] = await Promise.all([fetchMonitoringTargets(), fetchMonitoringHistory(60)])
      setTargets(list.targets)
      setCounts(list.counts)
      setHistory(log)
      setLoadError(null)
    } catch (caught) {
      setLoadError((caught as Error).message)
      setTargets([])
      setHistory([])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const deltas = useMemo(() => {
    const list = history ?? []
    const map = new Map<string, number | null>()
    list.forEach((item, index) => {
      const previous = list.slice(index + 1).find((candidate) => candidate.targetId === item.targetId)
      map.set(item.id, previous ? item.openGapsCount - previous.openGapsCount : null)
    })
    return map
  }, [history])

  const addTarget = async () => {
    const errors: { clientName?: string; url?: string } = {}
    if (!clientName.trim()) errors.clientName = 'Name the client or workspace this page belongs to.'
    if (!url.trim()) errors.url = 'Enter the public URL to watch.'
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    setActionError(null)
    setDigest(null)
    try {
      await createMonitoringTarget({
        clientName: clientName.trim(),
        url: url.trim(),
        label,
        alertWebhookUrl: webhook.trim(),
      })
      setClientName('')
      setUrl('')
      setWebhook('')
      setLabel(PAGE_LABELS[0])
      await reload()
    } catch (caught) {
      setActionError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const sweepAll = async () => {
    setSweepingAll(true)
    setDigest(null)
    setRowResult(null)
    setActionError(null)
    try {
      setDigest(await sweepAllMonitoring())
      await reload()
    } catch (caught) {
      setActionError((caught as Error).message)
    } finally {
      setSweepingAll(false)
    }
  }

  const sweepOne = async (target: MonitoringTarget) => {
    setSweepingId(target.id)
    setDigest(null)
    setRowResult(null)
    setActionError(null)
    try {
      setRowResult(await sweepMonitoringTarget(target.id))
      await reload()
    } catch (caught) {
      setActionError((caught as Error).message)
    } finally {
      setSweepingId(null)
    }
  }

  const remove = async (target: MonitoringTarget) => {
    setActionError(null)
    setRowResult(null)
    try {
      await deleteMonitoringTarget(target.id)
      await reload()
    } catch (caught) {
      setActionError((caught as Error).message)
    }
  }

  return (
    <>
      <section className="pt-10 pb-7 sm:pt-14">
        <Eyebrow tone="plasma">Workflow 4 · Continuous monitoring</Eyebrow>
        <h1 className="display mt-3 max-w-[780px] text-balance text-[36px] sm:text-[48px]">
          Compliance that notices when the page moves.
        </h1>
        <p className="mt-4 max-w-[700px] text-pretty text-[16px] leading-[1.6] text-muted">
          Watch the public pages your buyers read. The watcher re-fetches each URL on schedule, cleans it and compares
          a SHA-256 of the text — an unchanged page costs zero tokens. When the text moves, the five-part auditor runs
          and the drift is logged with its exact fix.
        </p>
      </section>

      <div className="flex flex-col gap-2">
        <StatusStrip sweeping={sweepingAll} onSweep={() => void sweepAll()} />

        {digest ? (
          <Notice tone="success" title={digest.summary}>
            <p className="mt-1 text-[13px] text-soft">
              {digest.targetsChecked} checked · {digest.drifted} drifted · {digest.clean} clean
              {digest.errored ? ` · ${digest.errored} failed` : ''} ·{' '}
              <span className="tabular-nums">{digest.tokensUsed.toLocaleString()}</span> tokens spent (estimated) ·
              swept {formatWhen(digest.sweptAt)}
            </p>
          </Notice>
        ) : null}

        {rowResult ? (
          <Notice
            tone={rowResult.status === 'error' ? 'error' : rowResult.driftDetected ? 'info' : 'success'}
            title={
              rowResult.status === 'error'
                ? `Check failed for ${rowResult.label}`
                : rowResult.driftDetected
                  ? `Drift detected on ${rowResult.label}`
                  : `Zero drift on ${rowResult.label}`
            }
          >
            <p className="mt-1 text-[13px] text-soft">
              {rowResult.error
                ? rowResult.error
                : rowResult.driftDetected
                  ? `${rowResult.openGapsCount} open gaps (${rowResult.highGapsCount} high) · ${rowResult.llmCalls} audit call${rowResult.llmCalls === 1 ? '' : 's'} · ${rowResult.tokensUsed.toLocaleString()} tokens (estimated)`
                  : 'Content unchanged: the hash matched and no audit was needed.'}
            </p>
            {rowResult.auditDocId ? (
              <Link
                href={`/documents/${rowResult.auditDocId}`}
                className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-[13px] text-plasma-text hover:underline hover:underline-offset-4"
              >
                Open the five-part remediation
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </Notice>
        ) : null}

        {actionError ? (
          <Notice tone="error" title="That action did not go through">
            {actionError}
          </Notice>
        ) : null}

        {loadError ? (
          <Notice tone="error" title="The monitoring API is not answering">
            {loadError}. Start it with <span className="font-mono text-[13px]">python server.py</span>.
          </Notice>
        ) : null}

        <Card tone="plain" className="p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[16px] font-medium text-fg">Add a monitored page</h2>
            <span className="text-[13px] text-faint">public URLs only · re-checked daily</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Client / workspace name" error={formErrors.clientName}>
              {(props) => (
                <Input
                  {...props}
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  placeholder="Acme AI"
                  autoComplete="organization"
                />
              )}
            </Field>
            <Field label="URL" error={formErrors.url} hint="Loopback and private hosts are rejected by the fetcher.">
              {(props) => (
                <Input
                  {...props}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://acme.com/privacy"
                  inputMode="url"
                  autoComplete="url"
                />
              )}
            </Field>
            <Field label="Page label" hint="The label picks the auditor's page kind and character cap.">
              {(props) => (
                <Select {...props} value={label} onChange={(event) => setLabel(event.target.value)}>
                  {PAGE_LABELS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Slack / webhook URL" optional hint="A POST fires only when a drift finds open gaps.">
              {(props) => (
                <Input
                  {...props}
                  value={webhook}
                  onChange={(event) => setWebhook(event.target.value)}
                  placeholder="https://hooks.slack.com/services/…"
                  inputMode="url"
                />
              )}
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void addTarget()} loading={saving}>
              <Plus className="size-4" aria-hidden />
              {saving ? 'Adding target…' : 'Add to watch list'}
            </Button>
            <span className="text-[13px] text-faint">
              The first sweep captures a baseline and runs a full audit, so start from a page you want graded.
            </span>
          </div>
        </Card>

        <Card tone="plain" className="p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[16px] font-medium text-fg">Watched URLs</h2>
            <span className="text-[13px] text-faint">
              {counts
                ? `${counts.active} active · ${counts.drifted} drifted${counts.errors ? ` · ${counts.errors} failed` : ''}`
                : '—'}
            </span>
          </div>

          {targets === null ? (
            <div className="flex items-center gap-3 py-6 text-[14px] text-muted">
              <span className="size-4 animate-spin rounded-full border-2 border-black/20 border-t-white/80" aria-hidden />
              Loading the watch list…
            </div>
          ) : targets.length === 0 ? (
            <EmptyState
              title="No pages are watched yet"
              body="Add a privacy policy, terms page or homepage above. The nightly sweep will start logging drift from the first baseline."
            />
          ) : (
            <div className="-mx-5 overflow-x-auto sm:-mx-6" role="region" aria-label="Monitored URLs" tabIndex={0}>
              <table className="w-full min-w-[900px] text-left text-[14px]">
                <thead>
                  <tr className="border-b border-black/10 text-[13px] text-faint">
                    <th scope="col" className="py-2.5 pl-5 pr-3 font-normal sm:pl-6">
                      Target
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-normal">
                      Last check
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-normal">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-normal">
                      Gaps
                    </th>
                    <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-normal sm:pr-6">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((target) => {
                    const snapshot = target.latestSnapshot
                    return (
                      <tr
                        key={target.id}
                        className={cx(
                          'group border-b border-black/[0.07] last:border-0 hover:bg-black/[0.03]',
                          !target.active && 'opacity-60',
                        )}
                      >
                        <td className="py-3 pl-5 pr-3 sm:pl-6">
                          <div className="flex min-h-10 items-center gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-black/[0.06] text-fg/60">
                              <Globe className="size-4" aria-hidden />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-fg">{target.label}</span>
                              <span className="block text-[13px] text-faint">
                                {target.clientName} ·{' '}
                                <a
                                  href={target.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="max-w-[260px] truncate align-bottom text-muted hover:text-fg hover:underline hover:underline-offset-4"
                                >
                                  {target.url.replace(/^https?:\/\//, '')}
                                </a>
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[13px] text-muted">
                          <span className="tabular-nums">{formatWhen(target.lastCheckedAt)}</span>
                          <span className="mt-0.5 block text-[12px] text-faint capitalize">{target.checkFrequency}</span>
                        </td>
                        <td className="px-3 py-3">
                          <DriftPill target={target} />
                        </td>
                        <td className="px-3 py-3">
                          <span className="tabular-nums text-soft">{snapshot ? snapshot.openGapsCount : 0}</span>
                          <span className="text-faint"> open</span>
                          <span
                            className={cx(
                              'ml-2 text-[12.5px] tabular-nums',
                              snapshot && snapshot.highGapsCount > 0 ? 'text-fire-3' : 'text-faint',
                            )}
                          >
                            {snapshot ? snapshot.highGapsCount : 0} high
                          </span>
                        </td>
                        <td className="py-3 pl-3 pr-5 sm:pr-6">
                          <div className="flex items-center justify-end gap-2">
                            {target.active ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={sweepingId === target.id}
                                disabled={sweepingAll}
                                onClick={() => void sweepOne(target)}
                              >
                                {sweepingId === target.id ? 'Sweeping…' : 'Sweep Now'}
                              </Button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void remove(target)}
                              aria-label={`Remove ${target.label} from monitoring`}
                              className="grid size-8 place-items-center rounded-[10px] text-faint transition-colors hover:bg-black/10 hover:text-danger"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
            Removing a target pauses it; its snapshot history stays in the log below. Deleting is always a change to
            your watch list, never to the audited pages.
          </p>
        </Card>

        <Card tone="plain" className="p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[16px] font-medium text-fg">Daily drift &amp; nightly report log</h2>
            <span className="text-[13px] text-faint">
              {history ? `${history.length} snapshot${history.length === 1 ? '' : 's'}` : '—'}
            </span>
          </div>

          {history === null ? (
            <div className="flex items-center gap-3 py-6 text-[14px] text-muted">
              <span className="size-4 animate-spin rounded-full border-2 border-black/20 border-t-white/80" aria-hidden />
              Loading the drift log…
            </div>
          ) : history.length === 0 ? (
            <EmptyState
              title="No checks have run yet"
              body="Run a sweep above or wait for the 02:00 UTC n8n job. Each check lands here with its hash diff and gap delta."
            />
          ) : (
            <ul className="divide-y divide-black/[0.07]">
              {history.map((item) => (
                <li key={item.id} className="flex flex-col gap-1.5 py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="tabular-nums text-[13px] text-faint">{formatWhen(item.checkedAt)}</span>
                    <span className="min-w-0 text-[14px] text-fg">
                      {item.label}
                      <span className="ml-2 text-[13px] text-faint">{item.clientName}</span>
                    </span>
                    <Badge tone={item.driftDetected ? 'fire' : 'plasma'}>
                      {item.driftDetected ? 'Content changed' : 'No drift'}
                    </Badge>
                    <span className="text-[12.5px] tabular-nums text-muted">
                      {item.openGapsCount} open · {item.highGapsCount} high
                    </span>
                    <DeltaPill delta={deltas.get(item.id) ?? null} />
                    {item.auditDocId ? (
                      <Link
                        href={`/documents/${item.auditDocId}`}
                        className="ml-auto inline-flex min-h-8 items-center gap-1.5 text-[13px] text-plasma-text hover:underline hover:underline-offset-4"
                      >
                        Open remediation
                        <ArrowUpRight className="size-3.5" aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                  {item.diffSummary ? (
                    <p className="text-[12.5px] leading-relaxed text-faint">{item.diffSummary}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-5 text-[12.5px] leading-relaxed text-faint">
            A hash match writes a clean snapshot and carries the last gap counts forward — no Groq call, no spend. A
            moved hash runs the auditor and links its findings to the standard audit view.
          </p>
        </Card>
      </div>
    </>
  )
}
