import { Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { cx } from '../lib/cx'
import { addLeadNote, deleteLead, fetchLead, fetchLeads, fetchTeam, LEAD_STATUSES, patchLead, whenShort } from '../lib/portal'
import type { Lead, LeadNote, LeadStatus, User } from '../lib/portal'
import { PageTitle } from './AdminShell'

export const STATUS_STYLE: Record<LeadStatus, string> = {
  new: 'bg-plasma/25 text-ink ring-plasma/50',
  contacted: 'bg-black/[0.06] text-soft ring-black/15',
  qualified: 'bg-warn/15 text-warn ring-warn/30',
  won: 'bg-pass/15 text-pass ring-pass/30',
  lost: 'bg-black/[0.05] text-faint ring-black/10',
}

function StatusPill({ s }: { s: LeadStatus }) {
  return <span className={cx('inline-flex rounded-control px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] ring-1 ring-inset', STATUS_STYLE[s])}>{s}</span>
}

const INTEREST: Record<string, string> = { scorecard: 'Scorecard', audit: 'Core audit', retainer: 'Retainer', other: 'Other' }

export function Leads() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | string | null>(null)

  const load = useCallback(() => {
    fetchLeads({ status: status || undefined, q: q || undefined })
      .then((r) => (setLeads(r.leads), setError(null)))
      .catch((e) => setError((e as Error).message))
  }, [status, q])

  useEffect(() => {
    const t = window.setTimeout(load, q ? 250 : 0)
    return () => window.clearTimeout(t)
  }, [load, q])

  return (
    <>
      <PageTitle eyebrow="Inbound" title="Leads" />
      <div className="px-5 pb-12 sm:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1 sm:max-w-[360px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, company, email"
              aria-label="Search leads"
              className="h-11 w-full rounded-control bg-raised pl-10 pr-4 text-[14.5px] outline-none ring-1 ring-inset ring-line-strong focus:ring-2 focus:ring-ink"
            />
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
            {['', ...LEAD_STATUSES].map((s) => (
              <button
                key={s || 'all'}
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={cx('h-9 rounded-control px-4 text-[13.5px] capitalize ring-1 ring-inset transition-colors', status === s ? 'bg-ink text-cream ring-ink' : 'text-soft ring-line-strong hover:bg-black/[0.05]')}
              >
                {s || 'All'}
              </button>
            ))}
          </div>
        </div>
        {error ? <p role="alert" className="mb-3 text-[14px] text-fail">{error}</p> : null}
        <div className="overflow-hidden rounded-[24px] bg-surface ring-1 ring-line">
          {leads === null ? (
            <div className="h-48 animate-pulse bg-black/5" />
          ) : leads.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-[18px] font-semibold tracking-[-0.02em]">No leads {status || q ? 'match that filter' : 'yet'}.</p>
              <p className="mt-1.5 text-[14px] text-muted">Submissions from the website form land here, and a Slack or Discord alert goes out if a webhook is set.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
                    <th className="px-5 py-3.5 font-normal">Who</th>
                    <th className="px-3 py-3.5 font-normal">Interest</th>
                    <th className="px-3 py-3.5 font-normal">Status</th>
                    <th className="px-3 py-3.5 font-normal">Owner</th>
                    <th className="px-5 py-3.5 text-right font-normal">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} onClick={() => setOpenId(l.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-raised">
                      <td className="px-5 py-4">
                        <button type="button" onClick={() => setOpenId(l.id)} className="text-left">
                          <span className="block font-medium">{l.name}</span>
                          <span className="block text-[13px] text-muted">{l.company} · {l.email}</span>
                        </button>
                      </td>
                      <td className="px-3 py-4 text-soft">{INTEREST[l.interest] ?? l.interest}</td>
                      <td className="px-3 py-4"><StatusPill s={l.status} /></td>
                      <td className="px-3 py-4 text-soft">{l.assignee ?? '—'}</td>
                      <td className="px-5 py-4 text-right font-mono text-[12px] text-faint">{whenShort(l.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {openId !== null ? <LeadDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} /> : null}
    </>
  )
}

function LeadDrawer({ id, onClose, onChanged }: { id: number | string; onClose: () => void; onChanged: () => void }) {
  const [lead, setLead] = useState<(Lead & { notes: LeadNote[] }) | null>(null)
  const [team, setTeam] = useState<User[]>([])
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(() => fetchLead(id).then(setLead).catch((e) => setErr((e as Error).message)), [id])
  useEffect(() => {
    void reload()
    fetchTeam().then(setTeam).catch(() => setTeam([]))
  }, [reload])
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])

  async function update(body: { status?: LeadStatus; assignee?: string | null }) {
    try {
      await patchLead(id, body)
      await reload()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  async function submitNote() {
    if (!note.trim()) return
    try {
      await addLeadNote(id, note.trim())
      setNote('')
      await reload()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  async function remove() {
    if (!window.confirm('Delete this lead and its notes? This cannot be undone.')) return
    try {
      await deleteLead(id)
      onChanged()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const select = 'h-11 w-full rounded-field bg-raised px-3 text-[14.5px] outline-none ring-1 ring-inset ring-line-strong focus:ring-2 focus:ring-ink'

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <aside role="dialog" aria-label="Lead details" className="absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col bg-bg shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <p className="eyebrow-mono text-faint">Lead</p>
            <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.03em]">{lead?.name ?? '…'}</h2>
            {lead ? <p className="text-[13.5px] text-muted">{lead.company}{lead.role ? ` · ${lead.role}` : ''}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full ring-1 ring-inset ring-line-strong"><X className="size-4" /></button>
        </div>
        {lead ? (
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
            <a href={`mailto:${lead.email}`} className="inline-block text-[15px] underline decoration-plasma decoration-2 underline-offset-4">{lead.email}</a>
            <dl className="grid grid-cols-2 gap-4 text-[13.5px]">
              <div><dt className="eyebrow-mono text-faint">Interest</dt><dd className="mt-1">{INTEREST[lead.interest] ?? lead.interest}</dd></div>
              <div><dt className="eyebrow-mono text-faint">Received</dt><dd className="mt-1">{whenShort(lead.created_at)}</dd></div>
            </dl>
            {lead.message ? <p className="rounded-2xl bg-surface p-4 text-[14.5px] leading-relaxed text-soft ring-1 ring-line">{lead.message}</p> : null}
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5 text-[13px] text-soft">Status
                <select value={lead.status} onChange={(e) => void update({ status: e.target.value as LeadStatus })} className={select}>
                  {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-[13px] text-soft">Owner
                <select value={lead.assignee ?? ''} onChange={(e) => void update({ assignee: e.target.value || null })} className={select}>
                  <option value="">Unassigned</option>
                  {team.map((u) => <option key={u.email} value={u.email}>{u.name || u.email}</option>)}
                </select>
              </label>
            </div>
            <div>
              <h3 className="text-[15px] font-semibold">Notes</h3>
              <ul className="mt-3 space-y-3">
                {lead.notes.length === 0 ? <li className="text-[13.5px] text-faint">No notes yet.</li> : null}
                {lead.notes.map((n) => (
                  <li key={n.id} className="rounded-2xl bg-surface p-4 ring-1 ring-line">
                    <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{n.body}</p>
                    <p className="mt-2 font-mono text-[11px] text-faint">{n.author ?? 'Team'} · {whenShort(n.created_at)}</p>
                  </li>
                ))}
              </ul>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000} aria-label="New note" placeholder="Add a note for both of you…" className="mt-3 w-full rounded-field bg-raised p-3 text-[14.5px] outline-none ring-1 ring-inset ring-line-strong focus:ring-2 focus:ring-ink" />
              <button type="button" onClick={() => void submitNote()} disabled={!note.trim()} className="mt-2 h-10 rounded-control bg-ink px-5 text-[14px] font-medium text-cream hover:bg-plasma hover:text-ink disabled:opacity-40">Add note</button>
            </div>
            {err ? <p role="alert" className="text-[14px] text-fail">{err}</p> : null}
          </div>
        ) : (
          <div className="p-6 text-[14px] text-muted">{err ?? 'Loading…'}</div>
        )}
        <div className="border-t border-line px-6 py-4">
          <button type="button" onClick={() => void remove()} className="inline-flex items-center gap-2 text-[13.5px] text-fail hover:underline"><Trash2 className="size-4" aria-hidden /> Delete lead</button>
        </div>
      </aside>
    </div>
  )
}
