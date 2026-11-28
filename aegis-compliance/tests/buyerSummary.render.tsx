/**
 * The buyer 1-pager, rendered to static markup and checked the way a buyer
 * reads it. Run through tests/render_buyer_summary.mjs, which bundles this file
 * with the project's own esbuild; there is no separate JS test runner.
 */
import { renderToStaticMarkup } from 'react-dom/server'

import { BuyerReadinessSummary, clauseNote } from '../src/components/BuyerReadiness'
import { BUYER_CLAUSE, BUYER_DOC, EXPECTED_PATCHES, EXPECTED_REDLINES, EXPECTED_RUBRICS } from './buyerFixture'

/** React escapes this set when it writes text nodes. */
const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

/** Each <p> as its class attribute and its full text, in document order. */
function paragraphs(markup: string): { className: string; text: string }[] {
  return markup
    .split('<p ')
    .slice(1)
    .map((chunk) => {
      const className = chunk.slice(0, chunk.indexOf('>'))
      const text = chunk.slice(chunk.indexOf('>') + 1, chunk.indexOf('</p>'))
      return { className, text }
    })
}

/** The paragraph that renders `text`, so its class list and content can be read. */
function paragraphWith(markup: string, text: string) {
  const escaped = escapeHtml(text)
  return paragraphs(markup).find((paragraph) => paragraph.text.includes(escaped))
}

export function run(): string[] {
  // React 19 separates adjacent text nodes with comments; the buyer never sees them.
  const markup = renderToStaticMarkup(<BuyerReadinessSummary doc={BUYER_DOC} clause={BUYER_CLAUSE} />).replace(
    /<!-- -->/g,
    '',
  )
  const checks: string[] = []

  const positions = EXPECTED_RUBRICS.map((label) => markup.indexOf(label))
  positions.forEach((position, index) => check(position >= 0, `rubric strip is missing ${EXPECTED_RUBRICS[index]}`))
  check(
    positions.every((position, index) => index === 0 || position > positions[index - 1]),
    'rubric strip is not in the required order',
  )
  check(!markup.includes('line-clamp-3'), 'the exact-fix copy is clamped again')
  checks.push('rubric strip: seven labels in order, no clamp on the exact fix')

  const exact: [string, string][] = [
    ...EXPECTED_REDLINES.map((text): [string, string] => ['Copy redline', text]),
    ...EXPECTED_PATCHES.map((text): [string, string] => ['Policy / control patch', text]),
  ]
  for (const [label, text] of exact) {
    const paragraph = paragraphWith(markup, text)
    check(paragraph, `${label} text is missing from the rendered sheet`)
    check(!paragraph.className.includes('line-clamp'), `${label} paragraph is line-clamped`)
    check(paragraph.text.endsWith(escapeHtml(text)), `${label} text was truncated`)
    check(paragraph.className.includes('whitespace-pre-wrap'), `${label} lost its paste-ready wrapping`)
  }
  checks.push(`exact fix: ${exact.length} strings render in full, unclamped, paste-ready`)

  check(markup.includes(escapeHtml(BUYER_DOC.name)), 'the target document name is missing')
  check(markup.includes('4 open gaps (2 high)'), 'the open-gap count line is wrong')
  check(markup.includes('2 passing'), 'the passing count is wrong')
  check(markup.includes('1 out of scope'), 'the out-of-scope count is wrong')
  check(markup.includes('1 further open gap is detailed in the full audit.'), 'the remaining-gap line is missing')
  checks.push('counts: top three gaps plus the pointer to the rest')

  check(markup.includes('Non-legal operational readiness check.'), 'the non-legal lead-in is missing')
  check(markup.includes('not legal advice'), 'the non-legal disclaimer is missing')
  checks.push('disclaimer: non-legal operational readiness check')

  const note = clauseNote(BUYER_CLAUSE)
  check(note === '9,240 of 20,764 characters kept; AI/policy clauses prioritised', `clause note reads ${note}`)
  check(markup.includes(escapeHtml(note ?? '')), 'the character-budget note is not on the sheet')
  checks.push('scope: character budget and clause prioritisation reported')

  return checks
}
