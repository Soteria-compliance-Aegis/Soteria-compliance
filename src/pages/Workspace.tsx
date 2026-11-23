import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowUpRight, Bug, Download, FileText, Globe, RefreshCw, ShieldCheck, Trash2, Wrench } from 'lucide-react'

import { AegisLogo } from '../components/Brand'
import { Button, buttonClass } from '../components/Button'
import { Card } from '../components/Card'
import { Badge, Chip, EmptyState, Notice } from '../components/Controls'
import { Field, Input } from '../components/Field'
import { Eyebrow } from '../components/Typography'
import { BriefForm } from '../components/BriefForm'
import { UploadPanel } from '../components/UploadPanel'
import { ArtifactsPage } from './Artifacts'
import { BriefReport } from './BriefReport'
import { DiffReport } from './DiffReport'
import { FootprintAudit } from './FootprintAudit'
import { RedTeamLab, RedTeamReport } from './RedTeamLab'
import {
  deleteDocument,
  fetchDocument,
  fetchDocuments,
  fetchHealth,
  fetchStats,
  formatBytes,
  formatWhen,
  openFindings,
  reauditDocument,
  reportUrl,
  uploadDocument,
} from '../lib/aegis'
import type { Counts, DocumentDetail, DocumentSummary, Finding, Health, Stats, Status } from '../lib/aegis'
import { cx } from '../lib/cx'
import { Link, navigate, useLocation } from '../lib/router'

/* ------------------------------------------------------------------ */
/* Shared                                                             */
/* ------------------------------------------------------------------ */

const STATUS_STYLE: Record<Status, string> = {
  Fail: 'bg-fire-1/15 text-fire-3 ring-1 ring-inset ring-fire-1/35',
  Warning: 'bg-white/[0.07] text-fire-2 ring-1 ring-inset ring-fire-2/25',
  Pass: 'bg-success/12 text-success ring-1 ring-inset ring-success/25',
  'N/A (Out of Scope)': 'bg-white/[0.05] text-faint ring-1 ring-inset ring-white/10',
}

const STATUS_LABEL: Record<Status, string> = {
  Fail: 'Fail',
  Warning: 'Warning',
  Pass: 'Pass',
  'N/A (Out of Scope)': 'N/A',
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={cx('inline-flex h-7 items-center gap-2 rounded-control px-3 text-[13px] font-medium', STATUS_STYLE[status])}>
      <span className="round size-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

function StatePill({ doc }: { doc: DocumentSummary }) {
  if (doc.status === 'error') return <Badge tone="fire">Failed</Badge>
  if (doc.status === 'queued' || doc.status === 'auditing') return <Badge tone="plasma" pulse>{doc.status === 'queued' ? 'Queued' : 'Auditing'}</Badge>
  if (doc.counts.fail > 0) return <Badge tone="fire">{doc.counts.fail} fail</Badge>
  if (doc.counts.warning > 0) return <Badge tone="neutral">{doc.counts.warning} gap</Badge>
  return <Badge tone="success">Clean</Badge>
}

function CountBar({ counts }: { counts: Counts }) {
  const total = Math.max(1, counts.fail + counts.warning + counts.pass + counts.na)
  const segments = [
    { count: counts.fail, tone: 'bg-fire-1' },
    { count: counts.warning, tone: 'bg-fire-2' },
    { count: counts.pass, tone: 'bg-success' },
    { count: counts.na, tone: 'bg-white/20' },
  ]
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
      {segments.map((segment, index) =>
        segment.count > 0 ? <div key={index} className={cx('h-full', segment.tone)} style={{ width: `${(segment.count / total) * 100}%` }} /> : null,
      )}
    </div>
  )
}

