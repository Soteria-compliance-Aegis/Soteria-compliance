import type { ReactNode } from 'react'

import type { FindingRemediation } from '../lib/aegis'
import { cx } from '../lib/cx'
import { Badge } from './Controls'
import { Eyebrow } from './Typography'

type Surface = 'workspace' | 'paper'
type Tone = 'risk' | 'fix'

type Section = { id: string; title: string; tone: Tone; body: ReactNode }

function ExactBlock({ label, text, surface }: { label: string; text: string; surface: Surface }) {
  if (!text) return null
  if (surface === 'paper') {
    return (
      <div className="break-inside-avoid rounded-[6px] border border-neutral-300 bg-neutral-50 px-2.5 py-1.5">
        <p className="text-[10px] font-semibold tracking-[0.06em] text-neutral-500 uppercase">{label}</p>
        <p className="mt-0.5 font-mono text-[10.5px] leading-snug break-words whitespace-pre-wrap text-neutral-800">{text}</p>
      </div>
    )
  }
  return (
    <div className="rounded-[12px] bg-black/25 px-3 py-2 ring-1 ring-inset ring-white/10">
      <p className="text-[10.5px] font-medium tracking-[0.08em] text-plasma-text uppercase">{label}</p>
      <p className="mt-1 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-soft">{text}</p>
    </div>
  )
}

/**
 * Renders the five-part executive remediation of one flagged finding.
 *
 * `workspace` is the dark card surface; `paper` is the white A4 report, where
 * each part avoids a page break and the exact-fix copy keeps its mono block so
 * it survives print.
 */
export function RemediationBreakdown({
  plan,
  surface = 'workspace',
  className,
}: {
  plan: FindingRemediation
  surface?: Surface
  className?: string
}) {
  const { exactFix } = plan
  const sections: Section[] = []

  if (plan.problem) sections.push({ id: 'problem', title: 'Problem', tone: 'risk', body: plan.problem })
  if (plan.rootCause) sections.push({ id: 'rootCause', title: 'Root cause', tone: 'risk', body: plan.rootCause })
  if (plan.consequences) sections.push({ id: 'consequences', title: 'Consequences', tone: 'risk', body: plan.consequences })
  if (exactFix.copyRedline || exactFix.policyOrControlPatch) {
    sections.push({
      id: 'exactFix',
      title: 'Exact fix',
      tone: 'fix',
      body: (
        <div className="mt-2 grid gap-2">
          <ExactBlock label="Copy redline" text={exactFix.copyRedline} surface={surface} />
          <ExactBlock label="Policy or control patch" text={exactFix.policyOrControlPatch} surface={surface} />
        </div>
      ),
    })
  }
  if (plan.prevention) sections.push({ id: 'prevention', title: 'Prevention', tone: 'fix', body: plan.prevention })

  if (sections.length === 0) return null

  if (surface === 'paper') {
    return (
      <div className={cx('mt-2.5 border-t border-neutral-300 pt-2', className)}>
        <p className="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-500 uppercase">Executive remediation</p>
        <div className="mt-1.5 space-y-1.5">
          {sections.map((section, index) => (
            <div key={section.id} className="break-inside-avoid">
              <span
                className={cx(
                  'inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold tracking-[0.04em] uppercase ring-1 ring-inset',
                  section.tone === 'risk'
                    ? 'bg-red-50 text-red-800 ring-red-200'
                    : 'bg-blue-50 text-blue-800 ring-blue-200',
                )}
              >
                {index + 1} · {section.title}
              </span>
              {section.id === 'exactFix' ? (
                section.body
              ) : (
                <p className="mt-1 text-[12px] leading-[1.5] text-pretty text-neutral-800">{section.body}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={cx('mt-5 border-t border-white/10 pt-4', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow tone="muted">Executive remediation</Eyebrow>
        <span className="text-[11.5px] text-faint">5 parts · buyer-ready</span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {sections.map((section, index) => (
          <div key={section.id} className="rounded-[16px] bg-white/[0.03] px-4 py-3 ring-1 ring-inset ring-white/[0.07]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10.5px] tabular-nums text-faint">{String(index + 1).padStart(2, '0')}</span>
              <Badge tone={section.tone === 'risk' ? 'fire' : 'plasma'}>{section.title}</Badge>
            </div>
            {section.id === 'exactFix' ? (
              section.body
            ) : (
              <p className="mt-2 text-[13.5px] leading-relaxed text-pretty text-soft">{section.body}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
