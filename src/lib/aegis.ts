/* Typed client for the Aegis API (server.py). */

export type Status = 'Pass' | 'Warning' | 'Fail' | 'N/A (Out of Scope)'
export type Severity = 'High' | 'Medium' | 'Low' | 'None'
export type RunState = 'queued' | 'auditing' | 'ready' | 'error'

export type Counts = { fail: number; warning: number; pass: number; na: number; open: number; graded: number }

export type RegulationState = { id: string; name: string; status: Status; severity: Severity }

/**
 * The five-part executive remediation attached to every flagged finding:
 * what is wrong, why it happened, what it costs, the exact fix to paste, and
 * the guardrail that stops it coming back. Server-side normalisation always
 * fills all five parts for a Fail or Warning; a Pass or N/A carries blanks.
 */
export type FindingRemediation = {
  problem: string
  rootCause: string
  consequences: string
  exactFix: { copyRedline: string; policyOrControlPatch: string }
  prevention: string
}

const EMPTY_EXACT_FIX = { copyRedline: '', policyOrControlPatch: '' }

/** Normalise a plan for rendering; null when the finding has no breakdown yet. */
export function remediationOf(value?: Partial<FindingRemediation> | null): FindingRemediation | null {
  if (!value) return null
  const fix = value.exactFix ?? EMPTY_EXACT_FIX
  const plan: FindingRemediation = {
    problem: value.problem ?? '',
    rootCause: value.rootCause ?? '',
    consequences: value.consequences ?? '',
    exactFix: { copyRedline: fix.copyRedline ?? '', policyOrControlPatch: fix.policyOrControlPatch ?? '' },
    prevention: value.prevention ?? '',
  }
  const filled = [
    plan.problem,
    plan.rootCause,
    plan.consequences,
    plan.exactFix.copyRedline,
    plan.exactFix.policyOrControlPatch,
    plan.prevention,
  ].some(Boolean)
  return filled ? plan : null
}

export type Finding = {
  regulation: string
  regulation_id: string
  status: Status
  severity: Severity
  evidence_quote: string
  remediation_note: string
  remediation_plan?: FindingRemediation
}

export type DocumentSummary = {
  id: string
  name: string
  fileType: string
  sizeBytes: number
  chars: number
  createdAt: string
  auditedAt: string | null
  status: RunState
  error: string | null
  counts: Counts
  regulations: RegulationState[]
}

export type DocumentDetail = DocumentSummary & {
  findings: Finding[]
  source: string
  reports?: { full: string; teaser: string }
}

export type Stats = {
  documents: number
  open: number
  high: number
  na: number
  audited: number
  lastAuditedAt: string | null
}

export type BriefGap = {
  title: string
  homepage_claim: string
  privacy_policy_quote: string
  risk: string
  fix: string
  remediation_plan?: FindingRemediation
}

export type Brief = {
  id: string
  company: string
  url: string
  createdAt: string
  snapshot: string
  gaps: BriefGap[]
  note: string
}

export type Health = {
  ok: boolean
  model: string
  screeningModel: string
  keyConfigured: boolean
  maxChars: number
  maxUploadBytes: number
  regulations: { id: string; name: string; focus: string }[]
  frameworks?: Framework[]
  redteamProbes?: ProbeDefinition[]
  artifactKinds?: { id: ArtifactKind; title: string; purpose: string }[]
  fetchLimits?: { maxBytes: number; maxChars: Record<string, number>; timeoutSeconds: number; maxProbeResponseBytes: number }
}

export type UrlSnapshot = {
  id: string
  kind: 'homepage' | 'product' | 'privacy'
  kindLabel: string
  url: string
  finalUrl: string
  title: string
  text: string
  status: number
  chars: number
  truncated: boolean
  fetchedAt: string
}

export type SnapshotError = { kind: string; kindLabel: string; url: string; code: string; error: string }

export type FetchResult = {
  snapshots: UrlSnapshot[]
  errors: SnapshotError[]
  limits: { maxBytes: number; maxChars: Record<string, number>; timeoutSeconds: number }
}

export type Framework = { id: string; name: string; deadline: string; status: string; why?: string }

export type DiffSeverity = 'Critical' | 'High' | 'Medium'

