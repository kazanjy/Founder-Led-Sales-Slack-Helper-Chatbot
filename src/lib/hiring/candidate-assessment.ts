import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { loadSellerContext } from "@/lib/seller-context";
import {
  enrichCompanyByNameOrDomain,
  cleanSchool,
  type PDLPersonResult,
  type PDLCompanyResult,
} from "@/lib/search/pdl";
import {
  enrichPersonByLinkedIn,
  isEducationEntry,
  type ApolloPersonResult,
} from "@/lib/search/apollo";
import { getOrgOverrides, getSchoolOverrides } from "./org-overrides";
import { profileRoleForAssessment, ROLE_META } from "./role-types";
import { findOwnThenAccount, type OrgScope } from "@/lib/agents/shared/account-scoped";
import {
  detectFlags,
  partitionFlags,
  rubricFor,
  type Flag,
  type RoleRubric,
  type CandidateBackground,
} from "./flag-engine";

/**
 * Candidate fit assessment (candidate-assessment-plan.md, Stage 0).
 *
 * Grades an AE candidate against the founder's own hiring bar. The
 * differentiated read is stage-at-tenure: what each company WAS while
 * the candidate was there, not what it is now — a rep who joined three
 * companies at Seed/A is a different bet from one who only ever
 * arrived post-Series-C.
 *
 * Enrichment split: the work history comes from Apollo, which is far
 * cheaper per match than PDL for the same question. PDL is kept for the
 * two jobs Apollo has no answer for — company funding history (the
 * stage-at-tenure read) and the School Cleaner that resolves a school
 * name to the domain the selectivity registry keys on.
 *
 * Cost posture: the model knows the well-known companies (and is the
 * only source for motion/category/buyer anyway — no enrichment provider
 * has such a field), so we take ONE knowledge pass over every company
 * and spend company-enrichment credits only where the model's
 * confidence is low. Typical run is 1 person enrich + 0-3 company
 * enrichments rather than one per role.
 *
 * Every timeline row carries its provenance so the report can say
 * which stages were verified against funding data and which came from
 * model knowledge.
 *
 * Flags are DETERMINISTIC. lib/hiring/flag-engine.ts detects them in
 * TypeScript over the normalized timeline; the model receives the
 * finished list and narrates it — innocent explanation, why it matters,
 * what to ask. It cannot add a flag, drop one, or restate a count. Same
 * résumé in, same flags out, every time.
 */

export const RUBRIC_VERSION = "v1";
const MODEL = "gpt-5.5";

/** Roles this old are noise for a first-sales-hire decision. */
const MAX_ROLE_AGE_YEARS = 8;
/** Sub-6-month stints don't get a company lookup (still counted in flags). */
const MIN_MONTHS_FOR_LOOKUP = 6;
/** Hard ceiling on companies we research at all. */
const MAX_COMPANIES = 8;
/** Hard ceiling on paid verification lookups per assessment. */
const MAX_PDL_VERIFICATIONS = 3;
/**
 * Schools resolved through PDL's cleaner per assessment. Two covers
 * undergrad plus a graduate degree, which is all the selectivity flag
 * needs — it reports the single best match, not a transcript.
 */
const MAX_SCHOOL_LOOKUPS = 2;

export interface TimelineRole {
  company: string;
  companyWebsite: string | null;
  title: string;
  start: string | null; // YYYY-MM
  end: string | null; // YYYY-MM or null = current
  months: number | null;
  isSales: boolean;
}

export interface CompanyRead {
  company: string;
  stageAtStart: string | null;
  stageAtEnd: string | null;
  employeeEstimate: string | null;
  motion: string | null;
  category: string | null;
  soldTo: string | null;
  basis: string | null; // the specific facts behind the claim
  confidence: "high" | "medium" | "low";
  provenance: "model" | "funding_data" | "unknown";
}

export interface AssessmentInput {
  userId: string;
  linkedinUrl?: string;
  /** Pasted profile text, résumé text, or an attached PDF's extracted text. */
  profileText?: string;
  candidateName?: string;
  roleLabel?: string;
}

// ── Profile acquisition ─────────────────────────────────────────────

const EXTRACT_PROMPT = `Extract a candidate's work history from the text below.

Return ONLY JSON:
{
  "candidateName": "<full name, or null>",
  "headline": "<current title @ company, or null>",
  "roles": [
    {
      "company": "<company name>",
      "title": "<job title>",
      "start": "YYYY-MM" | null,
      "end": "YYYY-MM" | null,      // null means current
      "isSales": true | false        // quota-carrying / sales-adjacent
    }
  ],
  "claims": [
    { "text": "<verbatim claim from the text>", "kind": "quota|attainment|deal_size|self_sourced|award|team|other" }
  ],
  "schools": ["<institution name, NO dates>"],
  "majors": ["<field of study as written>"],
  "distinctions": ["<verbatim honor, activity, award, athletic or service line>"]
}

Rules:
- Roles newest first. Include non-sales roles (mark isSales false) — gaps matter.
- claims: ONLY performance assertions the candidate makes (quota attainment,
  President's Club, ACV, self-sourced %, "first AE", "no SDR support"). Verbatim.
- distinctions: verbatim lines covering athletics (collegiate AND professional
  or semi-professional), military service, honors, scholarships, awards,
  multi-year youth programs, and any statement about working while studying.
  Copy the line as written; do not paraphrase or infer.
- A professional or semi-professional playing career, or a military tour, is
  often listed as a JOB rather than an activity. Keep it in "roles" as normal
  (mark isSales false) AND add a line for it to "distinctions" — it is career
  history and a background signal at once.
- NEVER extract: photo, date of birth, age, marital status, nationality, home
  address, or graduation years — not in any field, including distinctions.
  Graduation year is an age proxy and must not reach the assessment. Omit these
  entirely even when present.
- Do NOT extract religious or political affiliation, or anything naming a
  protected characteristic, even when it appears alongside a genuine honor.
  Take the award, leave the affiliation.
- If the text isn't a résumé or profile, return {"candidateName": null, "roles": [], "claims": []}.`;

