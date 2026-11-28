import { CheckCircle2, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { track } from '../lib/analytics'
import type { Interest } from '../lib/portal'
import { submitLead } from '../lib/portal'

const INTERESTS: { id: Interest; label: string }[] = [
  { id: 'scorecard', label: 'Free scorecard' },
  { id: 'audit', label: 'Core audit' },
  { id: 'retainer', label: 'Retainer' },
  { id: 'other', label: 'Something else' },
]

/*
  The one conversion form. A hidden `website` field is a honeypot: people never
  see it, bots fill it, and the server drops the submission silently.
*/
export function LeadForm({ defaultInterest = 'scorecard', dark = false }: { defaultInterest?: Interest; dark?: boolean }) {
  const [interest, setInterest] = useState<Interest>(defaultInterest)
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)

  const field = dark
    ? 'bg-cream/[0.07] text-cream placeholder:text-cream/40 ring-cream/15 focus:ring-plasma'
    : 'bg-raised text-fg placeholder:text-faint ring-line-strong focus:ring-ink'
  const input = `h-12 w-full rounded-field px-4 text-[15px] outline-none ring-1 ring-inset transition-shadow ${field}`
  const label = dark ? 'text-cream/70' : 'text-soft'

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setState('sending')
    setError(null)
    try {
      await submitLead({
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        company: String(form.get('company') ?? ''),
        role: String(form.get('role') ?? '') || undefined,
        interest,
        message: String(form.get('message') ?? '') || undefined,
        website: String(form.get('website') ?? ''),
        consent: form.get('consent') === 'on',
      })
      track('lead_submitted', { interest })
      setState('done')
    } catch (err) {
      setError((err as Error).message)
      setState('idle')
    }
  }

  if (state === 'done') {
    return (
      <div role="status" className={dark ? 'text-cream' : 'text-fg'}>
        <CheckCircle2 className="size-9 text-plasma" aria-hidden />
        <h3 className="mt-4 text-[26px] font-semibold tracking-[-0.03em]">Thanks, we have it.</h3>
        <p className={`mt-2 max-w-[420px] text-[15px] leading-relaxed ${dark ? 'text-cream/70' : 'text-muted'}`}>
          A person on the team will reply to the email you gave. We will confirm timing for your scorecard then.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      onFocus={() => {
        if (!started) {
          setStarted(true)
          track('lead_form_started')
        }
      }}
      className="grid gap-4"
    >
      <fieldset>
        <legend className={`mb-2 text-[13px] ${label}`}>I am interested in</legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((i) => (
            <label key={i.id} className="cursor-pointer">
              <input type="radio" name="interest" value={i.id} checked={interest === i.id} onChange={() => setInterest(i.id)} className="peer sr-only" />
              <span
                className={`inline-flex h-10 items-center rounded-control px-4 text-[14px] ring-1 ring-inset transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-plasma ${
                  dark
                    ? 'text-cream/80 ring-cream/20 peer-checked:bg-plasma peer-checked:text-ink peer-checked:ring-plasma'
                    : 'text-soft ring-line-strong peer-checked:bg-ink peer-checked:text-cream peer-checked:ring-ink'
                }`}
              >
                {i.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={`text-[13px] ${label}`}>Name</span>
          <input name="name" required maxLength={120} autoComplete="name" className={input} />
        </label>
        <label className="grid gap-1.5">
          <span className={`text-[13px] ${label}`}>Work email</span>
          <input name="email" type="email" required maxLength={200} autoComplete="email" className={input} />
        </label>
        <label className="grid gap-1.5">
          <span className={`text-[13px] ${label}`}>Company</span>
          <input name="company" required maxLength={160} autoComplete="organization" className={input} />
        </label>
        <label className="grid gap-1.5">
          <span className={`text-[13px] ${label}`}>Role (optional)</span>
          <input name="role" maxLength={120} autoComplete="organization-title" className={input} />
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className={`text-[13px] ${label}`}>Anything we should know? (optional)</span>
        <textarea name="message" rows={3} maxLength={2000} className={`${input} h-auto py-3 leading-relaxed`} />
      </label>

      {/* Honeypot: hidden from people and from assistive tech. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label className={`flex items-start gap-3 text-[13.5px] leading-snug ${label}`}>
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-[#e65bc4]" />
        <span>I agree that Soteria may email me about this request and store the details I entered. No marketing lists.</span>
      </label>

      {error ? (
        <p role="alert" className={`text-[14px] ${dark ? 'text-[#ffb4a4]' : 'text-fail'}`}>
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={state === 'sending'}
        className={`inline-flex h-[52px] items-center justify-center gap-2 rounded-control px-7 text-[16px] font-medium transition-colors disabled:opacity-60 ${
          dark ? 'bg-plasma text-ink hover:bg-cream' : 'bg-ink text-cream hover:bg-plasma hover:text-ink'
        }`}
      >
        {state === 'sending' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
        {state === 'sending' ? 'Sending…' : 'Send request'}
      </button>
    </form>
  )
}
