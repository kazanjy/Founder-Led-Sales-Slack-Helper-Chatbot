import type { TimelineRole, CompanyRead } from "./candidate-assessment";
import { lookupSalesOrg, type OrgOverride } from "./sales-org-registry";
import { lookupSchool, type SchoolOverride } from "./school-registry";

/**
 * Deterministic flag engine (SalesFlag PRD §5).
 *
 * THE ARCHITECTURAL RULE: **rules produce the flags; the LLM never
 * invents one.** Detection is TypeScript over the normalized timeline
 * — auditable, testable, and identical for the same input every time.
 * The model's job downstream is narration only: the summary read,
 * innocent explanations, and interview probes.
 *
 * Three properties every flag carries, per the PRD's design
 * principles:
 *   - SEVERITY (high/medium/low), role-adjusted.
 *   - SUPPRESSION with a visible reason. A 10-month stint ending in a
 *     mass-layoff window is not a hopping signal — but the suppressed
 *     flag is still returned, so the report can show a "considered but
 *     discounted" section. Silent filtering is untrustworthy filtering.
 *   - CONFIDENCE: "detected" on month-precision dates, "possible" when
 *     computed from year-only dates or fuzzy company matches.
 *
 * Flags are evidence-backed prompts, never verdicts.
 */

export type Severity = "critical" | "high" | "medium" | "low";
export type FlagPolarity = "red" | "green";
export type FlagConfidence = "detected" | "possible";

export interface Flag {
  code: string;
  polarity: FlagPolarity;
  severity: Severity;
  confidence: FlagConfidence;
  /** One line, specific and countable. */
  claim: string;
  /** The underlying data, so the user can eyeball-verify. */
  evidence: string;
  /** Stints this flag is pinned to, for timeline rendering. */
  companies: string[];
  /** Set when discounted — the flag still renders, in the discounted section. */
  suppressedBy?: string;
  /**
   * Blocks the mandatory innocent explanation. Reserved for the
   * tenure-pattern flags: a repeated inability to stay is the single
   * most predictive negative signal in a sales résumé, and softening it
   * with a hypothetical benign reading is how a hiring manager talks
   * themselves into a bad hire. Any real explanation comes from the
   * candidate in the interview, not from us pre-supplying one.
   */
  noExcuses?: boolean;
}

// ── Role-relative configuration (PRD §5.1: role-relative scoring) ───

export interface RoleRubric {
  /** A stint under this is "short" for this seat. */
  shortStintMonths: number;
  /** How many short stints constitute a pattern. TWO is a pattern. */
  serialShortStintCount: number;
  /** At or above this count the pattern is disqualifying, not a question. */
  serialShortStintDisasterCount: number;
  /** Months of ramp assumed when showing productive selling time. */
  rampMonths: number;
}

/**
 * Cycle length drives the bar: an 18-month enterprise cycle needs a
 * longer runway to prove anything than transactional SDR work does.
 *
 * The COUNT is deliberately unforgiving — two short stints is a
 * pattern, four is a disaster. Sales hiring is where a tenure pattern
 * costs the most: a rep who leaves before a full quota year never
 * produces, and you eat the ramp twice.
 *
 * The THRESHOLD stays role-relative, because it has to be. Median SDR
 * tenure is genuinely around 14 months, so applying the AE's 18-month
 * bar to an SDR would flag essentially every SDR alive — noise, not
 * signal. Judge each seat against its own norm.
 */
export const ROLE_RUBRICS: Record<string, RoleRubric> = {
  SDR: { shortStintMonths: 12, serialShortStintCount: 2, serialShortStintDisasterCount: 4, rampMonths: 2 },
  AE: { shortStintMonths: 18, serialShortStintCount: 2, serialShortStintDisasterCount: 4, rampMonths: 4 },
  AM: { shortStintMonths: 18, serialShortStintCount: 2, serialShortStintDisasterCount: 4, rampMonths: 3 },
  CSM: { shortStintMonths: 18, serialShortStintCount: 2, serialShortStintDisasterCount: 4, rampMonths: 3 },
  Manager: { shortStintMonths: 18, serialShortStintCount: 2, serialShortStintDisasterCount: 4, rampMonths: 5 },
  VP: { shortStintMonths: 24, serialShortStintCount: 2, serialShortStintDisasterCount: 3, rampMonths: 6 },
};

export function rubricFor(roleLabel: string): RoleRubric {
  const key = Object.keys(ROLE_RUBRICS).find(
    (k) => k.toLowerCase() === (roleLabel || "AE").trim().toLowerCase()
  );
  return ROLE_RUBRICS[key || "AE"];
}

// ── Background / "grit" signals ─────────────────────────────────────

/**
 * Bonus signals from outside the employment timeline.
 *
 * THE GOVERNING RULE: these are GREEN-ONLY. Their absence is never a
 * red flag, never lowers a rating, and never appears in the report at
 * all. That isn't squeamishness — it's what keeps them useful. Most
 * good AEs didn't play varsity anything, so "no athletics" carries no
 * information, and a bonus-only signal cannot quietly harden into a
 * filter that screens out people who worked instead of rowing.
 *
 * Two deliberate omissions:
 *
 * - GRADUATION YEAR is never extracted or used. It is an age proxy,
 *   and age is protected under the ADEA. School and major are readable
 *   without it.
 * - EAGLE SCOUT is not matched as a bare keyword. The award was
 *   male-only until 2019, so keyed literally it is a sex proxy for
 *   anyone who earned it before then. The thing actually worth
 *   crediting is a multi-year program carried to its terminal rank, so
 *   that is what we match — across Scouts BSA, Girl Scouts, Duke of
 *   Edinburgh and similar.
 */
