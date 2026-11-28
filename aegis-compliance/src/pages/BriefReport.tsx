import { useEffect, useState } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'

import { Button } from '../components/Button'
import { Notice } from '../components/Controls'
import { RemediationBreakdown } from '../components/Remediation'
import { fetchBrief, MISSING_FROM_POLICY, remediationOf } from '../lib/aegis'
import type { Brief, BriefGap } from '../lib/aegis'
import { Link } from '../lib/router'

function Evidence({ gap }: { gap: BriefGap }) {
  const missing = gap.privacy_policy_quote === MISSING_FROM_POLICY
  return (
    <div className="mt-1.5 space-y-1">
      <p className="text-[12.5px] leading-snug">
        <span className="font-semibold italic">Homepage Claim:</span>{' '}
        <span className="italic">“{gap.homepage_claim}”</span>
      </p>
      <p className="text-[12.5px] leading-snug">
        <span className="font-semibold italic">Privacy Policy:</span>{' '}
        {missing ? (
          <span className="font-medium">{MISSING_FROM_POLICY}</span>
        ) : (
          <span className="italic">“{gap.privacy_policy_quote}”</span>
        )}
      </p>
    </div>
  )
}

export function BriefReport({ id }: { id: string }) {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchBrief(id)
      .then(setBrief)
      .catch((caught: Error) => setError(caught.message))
  }, [id])

  if (error) {
    return (
      <div className="pt-8">
        <Link href="/workbench" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> New mini-audit
        </Link>
        <Notice tone="error" title="Could not load this mini-audit" className="mt-3">
          {error}
        </Notice>
      </div>
    )
  }

  if (!brief) {
    return (
      <div className="flex items-center gap-3 py-16 text-[14px] text-muted">
        <span className="size-4 animate-spin rounded-full border-2 border-black/20 border-t-white/80" aria-hidden />
        Loading the brief…
      </div>
    )
  }

  return (
    <div className="pt-8 pb-4">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/workbench" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> New mini-audit
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Print / Save as PDF
        </Button>
      </div>

      <article className="brief-paper mx-auto max-w-[820px] rounded-[14px] bg-white px-7 py-8 text-neutral-900 shadow-[0_30px_70px_-35px_rgba(5,5,5,0.4)] sm:px-10 sm:py-10">
        <header className="border-b border-neutral-300 pb-4">
          <h1 className="text-[23px] font-semibold leading-tight tracking-[-0.02em] sm:text-[26px]">
            Public AI Footprint &amp; Compliance Mini-Audit: {brief.company}
          </h1>
          <p className="mt-1.5 text-[11.5px] text-neutral-600">
            <span className="font-semibold text-neutral-800">Scope:</span> Public Website &amp; Privacy Policy Review |{' '}
            <span className="font-semibold text-neutral-800">Status:</span> Non-Legal Technical Readiness Check
          </p>
        </header>

        <section className="mt-4">
          <h2 className="text-[15px] font-semibold">Executive Snapshot</h2>
          <p className="mt-1.5 text-[12.5px] leading-[1.55] text-neutral-800">{brief.snapshot}</p>
        </section>

        <hr className="my-4 border-neutral-300" />

        <div className="space-y-4">
          {brief.gaps.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-neutral-800">
              No high-confidence public gap was found in the supplied text. There is nothing to action from this check.
            </p>
          ) : (
            brief.gaps.map((gap, index) => {
              const plan = remediationOf(gap.remediation_plan)
              return (
              <section key={`${gap.title}-${index}`} className="break-inside-avoid">
                <h3 className="text-[13.5px] font-semibold leading-snug">
                  {index + 1}. {gap.title}
                </h3>
                <ul className="mt-1.5 list-none pl-0">
                  <li className="text-[12.5px] leading-snug">
                    <span className="font-semibold italic">Evidence Found:</span>
                    <Evidence gap={gap} />
                  </li>
                </ul>
                <p className="mt-1.5 text-[12.5px] leading-[1.55]">
                  <span className="font-semibold">Regulatory &amp; Deal Risk:</span> {gap.risk}
                </p>
                {plan ? (
                  <RemediationBreakdown plan={plan} surface="paper" />
                ) : (
                  <p className="mt-0.5 text-[12.5px] leading-[1.55]">
                    <span className="font-semibold">1-Line Fix:</span> {gap.fix}
                  </p>
                )}
              </section>
              )
            })
          )}
        </div>

        <hr className="my-4 border-neutral-300" />
        <p className="text-[11px] italic leading-relaxed text-neutral-600">
          Note: This public footprint check is an operational readiness assessment, not formal legal advice.
        </p>
      </article>
    </div>
  )
}
