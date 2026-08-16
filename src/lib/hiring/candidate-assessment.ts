import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { loadSellerContext } from "@/lib/seller-context";
import {
  enrichPersonByLinkedIn,
  enrichCompanyByNameOrDomain,
  type PDLPersonResult,
  type PDLCompanyResult,
} from "@/lib/search/pdl";
import { getOrgOverrides } from "./org-overrides";
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
 * Cost posture: the model knows the well-known companies (and is the
 * only source for motion/category/buyer anyway — PDL has no such
 * field), so we take ONE knowledge pass over every company and spend
 * PDL credits only where the model's confidence is low. Typical run is
 * 1 person enrich + 0-3 company enrichments rather than one per role.
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
    const title = e.title?.name || "";
    return {
      company: e.company?.name || "Unknown",
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
deterministic rules over the timeline. Your job is to NARRATE them, not to
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
    "code": "<the code, copied EXACTLY from detectedFlags>",
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
- STAGE is the load-bearing dimension for a first sales hire. Someone who only
  ever sold with brand, inbound, SDRs and an SE behind them is a real risk at a
  seed company — say so plainly, without being unkind.
- Use the COMPUTED SIGNALS and the flag claims verbatim for anything numeric.
  Never recompute or estimate tenure yourself.
- Weight the verdict by flag SEVERITY, and discount flags whose confidence is
  "possible" — those rest on year-only dates or a fuzzy company match.
- Flags carrying "suppressedBy" were DISCOUNTED by the rules (a stint ending in
  a known layoff window, say). Do not let them move the verdict. Narrate them
  anyway — the founder sees them in a "considered and discounted" section, and
  showing the work is the point.
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

/** A detected flag plus the model's narration of it. */
export interface NarratedFlag extends Flag {
  whyItMatters: string | null;
  innocentExplanation: string | null;
  probe: string | null;
}

/**
 * Join narration onto the detected flags. The flag list is authoritative:
 * narration the model invented for a code we never detected is dropped,
 * and a flag the model declined to narrate still renders, unnarrated.
 */
function narrate(flags: Flag[], raw: unknown): NarratedFlag[] {
  const byCode = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw)) {
    for (const n of raw) {
      if (n && typeof n === "object" && typeof (n as { code?: unknown }).code === "string") {
        byCode.set((n as { code: string }).code, n as Record<string, unknown>);
      }
    }
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return flags.map((f) => {
    const n = byCode.get(f.code);
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

  // 1. Profile acquisition — URL first, then any supplied text.
  if (linkedinUrl?.trim()) {
    const { data, error } = await enrichPersonByLinkedIn(linkedinUrl);
    pdlCallsUsed++;
    if (data) {
      source = "pdl";
      candidateName = candidateName || data.full_name || "";
      headline = [data.job_title, data.job_company_name].filter(Boolean).join(" @ ") || null;
      const fromPdl = timelineFromPDL(data);
      timeline = fromPdl.timeline;
      hasYearOnlyDates = fromPdl.hasYearOnlyDates;
    } else {
      console.log(`[candidate-assessment] PDL miss for ${linkedinUrl}: ${error}`);
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
    // Profile came from PDL; still mine the text for claims it lacks.
    const extracted = await extractProfileFromText(profileText);
    claims = extracted.claims;
    // PDL carries no education or activities at all, so the résumé is
    // the ONLY source for the background signals — mine it even when
    // the timeline already came from PDL.
    background = extracted.background;
    if (claims.length > 0 || (background.distinctions || []).length > 0) source = "merged";
  }

  if (timeline.length === 0) {
    throw new Error(
      "I couldn't read a work history from that. PDL had no match for the profile — paste their résumé or a LinkedIn PDF export and I'll read that instead."
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

  // 5. Grade against the founder's own bar.
  const [seller, hiringProfile, icp, maturity, orgOverrides] = await Promise.all([
    loadSellerContext(userId),
    prisma.hiringProfileVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true },
    }),
    prisma.icpVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    }),
    prisma.salesMaturityStage.findUnique({ where: { userId } }),
    getOrgOverrides(userId),
  ]);

  const flags = detectFlags({
    timeline,
    reads,
    roleLabel,
    ourStage: maturity?.currentStage || null,
    hasYearOnlyDates,
    background,
    orgOverrides,
  });

  const gradePayload = {
    roleLabel,
    candidate: { name: candidateName, headline },
    timeline: timeline.map((r) => ({
      ...r,
      read: reads.find((x) => x.company === r.company) || null,
    })),
    computedSignals: signals,
    detectedFlags: flags,
    resumeClaims: claims,
    ourStage: maturity?.currentStage || "unknown",
    ourHiringProfile: hiringProfile?.content?.slice(0, 12_000) || "(none authored yet)",
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
  const verdict = (report.verdict as { level?: string; headline?: string; confidence?: string }) || {};
  const level = typeof verdict.level === "string" ? verdict.level : "worth_a_look";

  // The flag sections are BUILT FROM THE DETECTED FLAGS, not from the
  // model's output — narration is joined on by code, so the model
  // cannot smuggle in a flag it liked or quietly drop one it didn't.
  const narrated = narrate(flags, report.flagNarration);
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