function DocumentTable({ docs, onDelete }: { docs: DocumentSummary[]; onDelete?: (doc: DocumentSummary) => void }) {
  return (
    <div className="-mx-5 overflow-x-auto sm:-mx-6" role="region" aria-label="Audited documents" tabIndex={0}>
      <table className="w-full min-w-[880px] text-left text-[14px]">
        <thead>
          <tr className="border-b border-white/10 text-[13px] text-faint">
            <th scope="col" className="py-2.5 pl-5 pr-3 font-normal sm:pl-6">
              Document
            </th>
            <th scope="col" className="px-3 py-2.5 font-normal">
              Open gaps
            </th>
            <th scope="col" className="px-3 py-2.5 font-normal">
              Passing
            </th>
            <th scope="col" className="px-3 py-2.5 font-normal">
              N/A
            </th>
            <th scope="col" className="px-3 py-2.5 font-normal">
              State
            </th>
            <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-normal sm:pr-6">
              Uploaded
            </th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.id} className="group border-b border-white/[0.07] last:border-0 hover:bg-white/[0.03]">
              <td className="py-3 pl-5 pr-3 sm:pl-6">
                <div className="flex min-h-10 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-white/[0.06] text-white/60">
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <Link
                      href={`/documents/${doc.id}`}
                      className="block max-w-[320px] truncate text-white group-hover:underline group-hover:decoration-white/30 group-hover:underline-offset-4"
                    >
                      {doc.name}
                    </Link>
                    <span className="block text-[13px] text-faint">
                      {doc.fileType.toUpperCase()} · {formatBytes(doc.sizeBytes)} · {doc.chars.toLocaleString()} chars
                    </span>
                  </span>
                </div>
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="tabular-nums text-soft">{doc.counts.fail + doc.counts.warning}</span>
                  <span className="w-[84px]">
                    <CountBar counts={doc.counts} />
                  </span>
                </div>
              </td>
              <td className="tabular-nums px-3 py-3 text-soft">{doc.counts.pass}</td>
              <td className="tabular-nums px-3 py-3 text-soft">{doc.counts.na}</td>
              <td className="px-3 py-3">
                <StatePill doc={doc} />
              </td>
              <td className="py-3 pl-3 pr-5 text-right text-[13px] text-faint sm:pr-6">
                <span className="inline-flex items-center gap-2">
                  <span className="tabular-nums">{formatWhen(doc.createdAt)}</span>
                  {onDelete ? (
                    <button
                      type="button"
                      onClick={() => onDelete(doc)}
                      aria-label={`Delete ${doc.name}`}
                      className="grid size-8 place-items-center rounded-[10px] text-faint transition-colors hover:bg-white/10 hover:text-danger"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Panel({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card tone="plain" className={cx('p-5 sm:p-6', className)}>
      <div className="mb-5 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-[16px] font-medium text-white">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-6 text-[14px] text-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden />
      {label}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Overview                                                           */
/* ------------------------------------------------------------------ */

function Overview() {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [list, totals] = await Promise.all([fetchDocuments(), fetchStats()])
      setDocs(list)
      setStats(totals)
      setLoadError(null)
    } catch (error) {
      setLoadError((error as Error).message)
      setDocs([])
    }
  }, [])

  useEffect(() => {
    void reload()
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [reload])

  const running = (docs ?? []).some((doc) => doc.status === 'queued' || doc.status === 'auditing')
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => void reload(), 3000)
    return () => window.clearInterval(timer)
  }, [running, reload])

  const upload = async (file: File) => {
    setBusy(true)
    setUploadError(null)
    try {
      const doc = await uploadDocument(file)
      navigate(`/documents/${doc.id}`)
    } catch (error) {
      setUploadError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const rubrics: { id: string; name: string }[] = health?.regulations.length
    ? health.regulations.map((regulation) => ({ id: regulation.id, name: regulation.name }))
    : [
        { id: 'ccpa_admt', name: 'California ADMT / CCPA' },
        { id: 'texas_traiga', name: 'Texas TRAIGA' },
        { id: 'nyc_ll144', name: 'NYC Local Law 144' },
        { id: 'ftc_section5', name: 'FTC Section 5 (AI-washing)' },
        { id: 'india_dpdp', name: 'India DPDP Act' },
      ]

  return (
    <>
      <section className="pt-12 pb-8 sm:pt-16">
        <Eyebrow tone="fire">AI governance workspace</Eyebrow>
        <h1 className="display mt-3 max-w-[760px] text-balance text-[40px] sm:text-[54px]">Every claim needs evidence.</h1>
        <p className="mt-4 max-w-[640px] text-pretty text-[17px] leading-[1.55] text-muted">
          Audit the public footprint, red-team the agent, and generate the governance documents buyers ask for —
          each finding quoted verbatim and mapped to a 2026–2027 US deadline. Technical readiness, not legal advice.
        </p>
      </section>

      <div className="grid gap-2 md:grid-cols-3">
        {[
          {
            step: '1',
            title: 'Footprint & policy audit',
            body: 'Fetch the live homepage and privacy policy, then grade every public promise against the disclosure behind it.',
            href: '/audit',
            icon: Globe,
          },
          {
            step: '2',
            title: 'Red-team lab',
            body: 'Run eight bounded probes for AI disclosure, prompt injection, PII leakage and decision guardrails.',
            href: '/redteam',
            icon: Bug,
          },
          {
            step: '3',
            title: 'Fix artifacts & export',
            body: 'Draft the disclosure notice, vendor checklist and buyer FAQ from the evidence, ready for counsel review.',
            href: '/artifacts',
            icon: Wrench,
          },
        ].map((flow) => (
          <Link key={flow.href} href={flow.href} className="group block">
            <Card tone="plain" className="h-full p-5 transition-colors group-hover:bg-surface-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[12px] font-medium text-faint">
                  <span className="grid size-6 place-items-center rounded-full bg-white/[0.07] text-[12px] text-soft">{flow.step}</span>
                  Workflow {flow.step}
                </span>
                <flow.icon className="size-4 text-fire-2" aria-hidden />
              </div>
              <h2 className="mt-3 text-[15px] font-medium text-white group-hover:underline group-hover:decoration-white/30 group-hover:underline-offset-4">
                {flow.title}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{flow.body}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-2">
        <span className="text-[12px] text-faint">Existing flows · policy document audit and the one-page public footprint brief</span>
      </div>

      {loadError ? (
        <Notice tone="error" title="The Aegis API is not answering" className="mb-3">
          {loadError}. Start it with <span className="font-mono text-[13px]">python server.py</span>.
        </Notice>
      ) : null}

      {health && !health.keyConfigured ? (
        <Notice tone="error" title="GROQ_API_KEY is missing" className="mb-3">
          Add it to <span className="font-mono text-[13px]">.env</span>; uploads will fail until then.
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: 'Policies on file', value: stats ? String(stats.documents) : '—', tone: 'text-white' },
          { label: 'Open gaps', value: stats ? String(stats.open) : '—', tone: 'text-fire-2' },
          { label: 'High severity', value: stats ? String(stats.high) : '—', tone: 'text-fire-3' },
          { label: 'Out of scope', value: stats ? String(stats.na) : '—', tone: 'text-muted' },
        ].map((kpi) => (
          <Card key={kpi.label} tone="plain" className="p-5">
            <div className="text-[13px] text-faint">{kpi.label}</div>
            <div className={cx('display mt-2 text-[32px] tabular-nums', kpi.tone)}>{kpi.value}</div>
          </Card>
        ))}
      </div>

      <div className="mt-2 grid gap-2 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Card tone="plain" className="relative p-5 sm:p-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[460px] -translate-x-1/2 rounded-full bg-fire-1/20 blur-[90px]"
          />
          <div className="relative mb-4 flex items-center justify-between gap-4">
            <h2 className="text-[16px] font-medium text-white">New mini-audit</h2>
            <span className="text-[13px] text-faint">homepage × privacy policy</span>
          </div>
          <div className="relative">
            <BriefForm onDone={(brief) => navigate(`/brief/${brief.id}`)} />
          </div>
          <p className="relative mt-5 text-[13px] leading-relaxed text-faint">
            Both documents are capped before they reach Groq. The brief keeps only the three highest-confidence gaps and quotes the exact
            text behind each one — missing disclosure is framed as an upcoming 2027 deadline, never as legal advice.
          </p>
        </Card>

        <Panel title="Regulations covered">
          <ul className="divide-y divide-white/[0.07]">
            {rubrics.map((rubric) => (
              <li key={rubric.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-fire-2" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[14px] text-soft">{rubric.name}</span>
                  <span className="block font-mono text-[12px] text-faint">{rubric.id}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[13px] leading-relaxed text-faint">
            Applicability is decided before grading, so a consumer privacy notice is never failed for missing a hiring-bias audit.
          </p>
        </Panel>
      </div>

      <Card tone="plain" className="mt-2 p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-[16px] font-medium text-white">Upload a policy file</h2>
          <span className="text-[13px] text-faint">existing document audit</span>
        </div>
        <UploadPanel onFile={upload} busy={busy} error={uploadError} />
      </Card>

      <Panel
        className="mt-2"
        title="Recent audits"
        action={
          <Link href="/documents" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white">
            All documents
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        }
      >
        {docs === null ? (
          <Loading label="Loading documents…" />
        ) : docs.length === 0 ? (
          <EmptyState title="No policies audited yet" body="Drop a PDF, DOCX or TXT above to run the first audit for this workspace." />
        ) : (
          <DocumentTable docs={docs.slice(0, 6)} />
        )}
      </Panel>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Library                                                            */
/* ------------------------------------------------------------------ */

type Filter = 'all' | 'open' | 'clean' | 'error'

function Library() {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<DocumentSummary | null>(null)

  const reload = useCallback(async () => {
    try {
      setDocs(await fetchDocuments())
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
      setDocs([])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (docs ?? []).filter((doc) => {
      if (needle && !doc.name.toLowerCase().includes(needle)) return false
      if (filter === 'open') return doc.counts.open > 0
      if (filter === 'clean') return doc.status === 'ready' && doc.counts.open === 0
      if (filter === 'error') return doc.status === 'error'
      return true
    })
  }, [docs, query, filter])

  const remove = async () => {
    if (!removing) return
    try {
      await deleteDocument(removing.id)
      setRemoving(null)
      await reload()
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 pt-10 pb-6">
        <div>
          <Eyebrow tone="muted">Library</Eyebrow>
          <h1 className="display mt-2 text-[36px] sm:text-[44px]">
            Documents <span className="tabular-nums text-muted">{docs?.length ?? 0}</span>
          </h1>
        </div>
        <Link href="/" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white">
          New audit
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      </div>

      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}

      <Card tone="plain" className="p-5 sm:p-6">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="sm:w-[320px]">
            <Field label="Search documents">
              {(props) => <Input {...props} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="File name" />}
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', 'All'],
                ['open', 'Open gaps'],
                ['clean', 'Clean'],
                ['error', 'Failed'],
              ] as [Filter, string][]
            ).map(([value, label]) => (
              <Chip key={value} selected={filter === value} onClick={() => setFilter(value)}>
                {label}
              </Chip>
            ))}
          </div>
        </div>

        {docs === null ? (
          <Loading label="Loading documents…" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No documents match"
            body="Try a different name, or clear the filter to see every audit."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <DocumentTable docs={rows} onDelete={setRemoving} />
        )}
      </Card>

      {removing ? (
        <Notice tone="error" title={`Delete ${removing.name}?`} className="mt-2">
          <div className="flex flex-wrap items-center gap-3 py-1">
            <span className="text-[13px] text-soft">Its findings are removed too. This cannot be undone.</span>
            <Button variant="secondary" size="sm" onClick={() => void remove()}>
              Delete permanently
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
          </div>
        </Notice>
      ) : null}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* One audit                                                          */
/* ------------------------------------------------------------------ */

function FindingCard({ finding }: { finding: Finding }) {
  const gap = finding.status === 'Warning' && !finding.evidence_quote
  return (
    <Card tone="plain" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[17px] font-medium text-white">{finding.regulation}</h3>
          <p className="mt-0.5 font-mono text-[12px] text-faint">{finding.regulation_id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={finding.status} />
          <Badge tone="neutral">{finding.severity}</Badge>
        </div>
      </div>

      <div className="mt-5">
        <Eyebrow tone="muted">Evidence</Eyebrow>
        {finding.evidence_quote ? (
          <blockquote
            className={cx(
              'mt-2 rounded-[16px] bg-white/[0.04] px-4 py-3 text-[14px] leading-relaxed text-soft ring-1 ring-white/[0.08]',
              finding.status === 'Fail' ? 'border-l-2 border-fire-1' : 'border-l-2 border-white/25',
            )}
          >
            “{finding.evidence_quote}”
          </blockquote>
        ) : (
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            {gap ? 'No problematic wording in this document: the finding is a disclosure gap, not a violation.' : 'No verifiable quote for this finding.'}
          </p>
        )}
      </div>

      <div className="mt-5">
        <Eyebrow tone="muted">Recommended change</Eyebrow>
        <p className="mt-2 text-[14px] leading-relaxed text-soft">{finding.remediation_note}</p>
      </div>
    </Card>
  )
}

function DocumentView({ id }: { id: string }) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const load = useCallback(async () => {
    try {
      setDoc(await fetchDocument(id))
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const running = doc?.status === 'queued' || doc?.status === 'auditing'
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => void load(), 2500)
    return () => window.clearInterval(timer)
  }, [running, load])

  const rerun = async () => {
    setRerunning(true)
    try {
      await reauditDocument(id)
      await load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setRerunning(false)
    }
  }

  const remove = async () => {
    try {
      await deleteDocument(id)
      navigate('/documents')
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  const back = (
    <Link href="/documents" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white">
      <ArrowLeft className="size-4" aria-hidden /> Documents
    </Link>
  )

  if (error) {
    return (
      <div className="pt-8">
        {back}
        <Notice tone="error" title="Could not load this audit" className="mt-3">
          {error}
        </Notice>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="pt-10">
        <Loading label="Loading audit…" />
      </div>
    )
  }

  const findings = doc.findings ?? []
  const open = openFindings(findings)
  const passing = findings.filter((finding) => finding.status === 'Pass')
  const outOfScope = findings.filter((finding) => finding.status === 'N/A (Out of Scope)')

  return (
    <>
      <div className="pt-8">{back}</div>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-5 pb-7">
        <div className="min-w-0">
          <h1 className="display max-w-[720px] text-[32px] break-words sm:text-[40px]">{doc.name}</h1>
          <p className="mt-2 text-[13px] text-faint">
            {doc.fileType.toUpperCase()} · {formatBytes(doc.sizeBytes)} · {doc.chars.toLocaleString()} characters read · uploaded{' '}
            {formatWhen(doc.createdAt)}
            {doc.auditedAt ? ` · audited ${formatWhen(doc.auditedAt)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatePill doc={doc} />
          <Button variant="secondary" size="sm" loading={rerunning} disabled={running} onClick={() => void rerun()}>
            <RefreshCw className="size-3.5" aria-hidden />
            Re-audit
          </Button>
          {doc.status === 'ready' ? (
            <>
              <a className={buttonClass('primary', 'sm')} href={reportUrl(doc.id, 'full')} download>
                <Download className="size-3.5" aria-hidden />
                Full report
              </a>
              <a className={buttonClass('ghost', 'sm')} href={reportUrl(doc.id, 'teaser')} download>
                Teaser
              </a>
            </>
          ) : null}
          {confirm ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => void remove()}>
                Delete permanently
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
              <Trash2 className="size-3.5" aria-hidden />
              Delete
            </Button>
          )}
        </div>
      </div>

      {doc.status === 'error' ? (
        <Notice tone="error" title="This audit failed" className="mb-3">
          {doc.error ?? 'Unknown error.'}
        </Notice>
      ) : null}

      {running ? (
        <Notice tone="info" title="Grading in progress" className="mb-3">
          Five rubrics, one Groq call. On the free tier this takes about a minute; the page refreshes itself.
        </Notice>
      ) : null}

      {doc.status === 'ready' ? (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              { label: 'Fail', value: doc.counts.fail, tone: 'text-fire-2' },
              { label: 'Warning', value: doc.counts.warning, tone: 'text-fire-3' },
              { label: 'Pass', value: doc.counts.pass, tone: 'text-success' },
              { label: 'Out of scope', value: doc.counts.na, tone: 'text-muted' },
            ].map((kpi) => (
              <Card key={kpi.label} tone="plain" className="p-5">
                <div className="text-[13px] text-faint">{kpi.label}</div>
                <div className={cx('display mt-2 text-[32px] tabular-nums', kpi.tone)}>{kpi.value}</div>
              </Card>
            ))}
          </div>

          <Card tone="plain" className="mt-2 p-5">
            <div className="mb-3 flex items-center justify-between text-[13px] text-muted">
              <span>Graded coverage</span>
              <span className="tabular-nums">
                {doc.counts.graded} of {findings.length} in scope
              </span>
            </div>
            <CountBar counts={doc.counts} />
          </Card>

          <h2 className="mt-9 text-[18px] font-medium text-white">Open findings</h2>
          <div className="mt-3 flex flex-col gap-2">
            {open.length === 0 ? (
              <Card tone="plain" className="p-5">
                <div className="flex items-center gap-3 text-[14px] text-soft">
                  <ShieldCheck className="size-5 text-success" aria-hidden />
                  No in-scope gaps. Every applicable rubric passed on this document.
                </div>
              </Card>
            ) : (
              open.map((finding) => <FindingCard key={finding.regulation_id || finding.regulation} finding={finding} />)
            )}
          </div>

          {passing.length > 0 ? (
            <>
              <h2 className="mt-9 text-[18px] font-medium text-white">In scope and passing</h2>
              <div className="mt-3 flex flex-col gap-2">
                {passing.map((finding) => (
                  <Card key={finding.regulation_id || finding.regulation} tone="plain" className="flex flex-wrap items-start justify-between gap-3 p-5">
                    <div className="min-w-0">
                      <p className="text-[15px] text-white">{finding.regulation}</p>
                      <p className="mt-1 text-[14px] leading-relaxed text-muted">{finding.remediation_note}</p>
                    </div>
                    <StatusPill status={finding.status} />
                  </Card>
                ))}
              </div>
            </>
          ) : null}

          {outOfScope.length > 0 ? (
            <>
              <h2 className="mt-9 text-[18px] font-medium text-white">Out of scope</h2>
              <p className="mt-1 text-[13px] text-faint">Checked for applicability and not graded. This is not a finding against the company.</p>
              <div className="mt-3 flex flex-col gap-2">
                {outOfScope.map((finding) => (
                  <Card key={finding.regulation_id || finding.regulation} tone="plain" className="flex flex-wrap items-start justify-between gap-3 p-5">
                    <div className="min-w-0">
                      <p className="text-[15px] text-white">{finding.regulation}</p>
                      <p className="mt-1 text-[14px] leading-relaxed text-muted">{finding.remediation_note}</p>
                    </div>
                    <Badge tone="neutral">N/A</Badge>
                  </Card>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Shell                                                              */
/* ------------------------------------------------------------------ */

const TABS = [
  { label: 'Overview', href: '/' },
  { label: '1 · Footprint', href: '/audit' },
  { label: '2 · Red-team', href: '/redteam' },
  { label: '3 · Artifacts', href: '/artifacts' },
  { label: 'Documents', href: '/documents' },
]

export type WorkspaceView =
  | 'overview'
  | 'library'
  | 'document'
  | 'brief'
  | 'footprint'
  | 'diff'
  | 'redteam'
  | 'redteamRun'
  | 'artifacts'
  | 'artifact'

export function Workspace({ view }: { view: WorkspaceView }) {
  const { path } = useLocation()
  const id = path.split('/').filter(Boolean)[1] ?? ''
  const active =
    view === 'library' || view === 'document'
      ? '/documents'
      : view === 'footprint' || view === 'diff'
        ? '/audit'
        : view === 'redteam' || view === 'redteamRun'
          ? '/redteam'
          : view === 'artifacts' || view === 'artifact'
            ? '/artifacts'
            : '/'

  return (
    <div className="app-shell min-h-screen bg-black">
      <header className="no-print sticky top-0 z-40 border-b border-white/10 bg-black/75 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-[1280px] items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" aria-label="Aegis overview" className="rounded-[10px]">
              <AegisLogo />
            </Link>
            <span className="hidden text-white/20 sm:inline" aria-hidden>
              /
            </span>
            <span className="hidden truncate text-[15px] text-muted sm:inline">compliance workspace</span>
            <Badge tone="neutral" className="hidden md:inline-flex">
              Local
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <nav aria-label="Workspace" className="hidden items-center gap-1 lg:flex">
              {TABS.map((tab) => (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active === tab.href ? 'page' : undefined}
                  className={cx(
                    'inline-flex h-10 items-center rounded-control px-4 text-[14px] font-medium transition-colors',
                    active === tab.href ? 'bg-white text-black' : 'text-soft hover:bg-white/[0.08] hover:text-white',
                  )}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>
            <Link href="/audit" className={cx(buttonClass('primary', 'sm'), 'hidden sm:inline-flex')}>
              New audit
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-5 pb-20 sm:px-8">
        {view === 'overview' ? (
          <Overview />
        ) : view === 'library' ? (
          <Library />
        ) : view === 'brief' ? (
          <BriefReport id={id} />
        ) : view === 'footprint' ? (
          <FootprintAudit />
        ) : view === 'diff' ? (
          <DiffReport id={id} />
        ) : view === 'redteam' ? (
          <RedTeamLab />
        ) : view === 'redteamRun' ? (
          <RedTeamReport id={id} />
        ) : view === 'artifacts' ? (
          <ArtifactsPage />
        ) : view === 'artifact' ? (
          <ArtifactsPage artifactId={id} />
        ) : (
          <DocumentView id={id} />
        )}
      </main>

      <footer className="no-print border-t border-white/10">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-faint sm:px-8">
          <span>Aegis · technical AI risk assessment, not legal advice.</span>
          <span className="font-mono">FTC §5 · CA ADMT · CO SB 26-189 · TRAIGA · LL144 · DPDP</span>
        </div>
      </footer>
    </div>
  )
}