export type DiffGap = {
  id: string
  title: string
  severity: DiffSeverity
  claim_quote: string
  claim_source: string
  policy_quote: string
  policy_source: string
  frameworks: Framework[]
  why_it_matters: string
  remediation: string
  remediation_plan?: FindingRemediation
}

export type Diff = {
  id: string
  company: string
  url: string
  createdAt: string
  claimsSource: string
  policySource: string
  summary: string
  gaps: DiffGap[]
  counts: { critical: number; high: number; medium: number }
  coverage: { claimsChars: number; policyChars: number; frameworks: Framework[] }
  note: string
}

export type DiffSummary = {
  id: string
  company: string
  createdAt: string
  summary: string
  counts: { critical: number; high: number; medium: number }
}

export type ProbeDefinition = {
  id: string
  category: string
  name: string
  prompt: string
  expectation: string
  severity: string
  remediation: string
}

export type ProbeStatus = 'Pass' | 'Fail' | 'Inconclusive'

export type ProbeResult = {
  probeId: string
  category: string
  name: string
  prompt: string
  expectation: string
  observed: string
  status: ProbeStatus
  severity: string
  risk: string
  fix: string
  remediation_plan?: FindingRemediation
  simulated: boolean
}

export type RedTeamRun = {
  id: string
  company: string
  product: string
  mode: 'live' | 'simulated'
  target: string
  createdAt: string
  results: ProbeResult[]
  counts: { pass: number; fail: number; inconclusive: number; total: number }
  warnings: string[]
  note: string
}

export type RedTeamSummary = {
  id: string
  company: string
  mode: 'live' | 'simulated'
  target: string
  createdAt: string
  product: string
  counts: { pass: number; fail: number; inconclusive: number; total: number }
}

export type ArtifactKind = 'disclosure_notice' | 'vendor_checklist' | 'buyer_faq'

export type Artifact = {
  id: string
  kind: ArtifactKind
  kindTitle: string
  title: string
  company: string
  product: string
  createdAt: string
  markdown: string
  placeholders: string[]
  sources: string[]
  note: string
}

export type ArtifactSummary = { id: string; kind: ArtifactKind; company: string; createdAt: string; title: string; placeholders: string[] }

/* ---------- Continuous monitoring ---------- */

export type MonitoringStatus = 'clean' | 'drift_detected' | 'error'

/** One row of `monitoring_snapshots`: an immutable check result. */
export type MonitoringSnapshot = {
  id: string
  targetId: string
  checkedAt: string
  contentHash: string
  driftDetected: boolean
  diffSummary: string | null
  auditDocId: string | null
  openGapsCount: number
  highGapsCount: number
}

/** A snapshot joined with its target, as `/api/monitoring/history` returns it. */
export type MonitoringHistoryItem = MonitoringSnapshot & { clientName: string; url: string; label: string }

export type MonitoringTarget = {
  id: string
  clientName: string
  url: string
  label: string
  checkFrequency: string
  alertWebhookUrl: string | null
  active: boolean
  createdAt: string
  lastCheckedAt: string | null
  lastStatus: MonitoringStatus | null
  hasBaseline: boolean
  latestSnapshot: MonitoringSnapshot | null
}

export type MonitoringCounts = { total: number; active: number; drifted: number; errors: number }

/** The result of one sweep. `checkedAt` is absent on the sweep-all error fallback. */
export type SweepResult = {
  targetId: string
  clientName: string
  url: string
  label: string
  checkedAt?: string
  status: MonitoringStatus
  driftDetected: boolean
  contentHash?: string | null
  diffSummary?: string | null
  auditDocId?: string | null
  openGapsCount: number
  highGapsCount: number
  llmCalls: number
  tokensUsed: number
  error: string | null
}

/** The nightly digest returned by `POST /api/monitoring/sweep-all`. */
export type SweepDigest = {
  sweptAt: string
  targetsChecked: number
  clean: number
  drifted: number
  errored: number
  openGaps: number
  highGaps: number
  tokensUsed: number
  results: SweepResult[]
  summary: string
}

