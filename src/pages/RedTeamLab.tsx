import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Bug, Play, Printer } from 'lucide-react'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip, Notice } from '../components/Controls'
import { Field, Input, Textarea } from '../components/Field'
import { Eyebrow } from '../components/Typography'
import { createRedTeamRun, fetchHealth, fetchRedTeamRun, fetchRedTeamRuns, formatWhen } from '../lib/aegis'
import type { ProbeDefinition, ProbeResult, ProbeStatus, RedTeamRun, RedTeamSummary } from '../lib/aegis'
import { Link, navigate } from '../lib/router'

/* ------------------------------------------------------------------ */
/* Run form                                                           */
/* ------------------------------------------------------------------ */

type Mode = 'simulated' | 'live'

function Lab() {
  const [mode, setMode] = useState<Mode>('simulated')
  const [company, setCompany] = useState('')
  const [product, setProduct] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [model, setModel] = useState('')
  const [headers, setHeaders] = useState('')
  const [spec, setSpec] = useState('')
  const [probes, setProbes] = useState<ProbeDefinition[]>([])
  const [runs, setRuns] = useState<RedTeamSummary[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchHealth()
      .then((health) => setProbes(health.redteamProbes ?? []))
      .catch(() => setProbes([]))
    fetchRedTeamRuns()
      .then(setRuns)
      .catch(() => setRuns([]))
  }, [])

  const groups = useMemo(() => {
    const map = new Map<string, ProbeDefinition[]>()
    for (const probe of probes) {
      map.set(probe.category, [...(map.get(probe.category) ?? []), probe])
    }
    return [...map.entries()]
  }, [probes])

  const submit = async () => {
    setError(null)
    if (!company.trim()) {
      setError('Enter the company or product owner name.')
      return
    }
    if (mode === 'live' && !endpoint.trim()) {
      setError('Live mode needs the chat endpoint URL that accepts OpenAI-style messages.')
      return
    }
    if (mode === 'simulated' && spec.trim().length < 60) {
      setError('Paste at least a short product specification (60+ characters) so the dry-run has behaviour to simulate.')
      return
    }
    setSubmitting(true)
    try {
      const run = await createRedTeamRun({
        company: company.trim(),
        product: product.trim(),
        mode,
        endpoint: mode === 'live' ? endpoint.trim() : '',
        headers: mode === 'live' ? headers : '',
        model: mode === 'live' ? model.trim() : '',
        spec: spec.trim(),
      })
      navigate(`/redteam/${run.id}`)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <section className="pt-10 pb-7 sm:pt-14">
        <Eyebrow tone="fire">Workflow 2 · Red-team lab</Eyebrow>
        <h1 className="display mt-3 max-w-[760px] text-balance text-[36px] sm:text-[48px]">
          Test the agent, not just the policy.
        </h1>
        <p className="mt-4 max-w-[680px] text-pretty text-[16px] leading-[1.6] text-muted">
          Eight bounded, non-destructive probes across AI disclosure, prompt injection, PII leakage and decision
          guardrails. Point them at a live chat endpoint, or dry-run them from the product specification. Every
          transcript is stored so a buyer can see what failed.
        </p>
      </section>

      <div className="flex flex-col gap-2">
        <Card tone="plain" className="p-5 sm:p-6">
          <h2 className="text-[16px] font-medium text-white">Target</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip selected={mode === 'simulated'} onClick={() => setMode('simulated')}>
              Dry-run from spec
            </Chip>
            <Chip selected={mode === 'live'} onClick={() => setMode('live')}>
              Live endpoint
            </Chip>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Company / owner">
              {(props) => (
                <Input {...props} value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Acme AI" />
              )}
            </Field>
            <Field label="Product or agent name" optional>
              {(props) => (
                <Input {...props} value={product} onChange={(event) => setProduct(event.target.value)} placeholder="Acme Support Copilot" />
              )}
            </Field>
          </div>

          {mode === 'live' ? (
            <div className="mt-4 grid gap-4">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <Field
                  label="Chat endpoint"
                  hint="Must accept POST { messages: [{ role, content }] } and return an assistant reply."
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={endpoint}
                      onChange={(event) => setEndpoint(event.target.value)}
                      placeholder="https://api.acme.com/v1/chat/completions"
                      inputMode="url"
                      autoComplete="url"
                    />
                  )}
                </Field>
                <Field label="Model name" optional hint="Sent as the model field when your endpoint needs one.">
                  {(props) => (
                    <Input {...props} value={model} onChange={(event) => setModel(event.target.value)} placeholder="acme-agent-v2" />
                  )}
                </Field>
              </div>
              <Field
                label="Headers / auth"
                optional
                hint="One “Key: Value” per line, e.g. Authorization: Bearer … Kept in memory for this request only."
              >
                {(props) => (
                  <Textarea
                    {...props}
                    value={headers}
                    onChange={(event) => setHeaders(event.target.value)}
                    placeholder={'Authorization: Bearer [TEST TOKEN]\nX-Org: acme-test'}
                    className="min-h-[100px] font-mono text-[13px]"
                  />
                )}
              </Field>
            </div>
          ) : null}

          <div className="mt-4">
            <Field
              label="Product specification"
              hint={
                mode === 'live'
                  ? 'Optional context for the evaluator: how the agent is meant to behave.'
                  : 'Required for a dry-run: describe the agent, its users, its data and its refusal or escalation rules.'
              }
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={spec}
                  onChange={(event) => setSpec(event.target.value)}
                  placeholder={
                    'Acme Copilot answers billing questions for logged-in customers. It can read the current account, cannot issue refunds over $50, and must hand off to a human for legal or account-closure requests…'
                  }
                  className="min-h-[160px]"
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
              <Play className="size-4" aria-hidden />
              {submitting ? 'Running probes…' : 'Run red-team pass'}
            </Button>
            <span className="text-[13px] text-faint">
              {mode === 'live'
                ? 'Probes are spaced one second apart with a 15-second timeout each.'
                : 'Dry-run replies are simulated from the spec, not observed — labelled as such.'}
            </span>
          </div>
        </Card>

        <Card tone="plain" className="p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[16px] font-medium text-white">Probes in this pass</h2>
            <span className="text-[13px] text-faint">{probes.length || 8} probes</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {groups.map(([category, items]) => (
              <div key={category} className="rounded-[16px] bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.08]">
                <p className="text-[13px] font-medium text-soft">{category}</p>
                <ul className="mt-2 space-y-1.5">
                  {items.map((probe) => (
                    <li key={probe.id} className="text-[13px] leading-snug text-muted">
                      <span className="font-mono text-[11px] text-faint">{probe.id}</span>
                      <span className="mx-1.5 text-white/20">·</span>
                      {probe.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {groups.length === 0 ? (
              <p className="text-[13px] text-faint">
                Start the API to load the probe catalogue. The pass covers AI disclosure, prompt injection, PII
                leakage and decision guardrails.
              </p>
            ) : null}
          </div>
        </Card>

        <Card tone="plain" className="p-5 sm:p-6">
          <h2 className="text-[16px] font-medium text-white">Recent runs</h2>
          {runs.length === 0 ? (
            <p className="mt-2 text-[14px] text-muted">No red-team pass has been run in this workspace yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.07]">
              {runs.slice(0, 6).map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/redteam/${run.id}`}
                    className="group flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-soft group-hover:text-white">
                        {run.company}
                        {run.product ? ` — ${run.product}` : ''}
                      </span>
                      <span className="text-[12px] text-faint">
                        {run.mode === 'live' ? 'Live endpoint' : 'Simulated dry-run'} · {formatWhen(run.createdAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-[12px]">
                      <span className={run.counts.fail > 0 ? 'text-fire-3' : 'text-success'}>
                        {run.counts.fail} fail
                      </span>
                      <span className="text-faint">{run.counts.pass} pass</span>
                      <ArrowUpRight className="size-4 text-faint" aria-hidden />
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

/* ------------------------------------------------------------------ */
/* Saved run                                                          */
/* ------------------------------------------------------------------ */

const STATUS_STYLE: Record<ProbeStatus, string> = {
  Pass: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300',
  Fail: 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-300',
  Inconclusive: 'bg-neutral-100 text-neutral-700 ring-1 ring-inset ring-neutral-300',
}

function ResultBlock({ result, index }: { result: ProbeResult; index: number }) {
  return (
    <section className="break-inside-avoid border-t border-neutral-300 pt-3.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[13.5px] font-semibold leading-snug">
          {index + 1}. {result.name}
        </h3>
        <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${STATUS_STYLE[result.status]}`}>
          {result.status}
        </span>
        <span className="text-[11px] text-neutral-500">{result.category}</span>
      </div>

      <p className="mt-2 text-[11.5px] font-semibold text-neutral-700">Prompt sent</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words rounded-[6px] bg-neutral-100 px-2.5 py-1.5 font-mono text-[11px] leading-snug text-neutral-800">
        {result.prompt}
      </p>

      <p className="mt-2 text-[11.5px] font-semibold text-neutral-700">
        Observed response {result.simulated ? '(simulated)' : ''}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap break-words rounded-[6px] bg-neutral-50 px-2.5 py-1.5 text-[11.5px] italic leading-snug text-neutral-800 ring-1 ring-inset ring-neutral-200">
        “{result.observed}”
      </p>

      <p className="mt-2 text-[12.5px] leading-[1.55]">
        <span className="font-semibold">Risk:</span> {result.risk}
      </p>
      <p className="mt-0.5 text-[12.5px] leading-[1.55]">
        <span className="font-semibold">Fix:</span> {result.fix}
      </p>
    </section>
  )
}

export function RedTeamReport({ id }: { id: string }) {
  const [run, setRun] = useState<RedTeamRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchRedTeamRun(id)
      .then(setRun)
      .catch((caught: Error) => setError(caught.message))
  }, [id])

  if (error) {
    return (
      <div className="pt-8">
        <Link href="/redteam" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> Red-team lab
        </Link>
        <Notice tone="error" title="Could not load this run" className="mt-3">
          {error}
        </Notice>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="flex items-center gap-3 py-16 text-[14px] text-muted">
        <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden />
        Loading the transcripts…
      </div>
    )
  }

  return (
    <div className="pt-8 pb-4">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/redteam" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> Red-team lab
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/artifacts"
            className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white"
          >
            Generate fix drafts
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
          <Button onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            Print / Save as PDF
          </Button>
        </div>
      </div>

      <article className="brief-paper mx-auto max-w-[880px] rounded-[14px] bg-white px-7 py-8 text-neutral-900 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] sm:px-10 sm:py-10">
        <header className="border-b border-neutral-300 pb-4">
          <h1 className="text-[23px] font-semibold leading-tight tracking-[-0.02em] sm:text-[26px]">
            AI Red-Team Readiness Report: {run.company}
          </h1>
          <p className="mt-1.5 text-[11.5px] text-neutral-600">
            <span className="font-semibold text-neutral-800">Scope:</span>{' '}
            {run.mode === 'live' ? `Live endpoint — ${run.target}` : 'Simulated dry-run from the product spec'} |{' '}
            <span className="font-semibold text-neutral-800">Status:</span> Non-Legal Technical Readiness Check
            {run.product ? ` | ${run.product}` : ''}
          </p>
        </header>

        <section className="mt-4">
          <h2 className="text-[15px] font-semibold">Executive Snapshot</h2>
          <p className="mt-1.5 text-[12.5px] leading-[1.55] text-neutral-800">
            {run.counts.fail > 0
              ? `${run.counts.fail} of ${run.counts.total} probes failed. The highest-risk failures are the ones a buyer's security reviewer will reproduce first; fix them before the next review.`
              : run.counts.inconclusive > 0
                ? `No probe failed, but ${run.counts.inconclusive} could not be graded. Re-run those before treating this as evidence.`
                : `All ${run.counts.total} probes passed. Keep the transcripts as evidence and re-run after any model, prompt or tool change.`}
          </p>
          <p className="mt-2 flex flex-wrap gap-3 text-[11px] text-neutral-600">
            <span>{run.counts.pass} pass</span>
            <span>{run.counts.fail} fail</span>
            <span>{run.counts.inconclusive} inconclusive</span>
            <span>·</span>
            <span>{run.counts.total} probes</span>
            <span>·</span>
            <span>{formatWhen(run.createdAt)}</span>
          </p>
        </section>

        {run.warnings.length ? (
          <div className="mt-3 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
            {run.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}

        <div className="mt-4 space-y-3.5">
          {run.results.map((result, index) => (
            <ResultBlock key={result.probeId} result={result} index={index} />
          ))}
        </div>

        <hr className="my-4 border-neutral-300" />
        <p className="text-[11px] italic leading-relaxed text-neutral-600">{run.note}</p>
      </article>
    </div>
  )
}

export function RedTeamLab() {
  return (
    <div>
      <div className="no-print mb-1 flex items-center gap-2 text-[12px] text-faint">
        <Bug className="size-4" aria-hidden />
        Non-destructive probes only — no data modification, no denial-of-service testing.
      </div>
      <Lab />
    </div>
  )
}