export interface CandidateBackground {
  /** School names as written. No graduation years, by design. */
  schools?: string[];
  /**
   * Schools resolved through PDL's School Cleaner — canonical name plus
   * domain. The selectivity registry keys on domain, so this is what
   * makes the lookup reliable; raw names are a lossy fallback.
   */
  resolvedSchools?: Array<{ name: string; domain: string | null }>;
  /** Fields of study as written. */
  majors?: string[];
  /**
   * Verbatim honors, activities and distinctions from the résumé —
   * athletics, service, awards, scholarships, work-during-school.
   */
  distinctions?: string[];
}

/**
 * "Smart major", in two bands.
 *
 * TECHNICAL is the harder signal for a complex sale: someone who got
 * through an engineering or hard-science degree can hold a technical
 * conversation with a buyer's engineers without an SE in the room,
 * which is exactly the constraint at a seed company.
 *
 * BUSINESS_QUANT is the classic sales-hiring major band — economics,
 * finance, accounting. Numerate enough to build a business case and
 * argue an ROI model.
 *
 * Both are weak evidence about how someone actually runs a deal, which
 * is why they cap at "low" and carry "possible" confidence.
 */
const TECHNICAL_MAJOR =
  /\b(engineer(ing)?|computer science|comp sci|\bcs\b|physics|chemistry|biochem\w*|mathematics|maths?|applied math|statistics|data science|actuarial|operations research|neuroscience|biomedical|electrical|mechanical|chemical engineering|aerospace)\b/i;

const BUSINESS_QUANT_MAJOR =
  /\b(econom(ics|y)|finance|accounting|business analytics|quantitative|supply chain|industrial (engineering|management))\b/i;

/** Majors whose value here is persuasion and argument under pressure. */
const PERSUASION_MAJOR =
  /\b(rhetoric|debate|communications?|philosophy|political science|classics|journalism|law|pre-?law)\b/i;

/**
 * PROFESSIONAL athletics — a different order of signal from collegiate
 * and deliberately scored separately. Getting paid to play means
 * surviving a selection funnel far narrower than a varsity roster, and
 * then holding a job that is re-evaluated on measured performance
 * continuously and publicly. That is the closest thing to a carried
 * quota that exists outside sales.
 *
 * Includes semi-pro, minor-league and development systems: those are
 * arguably the *better* signal, since they involve the same grind
 * without the money or the fame.
 */
const PRO_ATHLETICS =
  /\b(professional athlete|played professionally|pro athlete|semi[- ]?pro(fessional)?|minor league|\bnfl\b|\bnba\b|\bmlb\b|\bnhl\b|\bmls\b|\bwnba\b|\bnwsl\b|\bpga\b|\blpga\b|\batp tour\b|\bwta\b|\bufc\b|premier league|la liga|serie a|bundesliga|g[- ]league|practice squad|draft(ed)? (pick|by|in the)|olympi(c|an|ad)|national team|team usa|world championships?|professional (soccer|football|basketball|baseball|hockey|rugby|cricket|lacrosse|volleyball|cycl(ing|ist)|tennis|golf(er)?|box(ing|er)|athlete|player|runner|swimmer|rower|skier|triathlete|racer|driver|fighter|dancer))\b/i;

/**
 * COLLEGIATE / competitive athletics. Team captaincy and walk-on
 * status are the parts that actually carry signal — sustained
 * coachability and voluntary exposure to being cut.
 */
const ATHLETICS =
  /\b(varsity|division (i|1|ii|2|iii|3)\b|\bd-?[123]\b|ncaa|collegiate athlete|student[- ]athlete|team captain|all[- ](american|conference|state)|rowing crew|walk[- ]on)\b/i;

/**
 * Terminal ranks of multi-year youth achievement programs. Matched by
 * PROGRAM rank rather than by the word "Eagle" alone — see the sex-proxy
 * note above.
 */
const SUSTAINED_PROGRAM =
  /\b(eagle scout|girl scout gold award|gold award recipient|duke of edinburgh|questbridge|boys state|girls state|congressional award)\b/i;

/** Military service — a classic and well-evidenced sales grit signal. */
const MILITARY =
  /\b(army|navy|marine corps|marines|air force|coast guard|national guard|rotc|veteran|deployed|nco|non-?commissioned officer|officer candidate school|west point|annapolis|naval academy|air force academy)\b/i;

/**
 * Worked through school. The most underrated signal in the set, and
 * the one that runs OPPOSITE to the class bias the rest of this
 * section risks: it credits the candidate who had to fund their own
 * education rather than the one who could afford not to.
 */
const WORKED_THROUGH_SCHOOL =
  /\b(worked (my|his|her|their) way through|self[- ]funded (my |his |her |their )?(education|college|degree|tuition)|paid for (my|his|her|their) own (tuition|education|college)|full[- ]time (while|during) (school|college|studies)|30\+? hours.{0,20}while|working (full|part)[- ]time through)\b/i;

