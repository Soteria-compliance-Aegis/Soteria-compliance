/* Typed client for the admin and public endpoints in backend/routers. */

export type User = { id: number | string; email: string; name: string }

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
export const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'won', 'lost']
export type Interest = 'scorecard' | 'audit' | 'retainer' | 'other'

export type Lead = {
  id: number | string
  created_at: string
  name: string
  email: string
  company: string
  role: string | null
  interest: Interest
  message: string | null
  status: LeadStatus
  assignee: string | null
  source: string | null
}
export type LeadNote = { id: number | string; lead_id: number | string; user_id: number | string | null; author: string | null; body: string; created_at: string }

export type Stage = 'research' | 'contacted' | 'replied' | 'scorecard_sent' | 'call' | 'audit_sold' | 'lost'
export const STAGES: { id: Stage; label: string }[] = [
  { id: 'research', label: 'Research' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'replied', label: 'Replied' },
  { id: 'scorecard_sent', label: 'Scorecard sent' },
  { id: 'call', label: 'Call booked' },
  { id: 'audit_sold', label: 'Audit sold' },
  { id: 'lost', label: 'Lost' },
]
export const SEGMENTS = ['HR tech', 'Fintech', 'Health tech', 'Other']

export type Prospect = {
  id: number | string
  created_at: string
  updated_at: string
  company: string
  url: string | null
  privacy_url: string | null
  segment: string | null
  stage: Stage
  contact_name: string | null
  contact_email: string | null
  notes: string | null
}

export type Overview = {
  kpis: {
    leads_total: number
    leads_new: number
    leads_7d: number
    prospects: number
    audits: number
    open_gaps: number
    high_gaps: number
    monitored: number
    drifted: number
  }
  leads_by_week: { week: string; count: number }[]
  leads_by_status: Record<LeadStatus, number>
  pipeline_by_stage: Record<Stage, number>
  findings_by_status: Record<string, number>
  recent_activity: ActivityItem[]
}
export type ActivityItem = { id?: number | string; at: string; who: string; action: string; subject: string | null; detail: string | null }

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (res.status === 204) return undefined as T
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg ?? '').filter(Boolean).join('; ') || 'Check the form and try again.'
          : `${res.status} ${res.statusText}`
    throw new ApiError(message, res.status)
  }
  return body as T
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

/* auth */
export const login = (email: string, password: string) => call<{ user: User }>('/api/auth/login', send('POST', { email, password }))
export const logout = () => call<{ ok: boolean }>('/api/auth/logout', send('POST'))
export const me = () => call<{ user: User }>('/api/auth/me')

/* public */
export type LeadInput = {
  name: string
  email: string
  company: string
  role?: string
  interest: Interest
  message?: string
  website?: string
  consent: boolean
}
export const submitLead = (input: LeadInput) => call<{ ok: boolean }>('/api/public/leads', send('POST', input))
export const publicConfig = () => call<{ posthogKey: string | null; posthogHost: string }>('/api/public/config')

/* admin */
export const fetchOverview = () => call<Overview>('/api/admin/overview')
export const fetchLeads = (params: { status?: string; q?: string } = {}) => {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.q) qs.set('q', params.q)
  qs.set('limit', '200')
  return call<{ leads: Lead[]; total: number }>(`/api/admin/leads?${qs}`)
}
export const fetchLead = (id: number | string) => call<Lead & { notes: LeadNote[] }>(`/api/admin/leads/${id}`)
export const patchLead = (id: number | string, body: { status?: LeadStatus; assignee?: string | null }) =>
  call<Lead>(`/api/admin/leads/${id}`, send('PATCH', body))
export const addLeadNote = (id: number | string, body: string) => call<LeadNote>(`/api/admin/leads/${id}/notes`, send('POST', { body }))
export const deleteLead = (id: number | string) => call<void>(`/api/admin/leads/${id}`, send('DELETE'))

export const fetchProspects = (params: { stage?: string; segment?: string; q?: string } = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  qs.set('limit', '500')
  return call<{ prospects: Prospect[]; total: number }>(`/api/admin/prospects?${qs}`)
}
export type ProspectInput = Partial<Omit<Prospect, 'id' | 'created_at' | 'updated_at'>> & { company: string }
export const createProspect = (body: ProspectInput) => call<Prospect>('/api/admin/prospects', send('POST', body))
export const patchProspect = (id: number | string, body: Partial<ProspectInput>) => call<Prospect>(`/api/admin/prospects/${id}`, send('PATCH', body))
export const deleteProspect = (id: number | string) => call<void>(`/api/admin/prospects/${id}`, send('DELETE'))
export const importProspects = (rows: ProspectInput[]) => call<{ created: number; skipped: number }>('/api/admin/prospects/import', send('POST', { rows }))

export const fetchTeam = async () => (await call<{ team: User[] }>('/api/admin/team')).team
export const fetchActivity = async (limit = 50) => (await call<{ activity: ActivityItem[] }>(`/api/admin/activity?limit=${limit}`)).activity

export function whenShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
