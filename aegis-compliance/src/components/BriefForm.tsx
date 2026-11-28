import { useState } from 'react'
import { Sparkles } from 'lucide-react'

import { createBrief } from '../lib/aegis'
import type { Brief } from '../lib/aegis'
import { Button } from './Button'
import { Field, Input, Textarea } from './Field'

const MIN_COPY = 40

/** Three fields: the company, its homepage claims, and its privacy policy. */
export function BriefForm({ onDone }: { onDone: (brief: Brief) => void }) {
  const [company, setCompany] = useState('')
  const [homepage, setHomepage] = useState('')
  const [privacy, setPrivacy] = useState('')
  const [local, setLocal] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setLocal(null)
    if (!company.trim()) {
      setLocal('Enter the company name (and URL if you have it).')
      return
    }
    if (homepage.trim().length < MIN_COPY) {
      setLocal(`Paste at least ${MIN_COPY} characters of homepage or product copy.`)
      return
    }
    if (privacy.trim().length < MIN_COPY) {
      setLocal(`Paste at least ${MIN_COPY} characters of the privacy policy.`)
      return
    }
    setSubmitting(true)
    try {
      onDone(await createBrief({ company: company.trim(), homepage, privacy }))
    } catch (caught) {
      setLocal((caught as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Company name & URL" hint="Used in the report title, e.g. “Acme Inc — https://acme.com”.">
        {(props) => (
          <Input
            {...props}
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Acme Inc — https://acme.com"
            autoComplete="organization"
          />
        )}
      </Field>

      <Field
        label="Homepage / product copy"
        hint="Paste the landing-page marketing and feature claims you want checked."
      >
        {(props) => (
          <Textarea
            {...props}
            value={homepage}
            onChange={(event) => setHomepage(event.target.value)}
            placeholder={'“Our AI screens every applicant in seconds. 100% unbiased decisions…”'}
            className="min-h-[150px]"
          />
        )}
      </Field>

      <Field label="Privacy policy text" hint="Paste the full policy, or the sections covering AI, data sharing and retention.">
        {(props) => (
          <Textarea
            {...props}
            value={privacy}
            onChange={(event) => setPrivacy(event.target.value)}
            placeholder="Paste the privacy policy text here…"
            className="min-h-[170px]"
          />
        )}
      </Field>

      {local ? (
        <p role="alert" className="text-[13px] text-danger">
          {local}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void submit()} loading={submitting}>
          <Sparkles className="size-4" aria-hidden />
          {submitting ? 'Reading the public footprint…' : 'Run mini-audit'}
        </Button>
        <span className="text-[13px] text-faint">Top 3 gaps, quoted verbatim, about a minute.</span>
      </div>
    </div>
  )
}
