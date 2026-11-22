/* Typed client for the Aegis API (server.py). */

export type Status = 'Pass' | 'Warning' | 'Fail' | 'N/A (Out of Scope)'
export type Severity = 'High' | 'Medium' | 'Low' | 'None'
export type RunState = 'queued' | 'auditing' | 'ready' | 'error'

export type Counts = { fail: number; warning: number; pass: number; na: number; open: number; graded: number }

export type RegulationState = { id: string; name: string; status: Status; severity: Severity }

export type Finding = {
  regulation: string
  regulation_id: string
  status: Status
  severity: Severity
  evidence_quote: string
  remediation_note: string
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

export type Health = {
  ok: boolean
  model: string
  screeningModel: string
  keyConfigured: boolean
  maxChars: number
  maxUploadBytes: number
  regulations: { id: string; name: string; focus: string }[]
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