/** Earned distinction, as opposed to attendance. */
const ACADEMIC_HONORS =
  /\b(summa cum laude|magna cum laude|cum laude|phi beta kappa|valedictorian|salutatorian|dean'?s list|first class honours|academic scholarship|merit scholarship|honors (college|program)|thesis with (distinction|honors))\b/i;

/** Sales-specific competitive achievement. */
const SALES_COMPETITION =
  /\b(president'?s club|winner'?s circle|chairman'?s club|rookie of the year|#1 (rep|ae|seller)|top (1|2|3|5|10)%? (rep|of|globally|worldwide)|pinnacle club|circle of excellence)\b/i;

// ── Company registry (PRD §7.3 — a curated, compounding asset) ──────
// Lives in ./sales-org-registry.ts, which carries tiers, era windows
// and per-account overrides.

/**
 * Macro windows where short stints are usually the market, not the
 * person. Suppression is date-based and deliberately generous — the
 * cost of a false "job hopper" flag is a good candidate discarded.
 */
export const LAYOFF_WINDOWS: Array<{ from: string; to: string; label: string }> = [
  { from: "2020-03", to: "2020-10", label: "the COVID-era cuts" },
  { from: "2022-05", to: "2024-03", label: "the 2022-24 tech correction" },
];


function layoffWindowFor(end: string | null): string | null {
  if (!end) return null;
  const w = LAYOFF_WINDOWS.find((x) => end >= x.from && end <= x.to);
  return w ? w.label : null;
}

// ── Title ladder (PRD §5.2 descending-trajectory / promotion velocity)

const TITLE_LEVELS: Array<{ level: number; name: string; re: RegExp }> = [
  { level: 1, name: "entry", re: /\b(sdr|bdr|intern|associate|junior|jr\.?)\b/i },
  { level: 2, name: "ic", re: /\b(account executive|ae|account manager|rep|specialist|consultant)\b/i },
  { level: 3, name: "senior ic", re: /\b(senior|sr\.?|enterprise|strategic|principal|lead)\b/i },
  { level: 4, name: "manager", re: /\b(manager|head of)\b/i },
  { level: 5, name: "director", re: /\bdirector\b/i },
  { level: 6, name: "vp", re: /\b(vp|vice president)\b/i },
  { level: 7, name: "exec", re: /\b(cro|cso|chief|founder|co-founder)\b/i },
];

export function titleLevel(title: string): number {
  let level = 0;
  for (const t of TITLE_LEVELS) if (t.re.test(title)) level = Math.max(level, t.level);
  return level;
}

/**
 * The SEGMENT ladder, which is orthogonal to seniority and is how AEs
 * actually get promoted. "Corporate AE → Mid-Market AE" is a real
 * promotion, but both titles sit on the same seniority rung, so a
 * ladder that only knows about Senior/Director/VP scores the move as
 * nothing and can even read it as churn. Segment is the missing axis.
 */
const SEGMENT_LEVELS: Array<{ level: number; re: RegExp }> = [
  { level: 1, re: /\b(smb|small business|self[- ]serve|transactional|velocity)\b/i },
  { level: 2, re: /\b(commercial|corporate|inside sales|growth accounts)\b/i },
  { level: 3, re: /\b(mid[- ]?market|\bmm\b)\b/i },
  { level: 4, re: /\benterprise\b/i },
  { level: 5, re: /\b(strategic|major accounts?|global accounts?|named accounts?|key accounts?)\b/i },
];

export function segmentLevel(title: string): number {
  let level = 0;
  for (const s of SEGMENT_LEVELS) if (s.re.test(title)) level = Math.max(level, s.level);
  return level;
}

const NON_QUOTA_TITLE = /\b(business development|growth|partnerships|consultant|advisor|strategy|operations)\b/i;
const QUOTA_TITLE = /\b(account executive|\bae\b|sales rep|sales representative|enterprise sales|sales manager|cro)\b/i;
const CONSULTANT_TITLE = /\b(consultant|advisor|freelance|self-employed|independent)\b/i;

// ── Detection ───────────────────────────────────────────────────────

export interface FlagEngineInput {
  timeline: TimelineRole[];
  reads: CompanyRead[];
  roleLabel: string;
  /** Our own stage, for the environment-fit flag. */
  ourStage?: string | null;
  /** True when any date arrived year-only — downgrades confidence. */
  hasYearOnlyDates?: boolean;
  /** Education / activities, for the green-only bonus signals. */
  background?: CandidateBackground;
  /** Account-specific "treat this org as high-bar" additions. */
  orgOverrides?: OrgOverride[];
  /** Account-specific "these schools matter to us" additions. */
  schoolOverrides?: SchoolOverride[];
}

export function detectFlags(input: FlagEngineInput): Flag[] {
  const { timeline, reads, roleLabel, hasYearOnlyDates } = input;
  const rubric = rubricFor(roleLabel);
  const flags: Flag[] = [];
  const conf: FlagConfidence = hasYearOnlyDates ? "possible" : "detected";
  const sales = timeline.filter((r) => r.isSales);
  const dated = timeline.filter((r) => r.start && r.months != null);

  const sixYearsAgo = new Date();
  sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
  const recentCutoff = sixYearsAgo.toISOString().slice(0, 7);

  // Company-level view. Tenure at a company is the sum of its roles —
  // an SDR-then-AE run at one employer is one long stint, not two short
  // ones, and flagging it twice would double-count the same fact.
  const byCompany = new Map<string, TimelineRole[]>();
  for (const r of timeline) {
    byCompany.set(r.company, [...(byCompany.get(r.company) || []), r]);
  }
  const companyTenure = new Map<string, { months: number; from: string | null; to: string | null }>();
  for (const [company, rs] of byCompany) {
    const months = rs.reduce((sum, r) => sum + (r.months || 0), 0);
    const starts = rs.map((r) => r.start).filter((s): s is string => !!s).sort();
    companyTenure.set(company, {
      months,
      from: starts[0] || null,
      to: rs.some((r) => !r.end)
        ? null
        : rs.map((r) => r.end).filter((e): e is string => !!e).sort().pop() || null,
    });
  }

  // ── RED: serial short stints ─────────────────────────────────────
  // HOPPING IS MEASURED PER EMPLOYER, NEVER PER ROLE.
  //
  // Moving between companies quickly is the risk. Moving between SEATS
  // inside one company is the opposite — it's usually a promotion, and
  // it already scores as a green flag below. Counting each role
  // separately turns "12 months as Corporate AE then 17 as Mid-Market
  // AE at the same employer" into two hops when it is in fact a
  // 29-month tenure with an internal move: a healthy record reported as
  // a chronic pattern, which is the worst failure this engine can have.
  //
  // A company they are STILL AT is also not a stint — nobody has left
  // it, and counting the current job is the easiest way to libel
  // someone who simply started recently.
  const shortStints = [...companyTenure.entries()]
    .map(([company, t]) => ({ company, ...t }))
    .filter(
      (t) =>
        !!t.to &&
        (t.from || "") >= recentCutoff &&
        t.months > 0 &&
        t.months < rubric.shortStintMonths
    )
    .sort((a, b) => (b.from || "").localeCompare(a.from || ""));
  const inLayoffWindow = shortStints.filter((t) => layoffWindowFor(t.to));

  if (shortStints.length >= rubric.serialShortStintCount) {
    const n = shortStints.length;
    const disaster = n >= rubric.serialShortStintDisasterCount;
    const productive = shortStints.reduce(
      (sum, t) => sum + Math.max(0, t.months - rubric.rampMonths),
      0
    );
    // NOT suppressed by layoff windows. A downturn explains ONE exit; it
    // does not explain a career of them, and the count is the signal.
    // The window is still reported as fact in the evidence line — the
    // founder gets the context without the flag being talked down.
    flags.push({
      code: "serial_short_stints",
      polarity: "red",
      severity: disaster ? "critical" : "high",
      confidence: conf,
      claim: disaster
        ? `${n} different employers left inside ${rubric.shortStintMonths} months, in the last 6 years — a chronic pattern, not a run of bad luck`
        : `${n} different employers left inside ${rubric.shortStintMonths} months, in the last 6 years`,
      evidence: [
        shortStints
          .map((t) => `${t.company} — ${t.months}mo total (${t.from}–${t.to})`)
          .join("; "),
        `~${productive} productive months across all ${n} after a ${rubric.rampMonths}mo ramp each`,
        inLayoffWindow.length
          ? `${inLayoffWindow.length} ended during a known downturn (context, not an excuse — the count still stands)`
          : null,
      ]
        .filter(Boolean)
        .join(". "),
      companies: shortStints.map((t) => t.company),
      noExcuses: true,
    });
  }

  // ── RED: washed out of a high-bar org ────────────────────────────
  for (const [company, tenure] of companyTenure) {
    const org = lookupSalesOrg(company, {
      start: tenure.from,
      end: tenure.to,
      overrides: input.orgOverrides,
      roleLabel,
    });
    // Only counts as washing out if they were there during the era that
    // earned the reputation. Eight months at 2021 Xerox says nothing.
    // Needs credit as well as overlap: you cannot "wash out" of an org
    // the asset doesn't score as high-bar in the first place.
    if (!org || !org.inWindow || org.creditMultiplier <= 0 || !tenure.to || tenure.months >= 12) {
      continue;
    }
    const layoff = layoffWindowFor(tenure.to);
    flags.push({
      code: "short_stint_high_bar_org",
      polarity: "red",
      // Washing out of a canonical academy is a sharper signal than
      // leaving a merely strong org early.
      severity: (org.numericTier ?? 3) <= 1.5 ? "high" : "medium",
      confidence: conf,
      claim: `${tenure.months} months at ${org.entry.name}${org.eraLabel ? ` (${org.eraLabel})` : ""}, a high-bar sales org`,
      evidence: `${org.entry.basis}. ${(byCompany.get(company) || [])
        .map((r) => `${r.title}, ${r.start}–${r.end || "present"}`)
        .join("; ")}`,
      companies: [company],
      ...(layoff ? { suppressedBy: `ended during ${layoff}` } : {}),
    });
  }

  // ── RED: descending title trajectory ─────────────────────────────
  const levelled = [...dated]
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
    .map((r) => ({ ...r, level: titleLevel(r.title) }))
    .filter((r) => r.level > 0);
  if (levelled.length >= 3) {
    const first = levelled[0].level;
    const last = levelled[levelled.length - 1].level;
    if (last < first - 1) {
      flags.push({
        code: "descending_title_trajectory",
        polarity: "red",
        severity: "medium",
        confidence: conf,
        claim: "Seniority has moved down over time, not up",
        evidence: levelled.map((r) => `${r.title} @ ${r.company}`).join(" → "),
        companies: levelled.map((r) => r.company),
      });
    }
  }

  // ── RED: never promoted anywhere ─────────────────────────────────
  const longStints = dated.filter((r) => (r.months as number) >= 30);
  const anyInternalPromo = [...byCompany.values()].some(
    (rs) => new Set(rs.map((r) => r.title)).size > 1
  );
  if (longStints.length >= 2 && !anyInternalPromo) {
    flags.push({
      code: "never_promoted",
      polarity: "red",
      severity: "medium",
      confidence: conf,
      claim: "No title change inside any company, across multiple long stints",
      evidence: longStints
        .map((r) => `${r.title} @ ${r.company} for ${r.months}mo`)
        .join("; "),
      companies: longStints.map((r) => r.company),
    });
  }

  // ── RED: unexplained gaps ────────────────────────────────────────
  const chrono = [...dated].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  for (let i = 1; i < chrono.length; i++) {
    const prevEnd = chrono[i - 1].end;
    const nextStart = chrono[i].start;
    if (!prevEnd || !nextStart) continue;
    const gap =
      (Number(nextStart.slice(0, 4)) - Number(prevEnd.slice(0, 4))) * 12 +
      (Number(nextStart.slice(5, 7)) - Number(prevEnd.slice(5, 7)));
    if (gap > 6) {
      flags.push({
        code: "employment_gap",
        polarity: "red",
        severity: "low",
        confidence: conf,
        claim: `${gap}-month gap after ${chrono[i - 1].company}`,
        evidence: `${prevEnd} → ${nextStart}`,
        companies: [chrono[i - 1].company],
        ...(layoffWindowFor(prevEnd)
          ? { suppressedBy: `the stint ended during ${layoffWindowFor(prevEnd)}` }
          : {}),
      });
    }
  }

  // ── RED: departures clustered pre-first-full-quota-year ──────────
  // Per EMPLOYER, for the same reason serial_short_stints is: leaving a
  // ROLE at 12 months to take another seat at the same company is a
  // promotion, not a departure before the number lands.
  const preMilestone = [...companyTenure.entries()]
    .map(([company, t]) => ({ company, ...t }))
    .filter(
      (t) =>
        !!t.to &&
        t.months >= 10 &&
        t.months <= 14 &&
        (byCompany.get(t.company) || []).some((r) => r.isSales)
    );
  if (preMilestone.length >= 2) {
    flags.push({
      code: "pre_milestone_departures",
      polarity: "red",
      // The same tenure pattern seen more precisely: leaving at exactly
      // the point a full quota year would become visible. Held to the
      // same no-excuses standard as serial hopping.
      severity: "medium",
      confidence: conf,
      claim: `${preMilestone.length} employers left at 10-14 months — each one just before a full quota year would show`,
      evidence: preMilestone.map((t) => `${t.company} — ${t.months}mo total`).join("; "),
      companies: preMilestone.map((t) => t.company),
      noExcuses: true,
    });
  }

  // ── RED: title inflation ─────────────────────────────────────────
  for (const r of timeline) {
    if (titleLevel(r.title) < 6) continue;
    const read = reads.find((x) => x.company === r.company);
    const headcount = read?.employeeEstimate || "";
    const small = /\b([1-9]|1[0-4])\b\s*(-|–|to)?\s*\d{0,2}\s*(people|employees)?/.test(headcount)
      || /pre-seed|seed/.test(read?.stageAtStart || "");
    if (small) {
      flags.push({
        code: "title_inflation",
        polarity: "red",
        severity: "medium",
        confidence: "possible",
        claim: `${r.title} at a company of roughly ${headcount || "very small"} size`,
        evidence: `${r.title} @ ${r.company} (${read?.stageAtStart || "stage unknown"}, ${headcount || "headcount unknown"})`,
        companies: [r.company],
      });
    }
  }

  // ── RED: never carried a bag ─────────────────────────────────────
  if (sales.length > 0 && !timeline.some((r) => QUOTA_TITLE.test(r.title))) {
    flags.push({
      code: "no_quota_carrying_role",
      polarity: "red",
      severity: "medium",
      confidence: conf,
      claim: "No clearly quota-carrying title anywhere in the history",
      evidence: timeline
        .filter((r) => NON_QUOTA_TITLE.test(r.title))
        .map((r) => `${r.title} @ ${r.company}`)
        .join("; "),
      companies: sales.map((r) => r.company),
    });
  }

  // ── RED: consultant interludes ───────────────────────────────────
  const interludes = dated.filter(
    (r) => CONSULTANT_TITLE.test(r.title) && (r.months as number) < 12
  );
  if (interludes.length >= 2) {
    flags.push({
      code: "consultant_interludes",
      polarity: "red",
      severity: "medium",
      confidence: conf,
      claim: `${interludes.length} short consulting/advisory stints between roles`,
      evidence: interludes.map((r) => `${r.title} — ${r.months}mo`).join("; "),
      companies: interludes.map((r) => r.company),
    });
  }

  // ── RED: date obfuscation ────────────────────────────────────────
  if (hasYearOnlyDates) {
    flags.push({
      code: "date_obfuscation",
      polarity: "red",
      severity: "low",
      confidence: "possible",
      claim: "Some roles carry year-only dates, so stint lengths are approximate",
      evidence: "Month precision missing on at least one role",
      companies: [],
    });
  }

  // ── RED: overlapping full-time stints ────────────────────────────
  for (let i = 0; i < chrono.length - 1; i++) {
    const a = chrono[i];
    const b = chrono[i + 1];
    if (a.end && b.start && b.start < a.end && !CONSULTANT_TITLE.test(a.title) && !CONSULTANT_TITLE.test(b.title)) {
      const overlap =
        (Number(a.end.slice(0, 4)) - Number(b.start.slice(0, 4))) * 12 +
        (Number(a.end.slice(5, 7)) - Number(b.start.slice(5, 7)));
      if (overlap >= 3) {
        flags.push({
          code: "overlapping_stints",
          polarity: "red",
          severity: "medium",
          confidence: "possible",
          claim: `${a.company} and ${b.company} overlap by ~${overlap} months`,
          evidence: `${a.company} to ${a.end}; ${b.company} from ${b.start}`,
          companies: [a.company, b.company],
        });
      }
    }
  }

  // ── GREEN: promotion velocity (the strongest profile signal) ─────
  for (const [company, rs] of byCompany) {
    if (rs.length < 2) continue;
    // Chronological first-vs-last, not max-vs-min: comparing extremes
    // scores a DEMOTION as a promotion, since it ignores direction.
    const ordered = [...rs].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const seniorityUp = titleLevel(last.title) > titleLevel(first.title);
    // Either ladder counts. Segment is the one that catches AE moves.
    const segmentUp = segmentLevel(last.title) > segmentLevel(first.title);
    if (!seniorityUp && !segmentUp) continue;
    // Moving OFF the bag is not a promotion, whatever the segment says.
    // "Enterprise AE → Enterprise Strategic Consultant" climbs the
    // segment ladder while stepping out of a quota-carrying seat, and
    // calling that advancement would flatter a sideways or downward
    // move. A genuine seniority jump still counts.
    const leftQuota =
      QUOTA_TITLE.test(first.title) &&
      !QUOTA_TITLE.test(last.title) &&
      NON_QUOTA_TITLE.test(last.title);
    if (leftQuota && !seniorityUp) continue;

    const tenure = companyTenure.get(company);
    flags.push({
      code: "promotion_velocity",
      polarity: "green",
      severity: "high",
      confidence: conf,
      claim: segmentUp && !seniorityUp
        ? `Moved up-market within ${company} — ${first.title} to ${last.title}`
        : `Promoted within ${company} — ${first.title} to ${last.title}`,
      evidence: [
        ordered.map((r) => `${r.title} (${r.start}–${r.end || "present"})`).join(" → "),
        tenure ? `${tenure.months} months at ${company} in total` : null,
        "Internal advancement is third-party validation a résumé claim can't give you.",
      ]
        .filter(Boolean)
        .join(". "),
      companies: [company],
    });
  }

  // ── GREEN: stayed and advanced at one employer ───────────────────
  // The counterweight to the hopping flag. Without it the engine can
  // only ever punish tenure patterns, never credit them.
  for (const [company, tenure] of companyTenure) {
    const rs = byCompany.get(company) || [];
    if (tenure.months < 36 || rs.length < 2) continue;
    flags.push({
      code: "long_tenure_multiple_roles",
      polarity: "green",
      severity: "medium",
      confidence: conf,
      claim: `${Math.round((tenure.months / 12) * 10) / 10} years at ${company} across ${rs.length} roles`,
      evidence: `${rs.map((r) => r.title).join(" → ")}. They were kept, moved and re-bet on by people who saw the work up close.`,
      companies: [company],
    });
  }

  // ── GREEN: academy alumni with real tenure ───────────────────────
  for (const [company, tenure] of companyTenure) {
    if (tenure.months < 18) continue;
    const org = lookupSalesOrg(company, {
      start: tenure.from,
      end: tenure.to,
      overrides: input.orgOverrides,
      roleLabel,
    });
    // creditMultiplier is where the asset's flag rules land: a
    // negative_signal or not_a_sales_signal org zeroes out, a stint
    // outside the scored era zeroes out, and a PLG/AI overlay is capped.
    // Zero credit means no green flag — the logo earned nothing.
    if (!org || !org.inWindow || org.creditMultiplier <= 0) continue;
    const years = Math.round((tenure.months / 12) * 10) / 10;
    flags.push({
      code: "academy_org_alumni",
      polarity: "green",
      // Severity tracks the asset's numeric tier rather than a
      // two-value bucket: canonical academies (1/1.5) read differently
      // from strong-but-diluted orgs (2) and contextual ones (2.5/3).
      severity:
        (org.numericTier ?? 3) <= 1.5 ? "high" : (org.numericTier ?? 3) <= 2 ? "medium" : "low",
      confidence: conf,
      claim: `${years} years at ${org.entry.name}${org.eraLabel ? ` — ${org.eraLabel}` : ""}`,
      evidence: [
        org.entry.basis,
        (byCompany.get(company) || []).map((r) => `${r.title}, ${r.start}–${r.end || "present"}`).join("; "),
        // Caveats travel WITH the credit. A PLG overlay or a
        // churn-and-burn culture changes what the logo means, and
        // hiding that behind a green chip is how a list like this
        // starts lying.
        ...org.caveats,
        org.source === "account" ? "Flagged as high-bar by your team." : null,
      ]
        .filter(Boolean)
        .join(". "),
      companies: [company],
    });
  }

  // ── GREEN: coherent sales-methodology lineage ────────────────────
  // The asset's mcmahon_lineage / meddic_culture / outbound_academy
  // markers. One is a coincidence; an unbroken chain of them is a
  // deliberately-trained operator from a single tradition.
  const lineageHits = [...companyTenure.entries()]
    .map(([company, t]) => ({
      company,
      months: t.months,
      org: lookupSalesOrg(company, { start: t.from, end: t.to, overrides: input.orgOverrides, roleLabel }),
    }))
    .filter(
      (x) =>
        x.months >= 12 &&
        x.org?.inWindow &&
        (x.org?.creditMultiplier ?? 0) > 0 &&
        x.org.signalFlags.some((f) =>
          ["mcmahon_lineage", "meddic_culture", "outbound_academy"].includes(f)
        )
    );
  if (lineageHits.length >= 2) {
    flags.push({
      code: "methodology_lineage",
      polarity: "green",
      severity: "high",
      confidence: conf,
      claim: `Trained inside a coherent sales methodology across ${lineageHits.length} orgs`,
      evidence: `${lineageHits
        .map((x) => `${x.org?.entry.name} (${x.org?.signalFlags.filter((f) => ["mcmahon_lineage", "meddic_culture", "outbound_academy"].includes(f)).join(", ")})`)
        .join("; ")}. A chain of these logos in the right eras indicates deliberate training in one tradition — MEDDIC / Command of the Message — rather than picked-up habits.`,
      companies: lineageHits.map((x) => x.company),
    });
  }

  // ── GREEN: background / grit signals (never red — see the note on
  // CandidateBackground for why absence must stay unscored) ─────────
  flags.push(
    ...backgroundFlags(input.background, conf, timeline.map((r) => r.title), input.schoolOverrides)
  );

  // ── GREEN: healthy tenure cadence ────────────────────────────────
  const salesStints = sales.map((r) => r.months).filter((m): m is number => m != null);
  if (salesStints.length >= 2) {
    const median = [...salesStints].sort((a, b) => a - b)[Math.floor(salesStints.length / 2)];
    if (median >= 30) {
      flags.push({
        code: "healthy_tenure_cadence",
        polarity: "green",
        severity: "medium",
        confidence: conf,
        claim: `Median sales stint of ${median} months — long enough to ramp and deliver full quota years`,
        evidence: sales.map((r) => `${r.company} ${r.months}mo`).join("; "),
        companies: sales.map((r) => r.company),
      });
    }
  }

  // ── GREEN: early at a company that then scaled ───────────────────
  for (const r of dated) {
    const read = reads.find((x) => x.company === r.company);
    if (!read) continue;
    const joinedEarly = /pre-seed|seed|series a/i.test(read.stageAtStart || "");
    const grew = /series c|series d|public/i.test(read.stageAtEnd || "");
    if (joinedEarly && grew && (r.months as number) >= 24) {
      flags.push({
        code: "early_at_a_winner",
        polarity: "green",
        severity: "medium",
        confidence: read.confidence === "low" ? "possible" : conf,
        claim: `Joined ${r.company} at ${read.stageAtStart} and stayed through ${read.stageAtEnd}`,
        evidence: `${r.months} months; ${read.basis || "stage read"}`,
        companies: [r.company],
      });
    }
  }

  return flags;
}

/**
 * Green-only bonus signals from education and activities.
 *
 * Every one of these is additive. There is no path in this function
 * that returns a red flag or a penalty, which is the property that lets
 * us read background at all without it becoming a screen.
 *
 * Each flag quotes the résumé text it fired on, so the founder can see
 * exactly what triggered it rather than trusting a keyword match they
 * can't inspect.
 */
function backgroundFlags(
  bg: CandidateBackground | undefined,
  conf: FlagConfidence,
  roleTitles: string[] = [],
  schoolOverrides: SchoolOverride[] = []
): Flag[] {
  if (!bg && roleTitles.length === 0) return [];
  const out: Flag[] = [];
  const majors = (bg?.majors || []).filter(Boolean);
  const distinctions = (bg?.distinctions || []).filter(Boolean);
  /**
   * A professional playing career or a military tour is usually listed
   * as EMPLOYMENT, not as an activity, so those two checks scan job
   * titles as well. Titles only, never company names — "Olympic Steel"
   * as an employer would otherwise read as an Olympian.
   */
  const careerLines = [...distinctions, ...roleTitles.filter(Boolean)];

  const firstMatch = (re: RegExp, hay: string[]): string | null =>
    hay.find((h) => re.test(h)) || null;

  const technical = firstMatch(TECHNICAL_MAJOR, majors);
  const businessQuant = firstMatch(BUSINESS_QUANT_MAJOR, majors);
  const quant = technical || businessQuant;
  if (quant) {
    out.push({
      code: "quantitative_major",
      polarity: "green",
      severity: "low",
      // Never better than "possible": a field of study is a weak proxy
      // for how someone actually runs a deal.
      confidence: "possible",
      claim: technical
        ? `Technical field of study — ${technical}`
        : `Quantitative field of study — ${businessQuant}`,
      evidence: technical
        ? `Studied ${technical}. Can likely hold a technical conversation with a buyer's engineers without an SE in the room — which matters most where there is no SE. Weak evidence on its own.`
        : `Studied ${businessQuant}. Numerate enough to build a business case and defend an ROI model. Weak evidence on its own.`,
      companies: [],
    });
  }

  const persuasion = firstMatch(PERSUASION_MAJOR, majors);
  if (persuasion && !quant) {
    out.push({
      code: "persuasion_major",
      polarity: "green",
      severity: "low",
      confidence: "possible",
      claim: `Argument-heavy field of study — ${persuasion}`,
      evidence: `Studied ${persuasion}. Structured argument under pressure is the transferable part.`,
      companies: [],
    });
  }

  // Pro first, and it SUPPRESSES the collegiate flag — a pro career
  // almost always came with a college one, and firing both would
  // double-count a single fact and pad the green column.
  const pro = firstMatch(PRO_ATHLETICS, careerLines);
  const athletics = firstMatch(ATHLETICS, distinctions);
  if (pro) {
    out.push({
      code: "professional_athletics",
      polarity: "green",
      // The strongest background signal in the set. Very few people
      // clear this bar, and what it selects for — performing against a
      // public number under continuous re-evaluation — is the job.
      severity: "high",
      confidence: conf,
      claim: "Competed at the professional level",
      evidence: `"${pro}"${athletics ? ` (also: "${athletics}")` : ""}. A selection funnel far narrower than a varsity roster, then a job re-evaluated on measured performance continuously and in public — the closest thing to carrying a quota that exists outside sales.`,
      companies: [],
    });
  } else if (athletics) {
    out.push({
      code: "competitive_athletics",
      polarity: "green",
      severity: "medium",
      confidence: conf,
      claim: "Competed in organized athletics",
      evidence: `"${athletics}". Sustained coachability, performance against a scoreboard, and voluntary exposure to being cut.`,
      companies: [],
    });
  }

  const program = firstMatch(SUSTAINED_PROGRAM, distinctions);
  if (program) {
    out.push({
      code: "sustained_achievement_program",
      polarity: "green",
      severity: "medium",
      confidence: conf,
      claim: "Carried a multi-year achievement program to its terminal rank",
      evidence: `"${program}". Years of self-directed work toward a distant goal — the closest civilian analogue to working a long sales cycle.`,
      companies: [],
    });
  }

  const military = firstMatch(MILITARY, careerLines);
  if (military) {
    out.push({
      code: "military_service",
      polarity: "green",
      severity: "medium",
      confidence: conf,
      claim: "Military service",
      evidence: `"${military}". Performance under structure and pressure, and a well-evidenced track record in sales roles.`,
      companies: [],
    });
  }

  const worked = firstMatch(WORKED_THROUGH_SCHOOL, distinctions);
  if (worked) {
    out.push({
      code: "worked_through_school",
      polarity: "green",
      // Rated above the prestige signals deliberately. This is earned
      // rather than inherited, and it's the one background signal that
      // corrects for advantage instead of compounding it.
      severity: "high",
      confidence: conf,
      claim: "Funded their own education while studying",
      evidence: `"${worked}". Self-direction and work ethic demonstrated rather than asserted.`,
      companies: [],
    });
  }

  // ── Selective school ─────────────────────────────────────────────
  // Domain-matched via PDL where possible; raw-name matching is lossy
  // enough that it drops to "possible" confidence.
  const candidates: Array<{ name: string; domain: string | null }> =
    bg?.resolvedSchools?.length
      ? bg.resolvedSchools
      : (bg?.schools || []).map((s) => ({ name: s, domain: null }));
  let best: ReturnType<typeof lookupSchool> = null;
  for (const c of candidates) {
    const m = lookupSchool(c.name, c.domain, schoolOverrides);
    if (m && (!best || (m.tier === "elite" && best.tier !== "elite"))) best = m;
  }
  if (best) {
    out.push({
      code: "selective_school",
      polarity: "green",
      // Tiered to match the sales-org registry: an elite admit bar and
      // a merely competitive one are different claims, and flattening
      // them makes the strong ones look overstated.
      severity: best.tier === "elite" ? "high" : "medium",
      confidence: best.viaDomain ? conf : "possible",
      claim: `${best.tier === "elite" ? "Highly selective" : "Selective"} school — ${best.name}`,
      evidence: [
        `Attended ${best.name}.`,
        best.tier === "elite"
          ? "Clearing a single-digit admit bar is a hard, independently-verified selection event — the same kind of third-party filter that makes academy-org tenure worth crediting."
          : "A competitive admit bar, cleared against a large applicant pool.",
        best.viaDomain ? "Matched on canonical domain." : "Matched on name only — verify.",
        best.source === "account" ? "On your team's list of schools that matter." : null,
      ]
        .filter(Boolean)
        .join(" "),
      companies: [],
    });
  }

  const honors = firstMatch(ACADEMIC_HONORS, distinctions);
  if (honors) {
    out.push({
      code: "academic_distinction",
      polarity: "green",
      severity: "low",
      confidence: conf,
      claim: "Earned academic distinction",
      evidence: `"${honors}". Distinction earned within a program, which travels better than the name of the school.`,
      companies: [],
    });
  }

  const salesComp = firstMatch(SALES_COMPETITION, distinctions);
  if (salesComp) {
    out.push({
      code: "sales_competition_honors",
      polarity: "green",
      severity: "medium",
      // Self-reported and unverifiable from a résumé — the report must
      // not let it read as established.
      confidence: "possible",
      claim: "Claims top-percentile sales recognition",
      evidence: `"${salesComp}". UNVERIFIED — a résumé claim. Worth backchanneling rather than believing.`,
      companies: [],
    });
  }

  return out;
}

/** Split for rendering: live flags vs the "considered but discounted" section. */
export function partitionFlags(flags: Flag[]): { active: Flag[]; discounted: Flag[] } {
  return {
    active: flags.filter((f) => !f.suppressedBy),
    discounted: flags.filter((f) => !!f.suppressedBy),
  };
}
