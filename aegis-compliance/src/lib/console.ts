/* Typed client for the dev console endpoints (server.py). */

export type ModelEntry = {
  id: string
  label: string
  tier: 'production' | 'preview'
  tpm: number
  context: number
  note: string
}

export type ConsoleModels = {
  deep: string
  fast: string
  defaults: { deep: string; fast: string }
  budgetTpm: number
  catalog: ModelEntry[]
}

export type BudgetWindow = {
  tpm: number
  used: number
  remaining: number
  windowSeconds: number
  resetsInSeconds: number
}

export type ConsoleTool = {
  id: string
  index: string
  title: string
  purpose: string
  href: string
  action: string
  records: { count: number; latest: string | null }
}

export type ActivityItem = {
  id: string
  kind: string
  title: string
  detail: string
  createdAt: string
  href: string
}

export type ConsoleData = {
  models: ConsoleModels
  budget: BudgetWindow
  keyConfigured: boolean
  tools: ConsoleTool[]
  activity: ActivityItem[]
  limits: {
    maxChars: number
    maxUploadBytes: number
    redteamProbes: number
    rubrics: number
    artifactKinds: number
    fetchTimeoutSeconds: number
  }
  checkedAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { detail?: string }
      if (body?.detail) message = body.detail
    } catch {
      /* keep the status line when the body is not JSON */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export const fetchConsole = () => request<ConsoleData>('/api/console')

export const saveModels = (models: { deep: string; fast: string }) =>
  request<ConsoleData>('/api/console/models', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(models),
  })