export const ACCEPTED = '.pdf,.docx,.txt,.md'
export const ACCEPTED_LABEL = 'PDF, DOCX or TXT'
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { detail?: string }
      if (body?.detail) message = body.detail
    } catch {
      /* a non-JSON error body keeps the status line */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export const fetchHealth = () => json<Health>('/api/health')
export const fetchStats = () => json<Stats>('/api/stats')

export const fetchDocuments = async () => (await json<{ documents: DocumentSummary[] }>('/api/documents')).documents
export const fetchDocument = (id: string) => json<DocumentDetail>(`/api/documents/${id}`)
export const reauditDocument = (id: string) => json<DocumentSummary>(`/api/documents/${id}/audit`, { method: 'POST' })

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error(`Could not delete this document (${res.status}).`)
}

export async function uploadDocument(file: File): Promise<DocumentSummary> {
  const form = new FormData()
  form.append('file', file)
  return json<DocumentSummary>('/api/documents', { method: 'POST', body: form })
}

export const MISSING_FROM_POLICY = 'Missing completely from Privacy Policy'

export async function createBrief(input: { company: string; url?: string; homepage: string; privacy: string }): Promise<Brief> {
  return json<Brief>('/api/brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export const fetchBrief = (id: string) => json<Brief>(`/api/briefs/${id}`)

export const fetchUrls = (urls: { homepage?: string; product?: string; privacy?: string }) =>
  json<FetchResult>('/api/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  })

export async function createDiff(input: {
  company: string
  url?: string
  claims: string
  policy: string
  claimsSource?: string
  policySource?: string
  claimsSnapshotId?: string
  policySnapshotId?: string
}): Promise<Diff> {
  return json<Diff>('/api/diffs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export const fetchDiff = (id: string) => json<Diff>(`/api/diffs/${id}`)
export const fetchDiffs = async () => (await json<{ diffs: DiffSummary[] }>('/api/diffs')).diffs

export async function createRedTeamRun(input: {
  company: string
  product?: string
  mode: 'live' | 'simulated'
  endpoint?: string
  headers?: string
  model?: string
  spec?: string
}): Promise<RedTeamRun> {
  return json<RedTeamRun>('/api/redteam', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export const fetchRedTeamRun = (id: string) => json<RedTeamRun>(`/api/redteam/${id}`)
export const fetchRedTeamRuns = async () => (await json<{ runs: RedTeamSummary[] }>('/api/redteam')).runs

export async function createArtifact(input: {
  kind: ArtifactKind
  company: string
  product?: string
  notes?: string
  diffId?: string
  redteamRunId?: string
  briefId?: string
}): Promise<Artifact> {
  return json<Artifact>('/api/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export const fetchArtifact = (id: string) => json<Artifact>(`/api/artifacts/${id}`)
export const fetchArtifacts = async () => (await json<{ artifacts: ArtifactSummary[] }>('/api/artifacts')).artifacts

export const fetchMonitoringTargets = () =>
  json<{ targets: MonitoringTarget[]; counts: MonitoringCounts }>('/api/monitoring/targets')

export async function createMonitoringTarget(input: {
  clientName: string
  url: string
  label?: string
  alertWebhookUrl?: string
}): Promise<MonitoringTarget> {
  return json<MonitoringTarget>('/api/monitoring/targets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export const deleteMonitoringTarget = (id: string) =>
  json<{ purged: boolean; active: boolean }>(`/api/monitoring/targets/${id}`, { method: 'DELETE' })

export const sweepMonitoringTarget = (id: string) =>
  json<SweepResult>(`/api/monitoring/targets/${id}/sweep`, { method: 'POST' })

export const sweepAllMonitoring = () => json<SweepDigest>('/api/monitoring/sweep-all', { method: 'POST' })

export const fetchMonitoringHistory = async (limit = 50) =>
  (await json<{ snapshots: MonitoringHistoryItem[]; count: number }>(`/api/monitoring/history?limit=${limit}`)).snapshots

export function reportUrl(id: string, kind: 'full' | 'teaser') {
  return `/api/documents/${id}/report?kind=${kind}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function openFindings(findings: Finding[]): Finding[] {
  const rank: Record<Status, number> = { Fail: 0, Warning: 1, Pass: 2, 'N/A (Out of Scope)': 3 }
  const severity: Record<Severity, number> = { High: 0, Medium: 1, Low: 2, None: 3 }
  return [...findings]
    .filter((finding) => finding.status === 'Fail' || finding.status === 'Warning')
    .sort((a, b) => rank[a.status] - rank[b.status] || severity[a.severity] - severity[b.severity])
}
