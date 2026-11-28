import type { DocumentDetail, Status } from '../lib/aegis'
import { formatBytes, formatWhen, openFindings, remediationOf } from '../lib/aegis'
import { cx } from '../lib/cx'

/** What the scraper's character cap kept, as returned by the API. */
export type ClauseReport = {
  originalChars?: number
  keptChars?: number
  prioritized?: boolean
  signalHits?: number
}

/** One honest sentence for the character-budget indicator. */
export function clauseNote(clause?: ClauseReport | null): string | null {
  const kept = clause?.keptChars
  const original = clause?.originalChars
  if (typeof kept !== 'number' || typeof original !== 'number' || kept <= 0) return null
  if (kept >= original) return `${kept.toLocaleString()} characters read in full`
  const budget = `${kept.toLocaleString()} of ${original.toLocaleString()} characters kept`
  return clause?.prioritized
    ? `${budget}; AI/policy clauses prioritised`
    : `${budget} (opening of the document; no high-signal clause past the cut)`
}

/** The buyer strip order, matching rules.SHORT_LABELS. */
const RUBRICS: { id: string; label: string }[] = [
  { id: 'ftc_section5', label: 'FTC §5' },
  { id: 'ccpa_admt', label: 'CA ADMT' },
  { id: 'colorado_sb26_189', label: 'CO SB 26-189' },
  { id: 'texas_traiga', label: 'TX TRAIGA' },
  { id: 'nyc_ll144', label: 'NYC LL144' },
  { id: 'illinois_hb3773', label: 'IL HB 3773' },
  { id: 'india_dpdp', label: 'India DPDP' },
]

const SHORT_LABELS: Record<string, string> = Object.fromEntries(RUBRICS.map((rubric) => [rubric.id, rubric.label]))

const STATUS_TONE: Record<Status, string> = {
  Fail: 'border-red-300 bg-red-50 text-red-800',
  Warning: 'border-amber-300 bg-amber-50 text-amber-800',
  Pass: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  'N/A (Out of Scope)': 'border-neutral-300 bg-neutral-100 text-neutral-600',
}

const STATUS_WORD: Record<Status, string> = {
  Fail: 'Fail',
  Warning: 'Gap',
  Pass: 'Pass',
  'N/A (Out of Scope)': 'N/A',
}

function ExactCopy({ label, text }: { label: string; text: string }) {
  if (!text) return null
  return (
    <div className="break-inside-avoid rounded-[5px] border border-neutral-300 bg-neutral-50 px-2 py-1.5">
      <p className="text-[9px] font-semibold tracking-[0.06em] text-neutral-500 uppercase">{label}</p>
      <p className="mt-0.5 font-mono text-[9.5px] leading-snug break-words whitespace-pre-wrap text-neutral-800">
        {text}
      </p>
    </div>
  )
}

/**
 * The executive one-pager: metadata, the seven-rubric strip, the top three
 * open gaps with their paste-ready fix, and the non-legal disclaimer.
 *
 * It renders on white like the diff report, so `@media print` (A4) needs no
 * colour translation, and every block avoids splitting across pages.
 */