async function extractProfileFromText(text: string): Promise<{
  candidateName: string | null;
  headline: string | null;
  roles: Array<Record<string, unknown>>;
  claims: Array<{ text: string; kind: string }>;
  background: CandidateBackground;
}> {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: `${EXTRACT_PROMPT}\n\n---\n\n${text.slice(0, 60_000)}` }],
  });
  try {
    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    return {
      candidateName: parsed.candidateName ?? null,
      headline: parsed.headline ?? null,
      roles: Array.isArray(parsed.roles) ? parsed.roles : [],
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
      background: {
        schools: strList(parsed.schools),
        majors: strList(parsed.majors),
        distinctions: strList(parsed.distinctions).map(stripYears),
      },
    };
  } catch {
    return { candidateName: null, headline: null, roles: [], claims: [], background: {} };
  }
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
}

/**
 * Belt and braces on the age proxy. The extraction prompt forbids
 * graduation years, but a distinction line is copied verbatim and a
 * year rides along easily ("Varsity crew, 2009-2013"). A prompt rule
 * the model can forget is not a control; stripping it here is.
 */
function stripYears(line: string): string {
  return line
    .replace(/\b(19|20)\d{2}\s*[-–—]\s*((19|20)\d{2}|present)\b/gi, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;(){}[\]-]+$/, "")
    .trim();
}

/**
 * PDL normalizes every string it returns to lowercase — names, titles,
 * company names alike — so an unmodified profile renders as "shane
 * goodman / regional sales manager, tribal entities @ splunk". Title
 * case it back before anything stores or displays it.
 *
 * Résumé-extracted text is NOT passed through here: it already carries
 * the candidate's own capitalization, and re-casing it would damage
 * intentional forms like "eBay" or "iRobot".
 */
const ACRONYMS = new Set([
  "ae", "sdr", "bdr", "vp", "svp", "evp", "cro", "ceo", "cto", "coo", "cfo", "cmo",
  "it", "hr", "us", "usa", "uk", "eu", "emea", "apac", "latam", "na", "dach",
  "saas", "b2b", "b2c", "api", "ai", "ml", "crm", "erp", "sms", "seo", "ppc", "sql",
  "mba", "bs", "ba", "ms", "msc", "bsc", "phd", "jd", "cpa",
  "ibm", "hp", "aws", "gcp", "sap", "ge", "3m", "kpmg", "pwc", "ey",
  "uc", "ucla", "ucsb", "ucsd", "usc", "nyu", "mit", "ucf", "smu", "tcu", "byu", "lsu",
  // Legal suffixes that really are uppercase. "Inc" and "Ltd" are
  // deliberately absent — they are title case, not acronyms.
  "llc", "plc", "llp",
]);
/** Lowercase inside a title unless they lead it. */
const MINOR_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

