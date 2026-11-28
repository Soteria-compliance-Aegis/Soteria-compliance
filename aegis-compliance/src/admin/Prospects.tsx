import { ExternalLink, Plus, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { cx } from '../lib/cx'
import { createProspect, deleteProspect, fetchProspects, patchProspect, SEGMENTS, STAGES } from '../lib/portal'
import type { Prospect, Stage } from '../lib/portal'
import { PageTitle } from './AdminShell'

export function Prospects() {
  const [rows, setRows] = useState<Prospect[] | null>(null)
  const [q, setQ] = useState('')
  const [segment, setSegment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<Prospect | 'new' | null>(null)

  const load = useCallback(() => {
    fetchProspects({ q: q || undefined, segment: segment || undefined })
      .then((r) => (setRows(r.prospects), setError(null)))
      .catch((e) => setError((e as Error).message))
  }, [q, segment])
  useEffect(() => {
    const t = window.setTimeout(load, q ? 250 : 0)
    return () => window.clearTimeout(t)
  }, [load, q])

  async function move(p: Prospect, stage: Stage) {
    setRows((cur) => cur?.map((r) => (r.id === p.id ? { ...r, stage } : r)) ?? cur)
    try {
      await patchProspect(p.id, { stage })
    } catch (e) {
      setError((e as Error).message)
      load()
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="Outbound"
        title="Prospects"
        action={
          <button type="button" onClick={() => setEdit('new')} className="inline-flex h-11 items-center gap-2 rounded-control bg-ink px-5 text-[14.5px] font-medium text-cream hover:bg-plasma hover:text-ink">
            <Plus className="size-4" aria-hidden /> Add prospect
          </button>
        }
      />
      <div className="px-5 pb-12 sm:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search prospects" placeholder="Search companies" className="h-11 w-full rounded-control bg-raised pl-10 pr-4 text-[14.5px] outline-none ring-1 ring-inset ring-line-strong focus:ring-2 focus:ring-ink" />
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by segment">
            {['', ...SEGMENTS].map((s) => (
              <button key={s || 'all'} type="button" aria-pressed={segment === s} onClick={() => setSegment(s)} className={cx('h-9 rounded-control px-4 text-[13.5px] ring-1 ring-inset transition-colors', segment === s ? 'bg-ink text-cream ring-ink' : 'text-soft ring-line-strong hover:bg-black/[0.05]')}>
                {s || 'All segments'}
              </button>
            ))}
          </div>
        </div>
        {error ? <p role="alert" className="mb-3 text-[14px] text-fail">{error}</p> : null}

        {rows === null ? (
          <div className="h-60 animate-pulse rounded-[24px] bg-black/5" />
        ) : rows.length === 0 && !q && !segment ? (
          <div className="rounded-[24px] bg-surface px-6 py-16 text-center ring-1 ring-line">
            <p className="text-[18px] font-semibold tracking-[-0.02em]">No prospects yet.</p>
            <p className="mt-1.5 text-[14px] text-muted">Add the Series A/B AI companies you are targeting, then move them across the pipeline.</p>
          </div>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
            <div className="grid min-w-[1180px] grid-cols-7 gap-3">
              {STAGES.map((s) => {
                const col = rows.filter((r) => r.stage === s.id)
                return (
                  <section key={s.id} aria-label={s.label} className={cx('rounded-[20px] p-2.5', s.id === 'audit_sold' ? 'bg-plasma/20' : 'bg-surface ring-1 ring-line')}>
                    <h2 className="flex items-center justify-between px-2 pb-3 pt-1.5 text-[13px] font-semibold">
                      {s.label}
                      <span className="font-mono text-[11px] font-normal text-faint">{col.length}</span>
                    </h2>
                    <ul className="space-y-2">
                      {col.map((p) => (
                        <li key={p.id} className="rounded-2xl bg-raised p-3 shadow-sm ring-1 ring-line">
                          <button type="button" onClick={() => setEdit(p)} className="block w-full text-left">
                            <span className="block text-[14px] font-medium leading-tight">{p.company}</span>
                            <span className="mt-0.5 block text-[12px] text-faint">{p.segment || '—'}</span>
                          </button>
                          <select aria-label={`Stage for ${p.company}`} value={p.stage} onChange={(e) => void move(p, e.target.value as Stage)} className="mt-2.5 h-8 w-full rounded-lg bg-bg px-2 text-[12px] outline-none ring-1 ring-inset ring-line-strong">
                            {STAGES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                          </select>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </div>
      {edit ? <ProspectDialog prospect={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={load} /> : null}
    </>
  )
}

function ProspectDialog({ prospect, onClose, onSaved }: { prospect: Prospect | null; onClose: () => void; onSaved: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const v = (k: string) => String(f.get(k) ?? '').trim()
    const body = { company: v('company'), url: v('url') || null, privacy_url: v('privacy_url') || null, segment: v('segment') || null, stage: v('stage') as Stage, contact_name: v('contact_name') || null, contact_email: v('contact_email') || null, notes: v('notes') || null }
    setBusy(true)
    setErr(null)
    try {
      if (prospect) await patchProspect(prospect.id, body)
      else await createProspect(body)
      onSaved()
      onClose()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!prospect || !window.confirm(`Delete ${prospect.company}?`)) return
    try {
      await deleteProspect(prospect.id)
      onSaved()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const input = 'h-11 w-full rounded-field bg-raised px-3.5 text-[14.5px] outline-none ring-1 ring-inset ring-line-strong focus:ring-2 focus:ring-ink'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <form onSubmit={save} role="dialog" aria-label={prospect ? 'Edit prospect' : 'Add prospect'} className="relative max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-[28px] bg-bg p-6 shadow-2xl sm:p-8">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[24px] font-semibold tracking-[-0.03em]">{prospect ? prospect.company : 'Add a prospect'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full ring-1 ring-inset ring-line-strong"><X className="size-4" /></button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-[13px] text-soft sm:col-span-2">Company<input name="company" required defaultValue={prospect?.company} className={input} /></label>
          <label className="grid gap-1.5 text-[13px] text-soft">Website<input name="url" defaultValue={prospect?.url ?? ''} placeholder="example.com" className={input} /></label>
          <label className="grid gap-1.5 text-[13px] text-soft">Privacy policy URL<input name="privacy_url" defaultValue={prospect?.privacy_url ?? ''} className={input} /></label>
          <label className="grid gap-1.5 text-[13px] text-soft">Segment
            <select name="segment" defaultValue={prospect?.segment ?? ''} className={input}><option value="">—</option>{SEGMENTS.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label className="grid gap-1.5 text-[13px] text-soft">Stage
            <select name="stage" defaultValue={prospect?.stage ?? 'research'} className={input}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </label>
          <label className="grid gap-1.5 text-[13px] text-soft">Contact name<input name="contact_name" defaultValue={prospect?.contact_name ?? ''} className={input} /></label>
          <label className="grid gap-1.5 text-[13px] text-soft">Contact email<input name="contact_email" type="email" defaultValue={prospect?.contact_email ?? ''} className={input} /></label>
          <label className="grid gap-1.5 text-[13px] text-soft sm:col-span-2">Notes<textarea name="notes" rows={3} defaultValue={prospect?.notes ?? ''} className={`${input} h-auto py-3`} /></label>
        </div>
        {err ? <p role="alert" className="mt-4 text-[14px] text-fail">{err}</p> : null}
        <div className="mt-6 flex items-center justify-between gap-3">
          {prospect ? <button type="button" onClick={() => void remove()} className="inline-flex items-center gap-2 text-[13.5px] text-fail hover:underline"><Trash2 className="size-4" aria-hidden /> Delete</button> : <span />}
          <div className="flex items-center gap-3">
            {prospect?.url ? <a href={/^https?:/.test(prospect.url) ? prospect.url : `https://${prospect.url}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-fg">Site <ExternalLink className="size-3.5" aria-hidden /></a> : null}
            <button type="submit" disabled={busy} className="h-11 rounded-control bg-ink px-6 text-[14.5px] font-medium text-cream hover:bg-plasma hover:text-ink disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
