/**
 * A realistic document for the buyer 1-pager: four open gaps, the top three
 * with a full five-part plan whose exact-fix copy sits at the lengths the
 * auditor allows (rules.normalize_remediation clips redlines at 360 chars and
 * policy patches at 480), so a passing render is also a worst-case render.
 */
import type { DocumentDetail, FindingRemediation } from '../src/lib/aegis'

const FTC_REDLINE =
  'We test our models against a documented bias suite before release and publish the results. No claim of accuracy, fairness or regulatory approval is made unless the linked test report states it, names the test date, and covers the exact model version in production.'
const FTC_PATCH =
  'Replace absolute marketing claims with the measured capability and its evidence. Add a claims register that records, for every public statement about the model, the supporting test report, its date, the model version tested and the owner who approved the wording, and review it before each release.'

const ADMT_REDLINE =
  'Candidates are ranked using an automated scoring model that weighs experience, skills, interview signals and assessment results. No decision is final without a recruiter review, and every candidate can request human review, see the factors that shaped the ranking, and ask for an alternative process before any offer or rejection is issued.'
const ADMT_PATCH =
  'Add a California ADMT notice to the candidate privacy policy that names the scoring model and its version, the categories of data it weighs, the purpose of the ranking, the retention period for scores, and the opt-out and human review routes. Log every automated rejection with the model version, the reviewer who confirmed it, the date of the last bias test and the route used to request a human decision.'

const CO_REDLINE =
  'We run profiling to tailor product recommendations and pricing. You can turn profiling off in settings, request a human review of any automated decision, and ask us to explain the main factors behind it.'
const CO_PATCH =
  'Document each profiling use in the privacy policy with its purpose, the data it consumes and the consumer rights attached to it. Add a settings control that disables profiling without losing core features, and a review queue that routes contested decisions to a named human reviewer within thirty days.'

const PLAN = (
  problem: string,
  copyRedline: string,
  policyOrControlPatch: string,
): FindingRemediation => ({
  problem,
  rootCause: 'Marketing, product and legal ship on separate release trains, so the public claim outlives the control behind it.',
  consequences: 'Enterprise procurement and legal review hold the deal until the gap is closed; the dated obligation is already live.',
  exactFix: { copyRedline, policyOrControlPatch },
  prevention: 'Diff every public claim against the policy and control register in the release checklist each quarter.',
})

export const BUYER_CLAUSE = { originalChars: 20764, keptChars: 9240, prioritized: true, signalHits: 6 }

export const BUYER_DOC: DocumentDetail = {
  id: 'fixture',
  name: 'Acme AI Platform — Privacy Policy & Security Page',
  fileType: 'pdf',
  sizeBytes: 284_512,
  chars: 20764,
  createdAt: '2026-11-20T09:12:00Z',
  auditedAt: '2026-11-24T16:40:00Z',
  status: 'ready',
  error: null,
  source: 'upload',
  counts: { fail: 3, warning: 1, pass: 2, na: 1, open: 4, graded: 6 },
  regulations: [
    { id: 'ftc_section5', name: 'FTC Section 5 (AI-Washing)', status: 'Fail', severity: 'High' },
    { id: 'ccpa_admt', name: 'California ADMT / CCPA', status: 'Fail', severity: 'High' },
    { id: 'colorado_sb26_189', name: 'Colorado SB 26-189', status: 'Fail', severity: 'Medium' },
    { id: 'texas_traiga', name: 'Texas TRAIGA', status: 'Warning', severity: 'Medium' },
    { id: 'nyc_ll144', name: 'NYC Local Law 144', status: 'Pass', severity: 'Low' },
    { id: 'illinois_hb3773', name: 'Illinois HB 3773', status: 'Pass', severity: 'Low' },
    { id: 'india_dpdp', name: 'India DPDP Act', status: 'N/A (Out of Scope)', severity: 'None' },
  ],
  findings: [
    {
      regulation: 'FTC Section 5 (AI-Washing)',
      regulation_id: 'ftc_section5',
      status: 'Fail',
      severity: 'High',
      evidence_quote: '100% unbiased, fully HIPAA compliant.',
      remediation_note: 'Remove the absolute claims or substantiate them.',
      remediation_plan: PLAN(
        'FTC §5 (High): the page promises absolute accuracy and HIPAA compliance with no test report behind either claim.',
        FTC_REDLINE,
        FTC_PATCH,
      ),
    },
    {
      regulation: 'California ADMT / CCPA',
      regulation_id: 'ccpa_admt',
      status: 'Fail',
      severity: 'High',
      evidence_quote: 'We use automated scoring to rank candidates.',
      remediation_note: 'Add a pre-use ADMT notice and an opt-out route.',
      remediation_plan: PLAN('CA ADMT (High): candidates are ranked by automated scoring with no pre-use notice.', ADMT_REDLINE, ADMT_PATCH),
    },
    {
      regulation: 'Colorado SB 26-189',
      regulation_id: 'colorado_sb26_189',
      status: 'Fail',
      severity: 'Medium',
      evidence_quote: 'We personalise pricing for every account.',
      remediation_note: 'Disclose profiling and offer an opt-out.',
      remediation_plan: PLAN('Colorado profiling rules: pricing personalisation is undisclosed and has no opt-out.', CO_REDLINE, CO_PATCH),
    },
    {
      regulation: 'Texas TRAIGA',
      regulation_id: 'texas_traiga',
      status: 'Warning',
      severity: 'Medium',
      evidence_quote: 'Our models are tested regularly.',
      remediation_note: 'Name the testing framework and publish results.',
    },
    {
      regulation: 'NYC Local Law 144',
      regulation_id: 'nyc_ll144',
      status: 'Pass',
      severity: 'Low',
      evidence_quote: '2025 bias audit summary available.',
      remediation_note: 'Keep the audit summary current annually.',
    },
    {
      regulation: 'Illinois HB 3773',
      regulation_id: 'illinois_hb3773',
      status: 'Pass',
      severity: 'Low',
      evidence_quote: 'We do not use biometric identifiers for hiring.',
      remediation_note: 'Re-check the notice if biometric tools are added.',
    },
    {
      regulation: 'India DPDP Act',
      regulation_id: 'india_dpdp',
      status: 'N/A (Out of Scope)',
      severity: 'None',
      evidence_quote: '',
      remediation_note: 'No India-facing processing described in the reviewed text.',
    },
  ],
}

export const EXPECTED_RUBRICS = ['FTC §5', 'CA ADMT', 'CO SB 26-189', 'TX TRAIGA', 'NYC LL144', 'IL HB 3773', 'India DPDP']
export const EXPECTED_REDLINES = [FTC_REDLINE, ADMT_REDLINE, CO_REDLINE]
export const EXPECTED_PATCHES = [FTC_PATCH, ADMT_PATCH, CO_PATCH]