export function titleCase(raw: string | null | undefined): string {
  if (!raw) return "";
  // Already mixed case means the source preserved it — leave it alone.
  if (/[A-Z]/.test(raw) && raw !== raw.toUpperCase()) return raw;
  return raw
    .toLowerCase()
    .split(/(\s+|[-/,&()])/)
    .map((tok, i) => {
      if (!/[a-z0-9]/.test(tok)) return tok;
      const bare = tok.replace(/[^a-z0-9]/g, "");
      if (ACRONYMS.has(bare)) return tok.toUpperCase();
      if (i > 0 && MINOR_WORDS.has(bare)) return tok;
      // Mc/Mac and O' names get their inner capital back.
      return tok
        .replace(/^([a-z])/, (m) => m.toUpperCase())
        .replace(/^(Mc|Mac|O')([a-z])/, (_m, p, c) => p + c.toUpperCase());
    })
    .join("");
}

function monthsBetween(start: string | null, end: string | null): number | null {
  if (!start) return null;
  const s = new Date(`${start}-01T00:00:00Z`);
  if (isNaN(s.getTime())) return null;
  const e = end ? new Date(`${end}-01T00:00:00Z`) : new Date();
  if (isNaN(e.getTime())) return null;
  return Math.max(
    0,
    (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth())
  );
}

function toYearMonth(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : /^\d{4}$/.test(raw) ? `${raw}-01` : null;
}

/**
 * A year-only date silently becomes January, which can move a stint
 * length by up to 11 months. Tracking it lets the flag engine downgrade
 * confidence to "possible" rather than asserting a hopping pattern that
 * may be a rounding artifact.
 */
function isYearOnly(raw: unknown): boolean {
  return typeof raw === "string" && /^\d{4}$/.test(raw.trim());
}

const SALES_TITLE = /(account executive|\bae\b|sales|revenue|business development|\bbdr\b|\bsdr\b|account manager|customer success|partnerships|cro\b|founder)/i;

/**
 * Education off the PDL payload.
 *
 * PDL DOES return school and majors, so the education-derived signals
 * work on the URL-only path — no résumé required. What it carries no
 * trace of is athletics, military service, awards, scholarships or
 * working through school; those exist only in a résumé, which is the
 * honest reason to ask for one.
 *
 * PDLEducation also carries start_date / end_date. We deliberately
 * ignore both: a graduation year is an age proxy, and the fact that
 * it's conveniently in the payload is not a reason to let it into the
 * assessment.
 */
function backgroundFromPDL(person: PDLPersonResult): CandidateBackground {
  const education = person.education || [];
  return {
    schools: education.map((e) => titleCase(e.school?.name)).filter(Boolean),
    // Degrees go in alongside majors, not into distinctions: PDL
    // populates the two inconsistently, and where `majors` is empty the
    // field is usually named inside the degree ("BS Mechanical
    // Engineering"). A bare "Bachelor of Science" matches nothing and
    // is harmless.
    majors: [
      ...education.flatMap((e) => e.majors || []),
      ...education.flatMap((e) => e.degrees || []),
    ].filter(Boolean),
    // Nothing here: PDL has no field for athletics, service or awards.
    distinctions: [],
  };
}

/** Union of two background reads, de-duplicated case-insensitively. */
function mergeBackground(
  a: CandidateBackground,
  b: CandidateBackground
): CandidateBackground {
  const union = (x?: string[], y?: string[]): string[] => {
    const seen = new Set<string>();
    return [...(x || []), ...(y || [])].filter((v) => {
      const k = v.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return {
    schools: union(a.schools, b.schools),
    majors: union(a.majors, b.majors),
    distinctions: union(a.distinctions, b.distinctions),
  };
}

/**
 * Education off the Apollo payload.
 *
 * Apollo folds schooling into employment_history rather than exposing a
 * separate array, and only sometimes returns a top-level `education`
 * too, so both are read and unioned. The absence of education is
 * reported rather than swallowed — school selectivity is one of the
 * heaviest green flags, and a provider that quietly stops supplying it
 * would look identical to a candidate who never went to college.
 */
function backgroundFromApollo(person: ApolloPersonResult): CandidateBackground {
  const eduRows = (person.employment_history || []).filter(isEducationEntry);
  const schools = [
    ...eduRows.map((e) => titleCase(e.organization_name)),
    ...(person.education || []).map((e) => titleCase(e.school_name)),
  ].filter(Boolean) as string[];
  const majors = [
    ...eduRows.flatMap((e) => [e.major, e.degree]),
    ...(person.education || []).flatMap((e) => [e.major, e.degree]),
  ].filter(Boolean) as string[];
  return {
    schools,
    majors,
    // Apollo has no field for athletics, service or awards either —
    // those still only exist in a résumé.
    distinctions: [],
  };
}

function timelineFromApollo(person: ApolloPersonResult): {
  timeline: TimelineRole[];
  hasYearOnlyDates: boolean;
} {
  // Education rows would otherwise be scored as jobs, manufacturing
  // tenure gaps and hopping flags out of a degree.
  const jobs = (person.employment_history || []).filter((e) => !isEducationEntry(e));
  const hasYearOnlyDates = jobs.some(
    (e) => isYearOnly(e.start_date) || isYearOnly(e.end_date)
  );
  const timeline = jobs.map((e) => {
    const start = toYearMonth(e.start_date);
    // Apollo sets `current: true` and may still carry an end_date on
    // the present role. Trusting the flag keeps the current job out of
    // the short-stint count, which is the same rule the PDL path uses.
    const end = e.current ? null : toYearMonth(e.end_date);
    const title = titleCase(e.title) || "";
    return {
      company: titleCase(e.organization_name) || "Unknown",
      companyWebsite: null,
      title,
      start,
      end,
      months: monthsBetween(start, end),
      isSales: SALES_TITLE.test(title),
    };
  });
  return { timeline, hasYearOnlyDates };
}

function timelineFromPDL(person: PDLPersonResult): {
  timeline: TimelineRole[];
  hasYearOnlyDates: boolean;
} {
  const hasYearOnlyDates = (person.experience || []).some(
    (e) => isYearOnly(e.start_date) || isYearOnly(e.end_date)
  );
  const timeline = (person.experience || []).map((e) => {
    const start = toYearMonth(e.start_date);
    const end = toYearMonth(e.end_date);
    const title = titleCase(e.title?.name) || "";
    return {
      company: titleCase(e.company?.name) || "Unknown",
      companyWebsite: e.company?.website || null,
      title,
      start,
      end,
      months: monthsBetween(start, end),
      isSales: SALES_TITLE.test(title),
    };
  });
  return { timeline, hasYearOnlyDates };
}

// ── Company knowledge (one model pass) + targeted PDL verification ──

const COMPANY_PROMPT = `For each company below, state what it was DURING the given date window — not what it is today.

Return ONLY JSON: { "companies": [ {
  "company": "<name exactly as given>",
  "stageAtStart": "<pre-seed|seed|series a|series b|series c|series d+|public|bootstrapped|private/unknown>",
  "stageAtEnd": "<same scale>",
  "employeeEstimate": "<band during the window, e.g. '30-60'>",
  "motion": "<e.g. 'enterprise field sales, 6-9mo cycles' or 'PLG-assist, transactional'>",
  "category": "<what they sell>",
  "soldTo": "<buyer persona + segment>",
  "basis": "<the SPECIFIC facts you're relying on: founding year, the last round before the start date, headcount at the time>",
  "confidence": "high|medium|low"
} ] }

Rules:
- confidence "high" ONLY if you can name specific facts in "basis" (a funding
  round and rough date, a headcount figure, a known product/market position).
- If you don't genuinely know the company, say confidence "low" and leave
  stage fields null. DO NOT GUESS — a wrong stage silently flips a hiring
  verdict. "Never heard of it" is a useful, honest answer.
- Judge the company as it was in the window, not its present-day scale.`;

async function readCompanies(
  roles: TimelineRole[]
): Promise<CompanyRead[]> {
  if (roles.length === 0) return [];
  const payload = roles.map((r) => ({
    company: r.company,
    website: r.companyWebsite,
    window: `${r.start || "?"} to ${r.end || "present"}`,
  }));
  const completion = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "user", content: `${COMPANY_PROMPT}\n\n---\n\n${JSON.stringify(payload, null, 2)}` },
    ],
  });
  let parsed: { companies?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    parsed = {};
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return (parsed.companies || []).map((c) => ({
    company: str(c.company) || "Unknown",
    stageAtStart: str(c.stageAtStart),
    stageAtEnd: str(c.stageAtEnd),
    employeeEstimate: str(c.employeeEstimate),
    motion: str(c.motion),
    category: str(c.category),
    soldTo: str(c.soldTo),
    basis: str(c.basis),
    confidence: (c.confidence === "high" || c.confidence === "medium" ? c.confidence : "low") as
      | "high"
      | "medium"
      | "low",
    provenance: "model" as const,
  }));
}

/** Which funding rounds had closed by a date — the stage-at-tenure math. */
function stageFromFunding(
  company: PDLCompanyResult,
  asOf: string | null
): { stage: string | null; roundsBefore: string[] } {
  const rounds = (company.funding_details || [])
    .filter((r) => r.date && r.funding_type)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (rounds.length === 0) {
    return { stage: company.latest_funding_stage || null, roundsBefore: [] };
  }
  const cutoff = asOf ? `${asOf}-01` : new Date().toISOString().slice(0, 10);
  const before = rounds.filter((r) => (r.date || "") <= cutoff);
  return {
    stage: before.length > 0 ? before[before.length - 1].funding_type || null : "pre-seed",
    roundsBefore: before.map((r) => `${r.funding_type} (${r.date})`),
  };
}

/**
 * Verify the reads the model was unsure about, spending at most
 * MAX_PDL_VERIFICATIONS credits. Rewrites those rows with funding-data
 * provenance so the report can distinguish verified from inferred.
 */
async function verifyLowConfidence(
  reads: CompanyRead[],
  roles: TimelineRole[]
): Promise<CompanyRead[]> {
  const needsCheck = reads
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.confidence === "low")
    .slice(0, MAX_PDL_VERIFICATIONS);
  if (needsCheck.length === 0) return reads;

  const out = [...reads];
  await Promise.all(
    needsCheck.map(async ({ r, i }) => {
      const role = roles.find((x) => x.company === r.company);
      const company = await enrichCompanyByNameOrDomain(r.company, role?.companyWebsite);
      if (!company) return;
      const atStart = stageFromFunding(company, role?.start || null);
      const atEnd = stageFromFunding(company, role?.end || null);
      out[i] = {
        ...r,
        stageAtStart: atStart.stage || r.stageAtStart,
        stageAtEnd: atEnd.stage || r.stageAtEnd,
        employeeEstimate:
          company.employee_count != null ? `~${company.employee_count} today` : r.employeeEstimate,
        category: r.category || company.industry || null,
        basis: [
          atStart.roundsBefore.length
            ? `rounds closed before start: ${atStart.roundsBefore.join(", ")}`
            : "no rounds before start date",
          company.founded ? `founded ${company.founded}` : null,
        ]
          .filter(Boolean)
          .join("; "),
        confidence: "medium",
        provenance: "funding_data",
      };
    })
  );
  return out;
}

// ── Deterministic signals (never let the model do arithmetic) ───────

export interface ComputedSignals {
  totalSalesRoles: number;
  medianStintMonths: number | null;
  /**
   * What counts as "short" for this seat. An 18-month enterprise cycle
   * needs a longer runway to prove anything than transactional SDR work
   * does, so the threshold is role-relative, not a flat 12 months.
   */
  shortStintThresholdMonths: number;
  /** Short SALES stints started in the last 6 years. */
  shortSalesStintsLast6y: number;
  /** Same window, ANY role — hopping is a pattern regardless of seat. */
  shortStintsAllRolesLast6y: number;
  /** The actual short stints, so the report can cite them by name. */
  shortStints: Array<{ company: string; title: string; months: number; end: string | null }>;
  currentRoleMonths: number | null;
  longestSalesStintMonths: number | null;
  /** Selling months left after ramp — the honest denominator. */
  rampAdjustedSellingMonths: number | null;
  assumedRampMonths: number;
  gapsOver4Months: Array<{ after: string; months: number }>;
  progression: string[];
}

function computeSignals(timeline: TimelineRole[], rubric: RoleRubric): ComputedSignals {
  const sales = timeline.filter((r) => r.isSales);
  const stints = sales.map((r) => r.months).filter((m): m is number => m != null);
  const sorted = [...stints].sort((a, b) => a - b);
  const sixYearsAgo = new Date();
  sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
  const cutoff = sixYearsAgo.toISOString().slice(0, 7);

  const gaps: Array<{ after: string; months: number }> = [];
  const chrono = [...timeline]
    .filter((r) => r.start)
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  for (let i = 1; i < chrono.length; i++) {
    const prevEnd = chrono[i - 1].end;
    const nextStart = chrono[i].start;
    if (!prevEnd || !nextStart) continue;
    const gap = monthsBetween(prevEnd, nextStart);
    if (gap != null && gap > 4) gaps.push({ after: chrono[i - 1].company, months: gap });
  }

  const recentShort = timeline.filter(
    (r) => (r.start || "") >= cutoff && r.months != null && r.months < rubric.shortStintMonths
  );

  return {
    totalSalesRoles: sales.length,
    medianStintMonths: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    shortStintThresholdMonths: rubric.shortStintMonths,
    shortSalesStintsLast6y: recentShort.filter((r) => r.isSales).length,
    shortStintsAllRolesLast6y: recentShort.length,
    shortStints: recentShort.map((r) => ({
      company: r.company,
      title: r.title,
      months: r.months as number,
      end: r.end,
    })),
    currentRoleMonths: timeline.find((r) => !r.end)?.months ?? null,
    longestSalesStintMonths: stints.length ? Math.max(...stints) : null,
    rampAdjustedSellingMonths: stints.length
      ? stints.reduce((sum, m) => sum + Math.max(0, m - rubric.rampMonths), 0)
      : null,
    assumedRampMonths: rubric.rampMonths,
    gapsOver4Months: gaps,
    progression: [...timeline].reverse().map((r) => r.title).filter(Boolean),
  };
}

// ── Grading ─────────────────────────────────────────────────────────

const GRADE_PROMPT = `You are advising a founder on whether a sales candidate fits THEIR company, at THEIR stage. You are decision support — a human makes the call.

THE FLAGS ARE ALREADY DETECTED. The "detectedFlags" array was produced by
deterministic rules over the timeline. Each entry carries a unique "id".
Several flags can share the same "code" (two promotions at two different
employers, say), so narration MUST be keyed on id — narrate every id
separately and never reuse one flag's text for another. Your job is to NARRATE them, not to
find them. You may not add a flag, remove one, or restate its count
differently. If something looks flag-worthy to you but has no entry in
detectedFlags, put it in "couldNotVerify" or "interviewProbes" instead —
never as a flag.

Return ONLY JSON matching this shape:
{
  "verdict": { "level": "strong_fit|worth_a_look|stretch|likely_mismatch", "headline": "<one sentence a human would actually say>", "confidence": "high|medium|low" },
  "profileRequirements": [ { "requirement": "<quoted from their hiring profile>", "status": "met|unmet|unknown", "evidence": "<why>" } ],
  "fitDimensions": [ { "dimension": "stage|motion|category|deal_shape|support_structure", "rating": "strong|adequate|weak|unknown", "rationale": "<why>", "evidence": "<what it rests on>" } ],
  "flagNarration": [ {
    "id": "<the id, copied EXACTLY from detectedFlags — NOT the code>",
    "whyItMatters": "<one or two sentences, for THIS founder at THIS stage>",
    "innocentExplanation": "<the most likely benign reading — REQUIRED for every red flag, null for green>",
    "probe": "<the one question that would settle it, or null>"
  } ],
  "claims": [ { "text": "<their assertion>", "kind": "...", "verified": false, "contradicts": "<or null>" } ],
  "interviewProbes": [ "<question to ask them>" ],
  "couldNotVerify": [ "<what we genuinely could not establish>" ],
  "whatWouldHaveToBeTrue": [ "<condition under which this hire works anyway>" ],
  "backchannel": [ { "who": "<role at which company>", "why": "...", "askThem": "<the one question>" } ]
}

How to judge:
- STAGE IS ASYMMETRIC. Read it as a bonus, not a filter.
  * HAVING early-stage experience — carrying a bag at pre-seed / seed / Series A,
    being an early or first sales hire, selling without SDRs or an SE — is a
    STRONG positive. Lead with it, rate the stage dimension "strong", and let it
    lift the verdict.
  * NOT having it is a NOTE, not a penalty. Most good AEs have never worked at a
    seed company; that is the market, not a defect. Mention it once as something
    to probe, rate the dimension "adequate" or "unknown", and move on.
  * Reserve "weak" for actual adverse evidence — a candidate who says they need
    heavy support, or a record showing they only ever performed with it — never
    for the mere absence of early-stage stints.
- A STAGE GAP ALONE MUST NEVER PRODUCE "stretch" OR "likely_mismatch". If the
  only concern is that they haven't sold at your stage, the verdict is
  "worth_a_look" and the gap belongs in interviewProbes and
  whatWouldHaveToBeTrue. Downgrade the verdict only for a real tenure pattern, a
  hard requirement in their hiring profile that is genuinely unmet, or
  contradicted claims — things about THIS candidate, not about the population
  they came from.
- Use the COMPUTED SIGNALS and the flag claims verbatim for anything numeric.
  Never recompute or estimate tenure yourself.
- Weight the verdict by flag SEVERITY, and discount flags whose confidence is
  "possible" — those rest on year-only dates or a fuzzy company match.
- Flags carrying "suppressedBy" were DISCOUNTED by the rules (a stint ending in
  a known layoff window, say). Do not let them move the verdict. Narrate them
  anyway — the founder sees them in a "considered and discounted" section, and
  showing the work is the point.
- The payload states hiringProfileAvailable. When it is true you MUST grade
  against ourHiringProfile and must NEVER say a profile was unavailable. When
  it is false, say so plainly and name what you used instead.
- If profileRoleUsed differs from profileRoleRequested, the founder has no
  profile for the seat being screened and you are reading a DIFFERENT seat's
  bar. Say so in the first line of the headline, treat requirements that are
  specific to the other seat as not applicable rather than unmet, and put
  "author a <requested role> hiring profile" at the top of couldNotVerify.
- Respect provenance: where a company read is confidence "low" or provenance
  "unknown", do NOT assert its stage — put it in couldNotVerify instead.
- Claims from a résumé are UNVERIFIED. They never move the verdict on their own.
  If a claim contradicts the timeline, say so in "contradicts".
- innocentExplanation is MANDATORY on every red flag and must be genuine, not a
  throat-clear. A flag is a question to ask, never a verdict about a person.
- EXCEPT where a flag has "noExcuses": true. Those are the tenure-pattern
  flags, and they get NO innocent explanation — return null. Do not hedge them,
  do not soften them, do not write whyItMatters as "this could be fine."
  Repeated short tenure is the most predictive negative signal on a sales
  résumé: a rep who leaves before a full quota year never produces, and the
  employer eats the ramp twice. Say that plainly. State the count and name the
  companies. If the candidate has an explanation, they can give it in the
  interview — your job is to make sure the founder actually asks.
- A "critical" tenure flag should drive the verdict to "likely_mismatch" unless
  something genuinely extraordinary outweighs it, and the headline must lead
  with the pattern rather than burying it under their strengths.
- Use rampAdjustedSellingMonths to show how little selling a short stint
  actually contained (e.g. "11 months at Acme is ~7 productive months after a
  typical 4-month ramp") — and label the ramp as an assumption, not a fact.
- FAIRNESS: career breaks are never a flag. Judge the work: stage, motion,
  category, tenure. Never reason from name, location, school prestige, or
  graduation year.
- whatWouldHaveToBeTrue: omit (empty array) when the verdict is strong_fit.
- interviewProbes: 3-5, each tied to a specific gap or unverified claim.`;

/** A detected flag with a stable per-report identity for narration. */
export type FlagWithId = Flag & { id: string };

/** A detected flag plus the model's narration of it. */
export interface NarratedFlag extends FlagWithId {
  whyItMatters: string | null;
  innocentExplanation: string | null;
  probe: string | null;
}

/**
 * Join narration onto the detected flags. The flag list is authoritative:
 * narration the model invented for a code we never detected is dropped,
 * and a flag the model declined to narrate still renders, unnarrated.
 */
function narrate(flags: FlagWithId[], raw: unknown): NarratedFlag[] {
  const byId = new Map<string, Record<string, unknown>>();
  // Codes are only usable as a key when unique. Two promotion_velocity
  // flags at different employers previously collided here and the
  // second one's narration was rendered under the first one's claim —
  // a report that described a fraternity role beside an AE promotion.
  const codeCounts = new Map<string, number>();
  for (const f of flags) codeCounts.set(f.code, (codeCounts.get(f.code) || 0) + 1);
  const byUniqueCode = new Map<string, Record<string, unknown>>();

  if (Array.isArray(raw)) {
    for (const n of raw) {
      if (!n || typeof n !== "object") continue;
      const rec = n as Record<string, unknown>;
      if (typeof rec.id === "string") byId.set(rec.id, rec);
      // Tolerate a model that answered with `code` anyway, but only
      // where that code identifies exactly one flag.
      if (typeof rec.code === "string" && codeCounts.get(rec.code) === 1) {
        byUniqueCode.set(rec.code, rec);
      }
    }
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return flags.map((f) => {
    const n = byId.get(f.id) ?? byUniqueCode.get(f.code);
    return {
      ...f,
      whyItMatters: str(n?.whyItMatters),
      // Enforced in code, not just asked for in the prompt: a model that
      // decides to be charitable about a tenure pattern anyway cannot
      // put that softening in front of the founder.
      innocentExplanation:
        f.polarity === "red" && !f.noExcuses ? str(n?.innocentExplanation) : null,
      probe: str(n?.probe),
    };
  });
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface AssessmentResult {
  id: string;
  candidateName: string;
  verdict: { level: string; headline: string; confidence: string };
  report: Record<string, unknown>;
  timeline: Array<TimelineRole & { read?: CompanyRead }>;
  source: string;
  pdlCallsUsed: number;
}

function candidateKeyFrom(linkedinUrl?: string, name?: string, employer?: string): string {
  if (linkedinUrl) {
    const m = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (m) return `li:${m[1].toLowerCase()}`;
  }
  return `n:${(name || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${(employer || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
}

// ── Account-scoped artifact reads ───────────────────────────────────

/**
 * The founder's GTM artifacts belong to the ACCOUNT, not to whoever
 * happens to be typing. A teammate asking Mikey to screen a candidate
 * must be graded against the same AE Hiring Profile the founder
 * authored — and in Slack the speaker is very often not the author.
 *
 * Reading these by userId alone made the assessment silently announce
 * "no authored AE hiring profile was available" and fall back to
 * generic early-stage criteria, on accounts that had a perfectly good
 * profile sitting in the UI. Own-record-first, then newest in the
 * account — the same shape lib/seller-context.ts already uses.
 */
/**
 * The hiring profile for the seat being screened.
 *
 * Falls back to the AE profile when the seat has none of its own —
 * grading an SDR against the AE bar is still more useful than grading
 * them against nothing — but the fallback is REPORTED rather than
 * silent, so the founder can see they're reading a cross-role
 * comparison and go author the right profile.
 */
async function loadHiringProfile(userId: string, scope: OrgScope, roleLabel: string) {
  // The author's account travels with the profile so the report can
  // name whose bar it graded against — a wrong tenant must be visible,
  // not inferred from the prose.
  const select = {
    id: true,
    content: true,
    title: true,
    roleType: true,
    user: { select: { name: true, email: true, account: { select: { id: true, name: true } } } },
  } as const;
  const wanted = profileRoleForAssessment(roleLabel);
  const find = (roleType: string) =>
    findOwnThenAccount(
      (where) =>
        prisma.hiringProfileVersion.findFirst({
          where: { ...where, roleType },
          orderBy: { createdAt: "desc" },
          select,
        }),
      userId,
      scope
    );

  const exact = await find(wanted);
  if (exact) return { profile: exact, wanted, usedFallback: false };
  if (wanted === "AE") return { profile: null, wanted, usedFallback: false };
  const fallback = await find("AE");
  return { profile: fallback, wanted, usedFallback: !!fallback };
}

async function loadIcp(userId: string, scope: OrgScope) {
  return findOwnThenAccount(
    (where) =>
      prisma.icpVersion.findFirst({
        where,
        orderBy: { createdAt: "desc" },
        select: { content: true },
      }),
    userId,
    scope
  );
}

async function loadMaturityStage(userId: string, scope: OrgScope) {
  // Most recently updated wins on fallback — the stage is a property of
  // the company, and one teammate having set it is enough.
  return findOwnThenAccount(
    (where) => prisma.salesMaturityStage.findFirst({ where, orderBy: { updatedAt: "desc" } }),
    userId,
    scope
  );
}

export async function assessCandidate(input: AssessmentInput): Promise<AssessmentResult> {
  const { userId, linkedinUrl, profileText, roleLabel = "AE" } = input;
  if (!linkedinUrl?.trim() && !profileText?.trim()) {
    throw new Error(
      "Give me a LinkedIn URL, or paste their résumé / LinkedIn PDF text — I need one or the other to assess anyone."
    );
  }

  let pdlCallsUsed = 0;
  let source = "manual";
  let candidateName = input.candidateName || "";
  let headline: string | null = null;
  let timeline: TimelineRole[] = [];
  let claims: Array<{ text: string; kind: string }> = [];
  let hasYearOnlyDates = false;
  let background: CandidateBackground = {};
  let educationSeen = false;

  // 1. Profile acquisition — URL first, then any supplied text.
  if (linkedinUrl?.trim()) {
    const { data, error } = await enrichPersonByLinkedIn(linkedinUrl);
    pdlCallsUsed++;
    if (data) {
      source = "apollo";
      candidateName = candidateName || titleCase(data.name) || "";
      headline =
        [titleCase(data.title), titleCase(data.organization_name || data.organization?.name)]
          .filter(Boolean)
          .join(" @ ") || null;
      const fromApollo = timelineFromApollo(data);
      timeline = fromApollo.timeline;
      hasYearOnlyDates = fromApollo.hasYearOnlyDates;
      background = backgroundFromApollo(data);
      // Education coverage is the known risk in moving off PDL, so it
      // is measured on every run rather than assumed. `educationSeen`
      // reaches the report, so a provider that stops returning schools
      // shows up as a caveat instead of as silently missing green flags.
      educationSeen = (background.schools || []).length > 0;
      if (!educationSeen) {
        console.log(`[candidate-assessment] Apollo returned no education for ${linkedinUrl}`);
      }
    } else {
      console.log(`[candidate-assessment] Apollo miss for ${linkedinUrl}: ${error}`);
    }
  }
  if (timeline.length === 0 && profileText?.trim()) {
    const extracted = await extractProfileFromText(profileText);
    source = source === "pdl" ? "merged" : "pasted";
    candidateName = candidateName || extracted.candidateName || "";
    headline = headline || extracted.headline;
    claims = extracted.claims;
    background = extracted.background;
    hasYearOnlyDates = extracted.roles.some((r) => isYearOnly(r.start) || isYearOnly(r.end));
    timeline = extracted.roles.map((r) => {
      const start = toYearMonth(typeof r.start === "string" ? r.start : null);
      const end = toYearMonth(typeof r.end === "string" ? r.end : null);
      const title = typeof r.title === "string" ? r.title : "";
      return {
        company: typeof r.company === "string" ? r.company : "Unknown",
        companyWebsite: null,
        title,
        start,
        end,
        months: monthsBetween(start, end),
        isSales: typeof r.isSales === "boolean" ? r.isSales : SALES_TITLE.test(title),
      };
    });
  } else if (profileText?.trim() && timeline.length > 0) {
    // Profile came from Apollo; still mine the text for claims it lacks.
    const extracted = await extractProfileFromText(profileText);
    claims = extracted.claims;
    // Union, not replace: the provider may have supplied education, and
    // the résumé adds the activities, awards and service no enrichment
    // API carries — plus education when Apollo returned none.
    background = mergeBackground(background, extracted.background);
    if (claims.length > 0 || (background.distinctions || []).length > 0) source = "merged";
  }

  if (timeline.length === 0) {
    throw new Error(
      "I couldn't read a work history from that. Apollo had no match for the profile — paste their résumé or a LinkedIn PDF export and I'll read that instead."
    );
  }
  if (!candidateName) candidateName = "Unnamed candidate";

  // 2. Which companies are worth researching at all.
  const ageCutoff = new Date();
  ageCutoff.setFullYear(ageCutoff.getFullYear() - MAX_ROLE_AGE_YEARS);
  const cutoffYm = ageCutoff.toISOString().slice(0, 7);
  const researchable = timeline
    .filter((r) => r.isSales)
    .filter((r) => !r.start || r.start >= cutoffYm)
    .filter((r) => r.months == null || r.months >= MIN_MONTHS_FOR_LOOKUP)
    .slice(0, MAX_COMPANIES);

  // 3. One model pass over every company, then verify only the shaky ones.
  let reads = await readCompanies(researchable);
  const before = reads.filter((r) => r.confidence === "low").length;
  reads = await verifyLowConfidence(reads, researchable);
  pdlCallsUsed += Math.min(before, MAX_PDL_VERIFICATIONS);

  // 4. Arithmetic and flag detection in code, never in the model.
  const rubric = rubricFor(roleLabel);
  const signals = computeSignals(timeline, rubric);

  // 5. Grade against the founder's own bar. Every artifact below is
  // account-scoped: in Slack the person asking is frequently not the
  // person who authored the hiring profile.
  // accountId is NULLABLE and a Slack-created user often has only
  // workspaceId, so both are resolved and tried in turn.
  const scopeRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountId: true, workspaceId: true },
  });
  const scope: OrgScope = {
    accountId: scopeRow?.accountId ?? null,
    workspaceId: scopeRow?.workspaceId ?? null,
  };

  const [seller, hiringProfileResult, icp, maturity, orgOverrides, schoolOverrides] = await Promise.all([
    loadSellerContext(userId),
    loadHiringProfile(userId, scope, roleLabel),
    loadIcp(userId, scope),
    loadMaturityStage(userId, scope),
    getOrgOverrides(userId, scope),
    getSchoolOverrides(userId, scope),
  ]);

  const hiringProfile = hiringProfileResult.profile;
  const profileRoleWanted = hiringProfileResult.wanted;
  const profileUsedFallback = hiringProfileResult.usedFallback;

  // Canonicalize schools before the flag engine runs. PDL has no
  // selectivity field — /school/clean returns identity only — so this
  // buys the DOMAIN, which is what the tier registry keys on. Without
  // it we'd be string-matching "U of M" against "University of
  // Michigan" and losing most real matches.
  const schoolNames = [...new Set((background.schools || []).filter(Boolean))].slice(
    0,
    MAX_SCHOOL_LOOKUPS
  );
  if (schoolNames.length > 0) {
    const resolved = await Promise.all(
      schoolNames.map(async (name) => {
        const cleaned = await cleanSchool(name);
        return { name: cleaned?.name || name, domain: cleaned?.domain || null };
      })
    );
    background = { ...background, resolvedSchools: resolved };
  }

  const flags = detectFlags({
    timeline,
    reads,
    roleLabel,
    ourStage: maturity?.currentStage || null,
    hasYearOnlyDates,
    background,
    orgOverrides,
    schoolOverrides,
  });

  // Stable per-report ids. Codes repeat legitimately (two promotions
  // at two employers), so they cannot identify a flag on their own.
  const flagsWithIds: FlagWithId[] = flags.map((f, i) => ({ ...f, id: `${f.code}#${i + 1}` }));

  const gradePayload = {
    roleLabel,
    candidate: { name: candidateName, headline },
    timeline: timeline.map((r) => ({
      ...r,
      read: reads.find((x) => x.company === r.company) || null,
    })),
    computedSignals: signals,
    detectedFlags: flagsWithIds,
    resumeClaims: claims,
    ourStage: maturity?.currentStage || "unknown",
    ourHiringProfile: hiringProfile?.content?.slice(0, 12_000) || "(none authored yet)",
    // Stated explicitly so the model cannot decide on its own that a
    // profile was missing — it announced exactly that on an account
    // that had one, because the read was not account-scoped.
    hiringProfileAvailable: !!hiringProfile?.content,
    // When these differ the profile is from a DIFFERENT seat and the
    // model must say so rather than implying a same-role comparison.
    profileRoleRequested: profileRoleWanted,
    profileRoleUsed: hiringProfile?.roleType ?? null,
    ourSalesNarrative: seller.narrative?.slice(0, 8_000) || "(none)",
    ourValueProp: seller.valueProp100w?.slice(0, 1_500) || "(none)",
    ourICP: icp?.content?.slice(0, 4_000) || "(none)",
  };

  const completion = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "user", content: `${GRADE_PROMPT}\n\n---\n\n${JSON.stringify(gradePayload, null, 2)}` },
    ],
  });
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("The assessment came back unparseable — try again.");
  }
  console.log(
    `[candidate-assessment] user=${userId} account=${scope.accountId ?? "none"} ` +
      `workspace=${scope.workspaceId ?? "none"} ` +
      `hiringProfile=${hiringProfile?.id ?? "MISSING"}(${hiringProfile?.user?.account?.name ?? "no account"},` +
      `want=${profileRoleWanted},got=${hiringProfile?.roleType ?? "none"}${profileUsedFallback ? ",FALLBACK" : ""}) ` +
      `icp=${icp ? "yes" : "no"} ` +
      `stage=${maturity?.currentStage ?? "none"}`
  );

  const verdict = (report.verdict as { level?: string; headline?: string; confidence?: string }) || {};
  const level = typeof verdict.level === "string" ? verdict.level : "worth_a_look";

  // The flag sections are BUILT FROM THE DETECTED FLAGS, not from the
  // model's output — narration is joined on by code, so the model
  // cannot smuggle in a flag it liked or quietly drop one it didn't.
  const narrated = narrate(flagsWithIds, report.flagNarration);
  delete report.flagNarration;
  const { active, discounted } = partitionFlags(narrated);
  const bySeverity = (a: Flag, b: Flag) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  report.redFlags = active.filter((f) => f.polarity === "red").sort(bySeverity);
  report.greenFlags = active.filter((f) => f.polarity === "green").sort(bySeverity);
  report.discountedFlags = discounted.sort(bySeverity);
  report.rubric = { roleLabel, ...rubric, rubricVersion: RUBRIC_VERSION };

  // Provenance travels with the report so the UI can mark soft rows.
  report.timeline = gradePayload.timeline;
  report.candidate = { name: candidateName, headline, linkedinUrl: linkedinUrl || null, source };
  // What the grade actually rested on, as fact rather than narration.
  report.gradedAgainst = {
    hiringProfile: !!hiringProfile?.content,
    hiringProfileVersionId: hiringProfile?.id || null,
    hiringProfileTitle: hiringProfile?.title || null,
    // Naming the account is the guardrail: grading one customer against
    // another customer's bar should be obvious on sight.
    hiringProfileAccount: hiringProfile?.user?.account?.name || null,
    hiringProfileRole: hiringProfile?.roleType ?? null,
    requestedRole: profileRoleWanted,
    crossRoleFallback: profileUsedFallback,
    icp: !!icp?.content,
    maturityStage: maturity?.currentStage || null,
  };

  // Data coverage, stated rather than assumed. School selectivity is one
  // of the heaviest green flags, and Apollo's education coverage is
  // thinner than PDL's — so when a URL-only assessment comes back with
  // no schools, the report says so. Otherwise "no school green flag"
  // and "we never learned their school" look identical to the reader.
  // `educationSeen` is the provider diagnostic (did Apollo supply it?);
  // haveEducation is what the reader actually needs, since a pasted
  // résumé can fill the gap Apollo left.
  const haveEducation = (background.schools || []).length > 0;
  report.dataCoverage = {
    enrichmentProvider: linkedinUrl?.trim() ? "apollo" : "none",
    apolloReturnedEducation: educationSeen,
    educationFound: haveEducation,
    educationNote: haveEducation
      ? null
      : "No education was found for this profile, so the school-selectivity and major signals could not be evaluated — their absence here is missing data, not a negative. Paste a résumé or LinkedIn PDF export to fill that in.",
  };

  const row = await prisma.candidateAssessment.create({
    data: {
      userId,
      candidateKey: candidateKeyFrom(linkedinUrl, candidateName, timeline[0]?.company),
      candidateName,
      linkedinUrl: linkedinUrl || null,
      hiringProfileVersionId: hiringProfile?.id || null,
      maturityStage: maturity?.currentStage || null,
      source,
      roleLabel,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawProfile: { timeline, reads, signals, claims, flags, background } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assessment: report as any,
      verdict: level,
      rubricVersion: RUBRIC_VERSION,
      model: MODEL,
    },
  });

  return {
    id: row.id,
    candidateName,
    verdict: {
      level,
      headline: typeof verdict.headline === "string" ? verdict.headline : "",
      confidence: typeof verdict.confidence === "string" ? verdict.confidence : "medium",
    },
    report,
    timeline: gradePayload.timeline as Array<TimelineRole & { read?: CompanyRead }>,
    source,
    pdlCallsUsed,
  };
}
