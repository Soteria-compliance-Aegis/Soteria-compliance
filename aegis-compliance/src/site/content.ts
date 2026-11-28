/*
  Public-site copy and data. Everything here is editable text, kept apart from
  the components so a founder can change a line without touching layout.

  Ground rules baked into the copy:
  - Soteria is a technical risk assessment, not legal advice.
  - We say "gap against the rule text", never "violation".
  - A human verifies every quote and rule date before a client report goes out.
  - No customers, testimonials, prices or statistics are claimed.
*/

export const SITE = {
  name: 'Soteria',
  tagline: 'Pass enterprise AI review in days, not quarters.',
  description:
    'Soteria grades your privacy policy, terms and AI disclosures against seven AI regulations, quotes the exact text behind every finding, and hands you the fix.',
  disclaimer:
    'Soteria provides a technical AI risk assessment, not legal advice. Every finding quotes the text you supplied; a human verifies each quote and rule date before a report is shared.',
}

export const NAV = [
  { label: 'Product', href: '/#product' },
  { label: 'Frameworks', href: '/frameworks' },
  { label: 'Sample', href: '/sample' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Security', href: '/security' },
  { label: 'Notes', href: '/blog' },
]

export type FrameworkPage = {
  slug: string
  id: string
  name: string
  short: string
  jurisdiction: string
  status: 'In force' | 'Upcoming'
  date: string
  summary: string
  who: string
  checks: string[]
  gaps: string[]
  note?: string
}

export const FRAMEWORKS: FrameworkPage[] = [
  {
    slug: 'ca-admt',
    id: 'ccpa_admt',
    name: 'California ADMT / CCPA',
    short: 'California ADMT',
    jurisdiction: 'California, US',
    status: 'Upcoming',
    date: 'Compliance from Jan 1, 2027',
    summary: 'Automated decision-making technology used for significant decisions needs a pre-use notice, an opt-out right and human review.',
    who: 'Companies whose product makes or heavily shapes significant decisions about California residents: hiring, lending, housing, health care.',
    checks: [
      'A pre-use notice that says an automated tool is involved before it is used on a person',
      'An opt-out route that a normal user can find and use',
      'A human-review path for the decision, described in plain language',
      'Privacy-policy wording that matches what the product actually does',
    ],
    gaps: [
      'The policy mentions "automated processing" but never says it informs decisions about people',
      'Opt-out is offered for marketing, not for the automated decision itself',
      'Human review exists in the product but is not disclosed anywhere a user would read',
    ],
  },
  {
    slug: 'colorado-sb-26-189',
    id: 'colorado_sb26_189',
    name: 'Colorado SB 26-189 (ADMT)',
    short: 'Colorado SB 26-189',
    jurisdiction: 'Colorado, US',
    status: 'Upcoming',
    date: 'Decisions on or after Jan 1, 2027',
    summary:
      'ADMT used for consequential decisions needs notice, an explanation of adverse outcomes, human review and deployer documentation. It was enacted on May 14, 2026 and replaced SB 24-205.',
    who: 'Developers and deployers of AI that influences consequential decisions about Colorado residents.',
    checks: [
      'Notice that an automated tool is used for a consequential decision',
      'An explanation route when the outcome is adverse',
      'Human review of the decision',
      'Deployer documentation a customer could hand to its own reviewer',
    ],
    gaps: [
      'No explanation is offered when someone is declined or scored down',
      'Developer documentation exists internally but is not shareable with deployers',
      'Notice language still refers to the repealed 2024 framework',
    ],
    note: 'Colorado changed course in 2026. We grade against the 2026 text and flag any policy that still cites the earlier act.',
  },
  {
    slug: 'texas-traiga',
    id: 'texas_traiga',
    name: 'Texas TRAIGA',
    short: 'Texas TRAIGA',
    jurisdiction: 'Texas, US',
    status: 'In force',
    date: 'Effective Jan 1, 2026',
    summary:
      'Developers and deployers are expected to show reasonable care, through bias and security testing aligned to recognised frameworks such as the NIST AI RMF. The standard is intent-based.',
    who: 'Anyone developing or deploying AI systems in Texas.',
    checks: [
      'Evidence of bias testing, not just a statement that you care about fairness',
      'Evidence of security testing and how findings are handled',
      'Alignment of those practices to a recognised framework such as the NIST AI RMF',
      'Public claims that stay inside what the testing supports',
    ],
    gaps: [
      '"We test for bias" with no description of what is tested or how often',
      'Security testing described, but no named framework or owner',
      'Marketing claims that go further than the documented testing',
    ],
  },
  {
    slug: 'nyc-ll144',
    id: 'nyc_ll144',
    name: 'NYC Local Law 144',
    short: 'NYC Local Law 144',
    jurisdiction: 'New York City, US',
    status: 'In force',
    date: 'In force since July 2023',
    summary: 'Employers and employment agencies using automated employment decision tools must publish an annual bias audit summary.',
    who: 'HR-tech vendors and the employers who deploy their screening, ranking or scoring tools for jobs in New York City.',
    checks: [
      'Whether the product is an automated employment decision tool at all',
      'A published summary of the most recent independent bias audit',
      'Candidate notice that such a tool is used',
      'A customer-facing explanation of who is responsible for the audit',
    ],
    gaps: [
      'The product ranks candidates, yet no bias-audit summary is linked anywhere',
      'The audit summary exists but is more than a year old',
      'Vendor and employer each assume the other publishes it',
    ],
  },
  {
    slug: 'illinois-hb-3773',
    id: 'illinois_hb3773',
    name: 'Illinois HB 3773 (AI in Employment)',
    short: 'Illinois HB 3773',
    jurisdiction: 'Illinois, US',
    status: 'In force',
    date: 'In force since Jan 1, 2026',
    summary:
      'AI used in employment decisions needs notice, must not use ZIP codes as a proxy for protected classes, and employers should be ready to address discriminatory effect. It sits within the Illinois Human Rights Act.',
    who: 'Employers and vendors whose AI touches hiring, promotion, discipline or discharge in Illinois.',
    checks: [
      'Notice to employees and applicants that AI is used in the decision',
      'No use of ZIP code as a stand-in for a protected class',
      'Readiness to respond to a discriminatory-effect question',
      'Policy language that matches the features the model actually uses',
    ],
    gaps: [
      'Location features are listed as model inputs with no safeguard described',
      'No notice text for applicants',
      'No owner for responding to an effect-based complaint',
    ],
  },
  {
    slug: 'ftc-section-5',
    id: 'ftc_section5',
    name: 'FTC Section 5 (AI-washing)',
    short: 'FTC Section 5',
    jurisdiction: 'United States (federal)',
    status: 'In force',
    date: 'Enforced today',
    summary:
      'Claims about what your AI can do, how safe it is or how compliant it is must be substantiated. Training on customer data through third-party LLM APIs should be disclosed.',
    who: 'Any company that markets an AI capability, safety property or compliance status.',
    checks: [
      'Absolute claims such as "bias-free", "100% accurate" or "fully compliant"',
      'Whether each capability claim has support you could show a reviewer',
      'Whether customer data goes to a third-party model provider, and whether the policy says so',
      'Consistency between homepage claims and policy text',
    ],
    gaps: [
      'Homepage says "your data never leaves your environment"; the policy lists a third-party model provider',
      'An accuracy figure with no date, dataset or method',
      '"Compliant" used as a product claim with no scope',
    ],
  },
  {
    slug: 'india-dpdp',
    id: 'india_dpdp',
    name: 'India DPDP Act',
    short: 'India DPDP Act',
    jurisdiction: 'India',
    status: 'In force',
    date: 'Phased commencement; check dates with counsel',
    summary:
      "Processing a Data Principal's digital personal data in India needs an itemised plain-language notice, free and specific consent, a published grievance contact and retention limits.",
    who: 'Companies processing personal data of people in India, including through AI features.',
    checks: [
      'An itemised notice that says what is collected and why',
      'Consent that is separate and specific, not bundled into general terms',
      'A named grievance contact a person can actually reach',
      'A retention limit rather than "as long as necessary"',
    ],
    gaps: [
      'Notice is buried inside terms of service rather than shown separately',
      'No grievance officer or contact route',
      'Retention described only as "as long as we need"',
    ],
    note: 'The Act commenced in phases. Dates on this page are a starting point; a human checks them against the current rules before any client report.',
  },
]

export const PROBLEM = [
  {
    n: '01',
    title: 'The questionnaire lands',
    body: 'A buyer\'s security team sends pages of questions about how your AI makes decisions, what data it trains on and who reviews the output. Nobody on your team owns the answers.',
  },
  {
    n: '02',
    title: 'Your pages disagree',
    body: 'The homepage promises one thing, the privacy policy says another, and the product does a third. Reviewers read all three, and notice.',
  },
  {
    n: '03',
    title: 'The deal waits',
    body: 'Procurement pauses until legal is comfortable. Legal pauses until someone produces evidence. Weeks pass, and the quarter closes without the signature.',
  },
]

export const PRODUCT = [
  {
    id: 'audit',
    title: 'Policy audit',
    body: 'Upload a privacy policy, terms or AI disclosure. Each of seven rubrics is graded Fail, Warning, Pass or Out of scope, with the exact sentence behind it.',
    meta: '7 rubrics · verbatim quotes',
  },
  {
    id: 'diff',
    title: 'Claim versus policy',
    body: 'We read your homepage claims against your policy and surface only the substantive mismatches. Zero gaps is a valid answer.',
    meta: 'High-confidence only',
  },
  {
    id: 'redteam',
    title: 'Red-team probes',
    body: 'Eight bounded probes check AI disclosure, prompt injection, PII leakage and decision guardrails against a live endpoint or a simulation.',
    meta: '8 probes · live or simulated',
  },
  {
    id: 'fix',
    title: 'Fixes you can paste',
    body: 'Every open finding comes with the problem, the root cause, the cost of ignoring it, the exact wording to paste and the guardrail that keeps it fixed.',
    meta: 'Five-part remediation',
  },
  {
    id: 'watch',
    title: 'Drift monitoring',
    body: 'Watch your live pages. When policy text changes, we re-run the audit and tell you which gaps opened or closed.',
    meta: 'Re-audit on change',
  },
]

export const STEPS = [
  {
    n: '1',
    title: 'Send us your pages',
    body: 'A privacy policy, terms of service or AI disclosure, as a file or a URL. No access to your product is needed for the first scorecard.',
  },
  {
    n: '2',
    title: 'We grade against seven rubrics',
    body: 'Applicability is decided first, so a consumer privacy notice is never failed for missing a hiring-bias audit. Each finding quotes your own text.',
  },
  {
    n: '3',
    title: 'A human checks the evidence',
    body: 'Before anything reaches you, a person verifies every quote and every rule date. The model drafts; people sign off.',
  },
  {
    n: '4',
    title: 'You fix it and show the buyer',
    body: 'Paste the remediation, hand the buyer-ready one-pager to procurement, and re-audit when your policy changes.',
  },
]

export const TIERS = [
  {
    id: 'scorecard',
    name: 'Scorecard',
    tag: 'Free',
    blurb: 'A one-page read on where you stand.',
    points: ['One-page scorecard across the seven rubrics', 'Your three highest-confidence gaps, quoted', 'No product access needed'],
    cta: 'Request a scorecard',
    interest: 'scorecard',
  },
  {
    id: 'audit',
    name: 'Core audit',
    tag: 'Scoped per company',
    blurb: 'The full gap report your buyer will ask for.',
    points: [
      'Full gap report with five-part remediation',
      'NIST AI RMF mapping',
      'Red-team probe run and report',
      'Buyer-ready one-page summary',
    ],
    cta: 'Talk to us',
    interest: 'audit',
    featured: true,
  },
  {
    id: 'retainer',
    name: 'Retainer',
    tag: 'Monthly',
    blurb: 'Stay audit-ready as your product and the rules move.',
    points: ['Drift monitoring on your live pages', 'Re-audits in CI/CD when policy text changes', 'Updates when a rubric changes'],
    cta: 'Talk to us',
    interest: 'retainer',
  },
]

export const FAQ = [
  {
    q: 'Is this legal advice?',
    a: 'No. Soteria is a technical risk assessment. Findings describe gaps between your text and the rule text, with quotes, so your counsel can decide what to do. We never call a gap a violation.',
  },
  {
    q: 'Who is it for?',
    a: 'US Series A and B B2B AI companies, starting with HR tech, fintech and health tech, who are about to face enterprise security and AI reviews.',
  },
  {
    q: 'How do you stop the model inventing findings?',
    a: 'A finding may only cite text that really appears in your document. Quotes are checked verbatim against the source, unknown results are rejected, and a human verifies each quote and rule date before a report is shared.',
  },
  {
    q: 'What happens to the documents I send?',
    a: 'They are stored for your audit and sent to our model provider for grading. We do not use them for anything else. The Security page lists exactly what is stored and where it goes.',
  },
  {
    q: 'How long does the scorecard take?',
    a: 'The first scorecard is a one-page read of your public policy text. We will confirm timing when you submit the form.',
  },
  {
    q: 'Do you cover rules outside the US?',
    a: "One of the seven rubrics is India's DPDP Act. We add rubrics as customers need them; tell us which you need in the form.",
  },
]

export const SAMPLE = {
  company: 'Northwind Hire',
  note: 'Northwind Hire is a fictional company. This scorecard shows the format, not a real assessment.',
  grade: 'B−',
  summary: '2 fail · 2 warning · 2 pass · 1 out of scope',
  rows: [
    {
      id: 'nyc_ll144',
      name: 'NYC Local Law 144',
      status: 'Fail',
      quote: '"Our ranking engine scores every applicant against the role profile."',
      gap: 'The product ranks candidates for jobs. No bias-audit summary is published or linked anywhere in the supplied pages.',
      fix: 'Publish the latest independent bias-audit summary and link it from the careers and privacy pages.',
    },
    {
      id: 'ccpa_admt',
      name: 'California ADMT / CCPA',
      status: 'Fail',
      quote: '"We may use automated processing to improve our services."',
      gap: 'No pre-use notice says automation informs decisions about people, and no opt-out or human-review route is described.',
      fix: 'Add a pre-use notice for screening decisions, an opt-out route and a plain-language human-review step.',
    },
    {
      id: 'ftc_section5',
      name: 'FTC Section 5 (AI-washing)',
      status: 'Warning',
      quote: '"Bias-free hiring, guaranteed."',
      gap: 'An absolute claim with no stated method, dataset or date behind it.',
      fix: 'Replace with a scoped, dated statement that matches your testing.',
    },
    {
      id: 'illinois_hb3773',
      name: 'Illinois HB 3773',
      status: 'Warning',
      quote: '"Location and commute time are used to rank candidates."',
      gap: 'Location features are used with no safeguard against proxying for a protected class.',
      fix: 'Document the safeguard, or drop the feature for Illinois roles.',
    },
    {
      id: 'texas_traiga',
      name: 'Texas TRAIGA',
      status: 'Pass',
      quote: '"We test our models quarterly using the NIST AI RMF."',
      gap: 'Testing cadence and framework are named.',
      fix: '',
    },
    {
      id: 'india_dpdp',
      name: 'India DPDP Act',
      status: 'Pass',
      quote: '"Grievance Officer: grievance@northwind.example. Retention: 12 months."',
      gap: 'Contact route and retention limit are stated.',
      fix: '',
    },
    {
      id: 'colorado_sb26_189',
      name: 'Colorado SB 26-189',
      status: 'N/A (Out of Scope)',
      quote: '',
      gap: 'No evidence the product makes consequential decisions about Colorado residents in the supplied text.',
      fix: '',
    },
  ],
}

export const SECURITY = [
  {
    title: 'What we store',
    body: 'Documents you send, the findings produced from them, and your contact details. Uploads are cut to a fixed length before grading, exactly like a scraped page.',
  },
  {
    title: 'Where the text goes',
    body: 'Policy text leaves our servers only inside the grading call to our model provider (Groq). Nothing else is sent to a third party.',
  },
  {
    title: 'How we fetch your pages',
    body: 'Our URL fetcher blocks private and internal addresses, limits size and time, and refuses non-HTTP targets, so a submitted URL cannot be used to reach anything internal.',
  },
  {
    title: 'How findings are kept honest',
    body: 'A finding can only cite text that appears in your document. Quotes are verified verbatim, unknown probe results are rejected, and a person verifies every quote and rule date before a report is shared.',
  },
  {
    title: 'Who can see your data',
    body: 'The admin portal is limited to named Soteria team members. Passwords are hashed with scrypt and sessions are stored hashed, with login throttling.',
  },
  {
    title: 'What we do not claim',
    body: 'We do not claim any compliance certification today, and nothing we produce is legal advice.',
  },
]

export const TEAM = [
  { name: '[Founder name]', role: '[Role, e.g. Co-founder, Product]', bio: '[One or two lines on background and why Soteria.]' },
  { name: '[Founder name]', role: '[Role, e.g. Co-founder, Engineering]', bio: '[One or two lines on background and why Soteria.]' },
]

export type Post = { slug: string; title: string; date: string; read: string; excerpt: string; body: string[] }

export const POSTS: Post[] = [
  {
    slug: 'gap-not-violation',
    title: 'Why we say "gap against the rule text", never "violation"',
    date: 'Nov 2026',
    read: '3 min',
    excerpt: 'A word choice that changes what a finding is, who can act on it and what it is allowed to claim.',
    body: [
      'A violation is a legal conclusion. It depends on facts a document cannot show: what the product really does, which jurisdiction applies, whether an exemption holds. A policy review can see none of that.',
      'What a document can show is a gap. The rule asks for a pre-use notice; the supplied text has none. That is a statement about two pieces of text, and it is checkable by anyone who reads them.',
      'So every Soteria finding has the same shape: the rule, the exact sentence from your document, and what is missing between them. If we cannot quote it, we do not report it.',
      'This also keeps us useful to counsel. A lawyer can take a quoted gap and decide whether it matters. A bare accusation gives them nothing to work with.',
    ],
  },
  {
    slug: 'what-buyers-ask',
    title: 'What an enterprise AI review actually asks your startup',
    date: 'Nov 2026',
    read: '4 min',
    excerpt: 'The pattern behind the questionnaire: disclosure, testing, human review and data handling.',
    body: [
      'Security questionnaires vary in length, but the AI sections tend to circle four ideas. Do you tell people when a model is involved? Can you show how you test it? Is there a human who can override it? Where does customer data go?',
      'Startups often have good answers and no evidence. The testing happens but is not written down. The human override exists but is not described to users. The model provider is a vendor nobody listed.',
      'The cheapest fix is to make the public pages say what is true, with the same words your team would use on a call. When the homepage, the policy and the product agree, most questions answer themselves.',
      'That is the job of our claim-versus-policy check: find where the pages disagree before a buyer does.',
    ],
  },
  {
    slug: 'seven-rubrics-2026',
    title: 'Seven rubrics, one reading list: what moved in 2026',
    date: 'Nov 2026',
    read: '4 min',
    excerpt: 'Colorado replaced its 2024 act, Texas and Illinois took effect, California and Colorado look to 2027.',
    body: [
      'Colorado enacted SB 26-189 on May 14, 2026, replacing the 2024 framework. Decisions on or after January 1, 2027 are covered, so policies that still cite the older act are now stale.',
      'Texas TRAIGA took effect January 1, 2026, with an intent-based standard and a reasonable-care expectation tied to recognised frameworks such as the NIST AI RMF. Illinois HB 3773 also took effect on January 1, 2026.',
      "California's ADMT rules point at January 1, 2027, and New York City's Local Law 144 is unchanged. The FTC's Section 5 attention to AI claims is enforced today.",
      'Rule text and dates change, and a human at Soteria checks each one against the source before it appears in a client report. Treat this note as a reading list, not as advice.',
    ],
  },
]
