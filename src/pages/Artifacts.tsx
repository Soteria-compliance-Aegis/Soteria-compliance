import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Check, Copy, Download, Printer, Wrench } from 'lucide-react'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Notice } from '../components/Controls'
import { Field, Input, Select, Textarea } from '../components/Field'
import { Eyebrow } from '../components/Typography'
import {
  createArtifact,
  fetchArtifact,
  fetchArtifacts,
  fetchDiffs,
  fetchRedTeamRuns,
  formatWhen,
} from '../lib/aegis'
import type { Artifact, ArtifactKind, ArtifactSummary, DiffSummary, RedTeamSummary } from '../lib/aegis'
import { Link, navigate } from '../lib/router'

const KINDS: { id: ArtifactKind; title: string; body: string }[] = [
  {
    id: 'disclosure_notice',
    title: 'Pre-Use & AI Disclosure Notice',
    body: 'A notice for the product flow: AI identity, purpose, data touched, human review and contact route.',
  },
  {
    id: 'vendor_checklist',
    title: 'Vendor & Model-Training Checklist',
    body: 'The questions to put to every LLM/API vendor: retention, training opt-out, DPAs, subprocessors, security.',
  },
  {
    id: 'buyer_faq',
    title: 'Enterprise Buyer Governance FAQ',
    body: 'Draft answers on data isolation, human oversight and testing for the next security review.',
  },
]

