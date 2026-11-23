import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Printer } from 'lucide-react'

import { Button } from '../components/Button'
import { Notice } from '../components/Controls'
import { MISSING_FROM_POLICY, fetchDiff } from '../lib/aegis'
import type { Diff, DiffGap, DiffSeverity } from '../lib/aegis'
import { Link } from '../lib/router'

const SEVERITY_STYLE: Record<DiffSeverity, string> = {
  Critical: 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-300',
  High: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300',
  Medium: 'bg-neutral-100 text-neutral-700 ring-1 ring-inset ring-neutral-300',
}

function Severity({ value }: { value: DiffSeverity }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${SEVERITY_STYLE[value]}`}>
      {value}
    </span>
  )
}

function Gap({ gap, index }: { gap: DiffGap; index: number }) {
  const missing = gap.policy_quote === MISSING_FROM_POLICY
  return (
    <section className="break-inside-avoid border-t border-neutral-300 pt-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13.5px] font-semibold leading-snug">
          {index + 1}. {gap.title}
        </h3>
        <Severity value={gap.severity} />
      </div>

      <p className="mt-2 text-[12.5px] leading-snug">
        <span className="font-semibold italic">Public Claim:</span>{' '}
        <span className="italic">“{gap.claim_quote}”</span>
      </p>
      <p className="mt-0.5 text-[11px] text-neutral-500">Source: {gap.claim_source}</p>

      <p className="mt-2 text-[12.5px] leading-snug">
        <span className="font-semibold italic">Privacy Policy:</span>{' '}
        {missing ? (
          <span className="font-semibold">{MISSING_FROM_POLICY}</span>
        ) : (
          <span className="italic">“{gap.policy_quote}”</span>
        )}
      </p>
      <p className="mt-0.5 text-[11px] text-neutral-500">Source: {gap.policy_source}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] font-semibold">Mapped frameworks:</span>
        {gap.frameworks.map((framework) => (
          <span
            key={framework.id}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[10.5px] text-neutral-700"
          >
            {framework.name}
            <span className="text-neutral-400">·</span>
            <span className={framework.status === 'Upcoming deadline' ? 'font-semibold text-neutral-800' : ''}>
              {framework.deadline}
            </span>
          </span>
        ))}
      </div>

      <p className="mt-2 text-[12.5px] leading-[1.55]">
        <span className="font-semibold">Why it matters:</span> {gap.why_it_matters}
      </p>
      <p className="mt-0.5 text-[12.5px] leading-[1.55]">
        <span className="font-semibold">Fix:</span> {gap.remediation}
      </p>
    </section>
  )
}

export function DiffReport({ id }: { id: string }) {
  const [diff, setDiff] = useState<Diff | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDiff(id)
      .then(setDiff)
      .catch((caught: Error) => setError(caught.message))
  }, [id])

  if (error) {
    return (
      <div className="pt-8">
        <Link href="/audit" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> Footprint audit
        </Link>
        <Notice tone="error" title="Could not load this audit" className="mt-3">
          {error}
        </Notice>
      </div>
    )
  }

  if (!diff) {
    return (
      <div className="flex items-center gap-3 py-16 text-[14px] text-muted">
        <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden />
        Loading the diff…
      </div>
    )
  }

  return (
    <div className="pt-8 pb-4">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/audit" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> Footprint audit
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/artifacts"
            className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-white"
          >
            Turn into fix drafts
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
            Public AI Footprint &amp; Compliance Diff: {diff.company}
          </h1>
          <p className="mt-1.5 text-[11.5px] text-neutral-600">
            <span className="font-semibold text-neutral-800">Scope:</span> Public claims × Privacy Policy |{' '}
            <span className="font-semibold text-neutral-800">Status:</span> Non-Legal Technical Readiness Check
            {diff.url ? ` | ${diff.url}` : ''}
          </p>
        </header>

        <section className="mt-4">
          <h2 className="text-[15px] font-semibold">Executive Snapshot</h2>
          <p className="mt-1.5 text-[12.5px] leading-[1.55] text-neutral-800">{diff.summary}</p>
          <p className="mt-2 flex flex-wrap gap-3 text-[11px] text-neutral-600">
            <span>{diff.counts.critical} critical</span>
            <span>{diff.counts.high} high</span>
            <span>{diff.counts.medium} medium</span>
            <span>·</span>
            <span>{diff.coverage.claimsChars.toLocaleString()} chars of claims</span>
            <span>{diff.coverage.policyChars.toLocaleString()} chars of policy</span>
          </p>
        </section>

        <div className="mt-4 space-y-3.5">
          {diff.gaps.length === 0 ? (
            <p className="border-t border-neutral-300 pt-4 text-[12.5px] leading-relaxed text-neutral-800">
              No high-confidence mismatch was found between the supplied public claims and privacy disclosures.
              This is not a clean bill of health: it only reflects the text that was reviewed.
            </p>
          ) : (
            diff.gaps.map((gap, index) => <Gap key={gap.id} gap={gap} index={index} />)
          )}
        </div>

        <hr className="my-4 border-neutral-300" />
        <p className="text-[11px] italic leading-relaxed text-neutral-600">{diff.note}</p>
      </article>
    </div>
  )
}