export function BuyerReadinessSummary({
  doc,
  clause,
}: {
  doc: DocumentDetail
  clause?: ClauseReport | null
}) {
  const findings = doc.findings ?? []
  const open = openFindings(findings)
  const top = open.slice(0, 3)
  const byId = new Map(doc.regulations.map((regulation) => [regulation.id, regulation]))
  const note = clauseNote(clause) ?? `${doc.chars.toLocaleString()} characters read`
  const high = open.filter((finding) => finding.severity === 'High').length

  return (
    <article className="brief-paper buyer-sheet mx-auto max-w-[880px] rounded-[14px] bg-white px-7 py-8 text-neutral-900 shadow-[0_30px_70px_-35px_rgba(5,5,5,0.4)] sm:px-10 sm:py-10">
      <header className="border-b border-neutral-300 pb-3">
        <p className="font-mono text-[9.5px] tracking-[0.14em] text-neutral-500 uppercase">
          Buyer readiness · 1-page summary
        </p>
        <h1 className="mt-1 text-[21px] font-semibold leading-tight tracking-[-0.02em] sm:text-[24px]">
          {doc.name}
        </h1>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-neutral-600">
          <span>
            <span className="font-semibold text-neutral-800">Scope:</span> {doc.source}
          </span>
          <span>
            <span className="font-semibold text-neutral-800">Format:</span> {doc.fileType.toUpperCase()} ·{' '}
            {formatBytes(doc.sizeBytes)}
          </span>
          <span>
            <span className="font-semibold text-neutral-800">Reviewed:</span> {note}
          </span>
          {doc.auditedAt ? (
            <span>
              <span className="font-semibold text-neutral-800">Audited:</span> {formatWhen(doc.auditedAt)}
            </span>
          ) : null}
        </p>
      </header>

      <section className="mt-3 break-inside-avoid">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-neutral-500 uppercase">Rubric status</h2>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {RUBRICS.map((rubric) => {
            const state = byId.get(rubric.id)
            const status: Status = state?.status ?? 'N/A (Out of Scope)'
            return (
              <span
                key={rubric.id}
                className={cx(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[9.5px] font-medium',
                  STATUS_TONE[status],
                )}
              >
                {rubric.label}
                <span className="opacity-50">·</span>
                <span className="font-semibold">{STATUS_WORD[status]}</span>
              </span>
            )
          })}
        </div>
        <p className="mt-1.5 text-[10.5px] text-neutral-600">
          {open.length} open {open.length === 1 ? 'gap' : 'gaps'} ({high} high) ·{' '}
          {doc.counts.pass} passing · {doc.counts.na} out of scope
        </p>
      </section>

      <section className="mt-3">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-neutral-500 uppercase">
          Top open gaps &amp; exact fix
        </h2>
        {top.length === 0 ? (
          <p className="mt-1.5 border-t border-neutral-300 pt-2 text-[11px] leading-relaxed text-neutral-800">
            No in-scope gap was found in the text reviewed. That is not a clean bill of health: it only covers the
            supplied document.
          </p>
        ) : (
          <div className="mt-1.5 space-y-2">
            {top.map((finding, index) => {
              const plan = remediationOf(finding.remediation_plan)
              const label = SHORT_LABELS[finding.regulation_id] ?? finding.regulation
              return (
                <section key={finding.regulation_id || finding.regulation} className="break-inside-avoid border-t border-neutral-300 pt-2">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-[9.5px] tabular-nums text-neutral-500">{index + 1}</span>
                    <h3 className="text-[11.5px] font-semibold leading-snug">{finding.regulation}</h3>
                    <span className="rounded-full border border-neutral-300 px-1.5 py-px text-[9px] font-semibold text-neutral-700">
                      {label} · {finding.severity}
                    </span>
                  </div>
                  {plan?.problem ? (
                    <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-neutral-700">{plan.problem}</p>
                  ) : null}
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    <ExactCopy
                      label="Copy redline"
                      text={plan?.exactFix.copyRedline || finding.remediation_note}
                    />
                    <ExactCopy label="Policy / control patch" text={plan?.exactFix.policyOrControlPatch ?? ''} />
                  </div>
                </section>
              )
            })}
          </div>
        )}
        {open.length > top.length ? (
          <p className="mt-1.5 text-[10px] italic text-neutral-500">
            {open.length - top.length} further open {open.length - top.length === 1 ? 'gap is' : 'gaps are'} detailed in
            the full audit.
          </p>
        ) : null}
      </section>

      <footer className="mt-3 break-inside-avoid border-t border-neutral-300 pt-2">
        <p className="text-[10px] leading-[1.5] text-neutral-600">
          <span className="font-semibold text-neutral-800">Non-legal operational readiness check.</span> This summary is
          a technical gap assessment built only from the text reviewed. It is not legal advice, a certification, or a
          statement of compliance, and it does not replace review by counsel or a qualified auditor.
        </p>
      </footer>
    </article>
  )
}