function Generator() {
  const [kind, setKind] = useState<ArtifactKind>('disclosure_notice')
  const [company, setCompany] = useState('')
  const [product, setProduct] = useState('')
  const [diffId, setDiffId] = useState('')
  const [runId, setRunId] = useState('')
  const [notes, setNotes] = useState('')
  const [diffs, setDiffs] = useState<DiffSummary[]>([])
  const [runs, setRuns] = useState<RedTeamSummary[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDiffs().then(setDiffs).catch(() => setDiffs([]))
    fetchRedTeamRuns().then(setRuns).catch(() => setRuns([]))
    fetchArtifacts().then(setArtifacts).catch(() => setArtifacts([]))
  }, [])

  const submit = async () => {
    setError(null)
    if (!company.trim()) {
      setError('Enter the company name.')
      return
    }
    if (!diffId && !runId && !product.trim()) {
      setError('Link a footprint audit or red-team run, or describe the product so the draft has context.')
      return
    }
    setSubmitting(true)
    try {
      const artifact = await createArtifact({
        kind,
        company: company.trim(),
        product: product.trim(),
        notes: notes.trim(),
        diffId: diffId || undefined,
        redteamRunId: runId || undefined,
      })
      navigate(`/artifacts/${artifact.id}`)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <section className="pt-10 pb-7 sm:pt-14">
        <Eyebrow tone="fire">Workflow 3 · Fix artifacts</Eyebrow>
        <h1 className="display mt-3 max-w-[760px] text-balance text-[36px] sm:text-[48px]">
          Turn findings into the documents buyers ask for.
        </h1>
        <p className="mt-4 max-w-[680px] text-pretty text-[16px] leading-[1.6] text-muted">
          Each draft is generated from your actual audit evidence, uses bracketed placeholders where a fact is
          unknown, and is labelled an operational template for counsel review. No invented vendor names, no legal
          conclusions.
        </p>
      </section>

      <div className="flex flex-col gap-2">
        <Card tone="plain" className="p-5 sm:p-6">
          <h2 className="text-[16px] font-medium text-white">1 · Choose the artifact</h2>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {KINDS.map((item) => {
              const selected = kind === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setKind(item.id)}
                  className={`relative flex h-full flex-col gap-1.5 rounded-[18px] p-4 text-left ring-1 ring-inset transition-colors ${
                    selected
                      ? 'bg-fire-1/10 ring-fire-2/60'
                      : 'bg-white/[0.04] ring-white/10 hover:bg-white/[0.07] hover:ring-white/20'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 text-[14px] font-medium text-white">
                    {item.title}
                    <span
                      className={`round grid size-4 place-items-center rounded-full ${
                        selected ? 'bg-fire-2 text-black' : 'ring-1 ring-white/25'
                      }`}
                      aria-hidden
                    >
                      {selected ? <Check className="size-2.5" strokeWidth={3} /> : null}
                    </span>
                  </span>
                  <span className="text-[13px] leading-relaxed text-muted">{item.body}</span>
                </button>
              )
            })}
          </div>
        </Card>

        <Card tone="plain" className="p-5 sm:p-6">
          <h2 className="text-[16px] font-medium text-white">2 · Ground it in evidence</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Company">
              {(props) => (
                <Input {...props} value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Acme AI" />
              )}
            </Field>
            <Field label="Product / workflow" optional hint="The agent's users, data and escalation path.">
              {(props) => (
                <Input {...props} value={product} onChange={(event) => setProduct(event.target.value)} placeholder="Acme Support Copilot" />
              )}
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Footprint audit" optional hint="Uses the gaps found in the claim-vs-policy diff.">
              {(props) => (
                <Select {...props} value={diffId} onChange={(event) => setDiffId(event.target.value)}>
                  <option value="">Not linked</option>
                  {diffs.map((diff) => (
                    <option key={diff.id} value={diff.id}>
                      {diff.company} · {formatWhen(diff.createdAt)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Red-team run" optional hint="Turns failed or inconclusive probes into specific fixes.">
              {(props) => (
                <Select {...props} value={runId} onChange={(event) => setRunId(event.target.value)}>
                  <option value="">Not linked</option>
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.company} · {run.mode === 'live' ? 'live' : 'simulated'} · {formatWhen(run.createdAt)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Team notes" optional hint="Anything the draft must include or avoid: contacts, retention, vendors.">
              {(props) => (
                <Textarea
                  {...props}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Use [SECURITY CONTACT] for the mailbox; we do not have a SOC 2 yet; the model vendor is undecided."
                  className="min-h-[100px]"
                />
              )}
            </Field>
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-[13px] text-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => void submit()} loading={submitting}>
              <Wrench className="size-4" aria-hidden />
              {submitting ? 'Drafting…' : 'Generate draft'}
            </Button>
            <span className="text-[13px] text-faint">Operational template, not legal advice.</span>
          </div>
        </Card>

        <Card tone="plain" className="p-5 sm:p-6">
          <h2 className="text-[16px] font-medium text-white">Saved drafts</h2>
          {artifacts.length === 0 ? (
            <p className="mt-2 text-[14px] text-muted">No artifact has been generated yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.07]">
              {artifacts.slice(0, 8).map((artifact) => (
                <li key={artifact.id}>
                  <Link
                    href={`/artifacts/${artifact.id}`}
                    className="group flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-soft group-hover:text-white">{artifact.title}</span>
                      <span className="text-[12px] text-faint">
                        {artifact.company} · {formatWhen(artifact.createdAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-[12px] text-faint">
                      {artifact.placeholders.length} placeholders
                      <ArrowUpRight className="size-4" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}

function ArtifactView({ id }: { id: string }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    fetchArtifact(id)
      .then(setArtifact)
      .catch((caught: Error) => setError(caught.message))
  }, [id])

  const copy = async () => {
    if (!artifact) return
    try {
      await navigator.clipboard.writeText(artifact.markdown)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('failed')
    }
  }

  const download = () => {
    if (!artifact) return
    const blob = new Blob([artifact.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${artifact.kind}-${artifact.company.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (error) {
    return (
      <div className="pt-8">
        <Link href="/artifacts" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> Fix artifacts
        </Link>
        <Notice tone="error" title="Could not load this draft" className="mt-3">
          {error}
        </Notice>
      </div>
    )
  }

  if (!artifact) {
    return (
      <div className="flex items-center gap-3 py-16 text-[14px] text-muted">
        <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden />
        Loading the draft…
      </div>
    )
  }

  return (
    <div className="pt-8 pb-4">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/artifacts" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> Fix artifacts
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            {copyState === 'copied' ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy Markdown'}
          </Button>
          <Button variant="secondary" size="sm" onClick={download}>
            <Download className="size-3.5" aria-hidden />
            .md
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-3.5" aria-hidden />
            Print / Save as PDF
          </Button>
        </div>
      </div>

      <article className="brief-paper mx-auto max-w-[880px] rounded-[14px] bg-white px-7 py-8 text-neutral-900 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] sm:px-10 sm:py-10">
        <header className="border-b border-neutral-300 pb-4">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] sm:text-[25px]">{artifact.title}</h1>
          <p className="mt-1.5 text-[11.5px] text-neutral-600">
            <span className="font-semibold text-neutral-800">Prepared for:</span> {artifact.company}
            {artifact.product ? ` · ${artifact.product}` : ''} |{' '}
            <span className="font-semibold text-neutral-800">Status:</span> Operational draft — counsel review required
          </p>
          {artifact.sources.length ? (
            <p className="mt-1 text-[11px] text-neutral-500">Grounded in: {artifact.sources.join(', ')}</p>
          ) : null}
        </header>

        <section className="mt-4 rounded-[6px] border border-neutral-300 bg-neutral-50 px-3 py-2">
          <p className="text-[11.5px] font-semibold text-neutral-800">Fill before use</p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {artifact.placeholders.map((placeholder) => (
              <span key={placeholder} className="rounded-full border border-neutral-300 px-2 py-0.5 font-mono text-[10.5px] text-neutral-700">
                {placeholder}
              </span>
            ))}
          </p>
        </section>

        <pre className="mt-5 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.65] text-neutral-800">
          {artifact.markdown}
        </pre>

        <hr className="my-4 border-neutral-300" />
        <p className="text-[11px] italic leading-relaxed text-neutral-600">{artifact.note}</p>
      </article>
    </div>
  )
}

export function ArtifactsPage({ artifactId }: { artifactId?: string }) {
  return artifactId ? <ArtifactView id={artifactId} /> : <Generator />
}
