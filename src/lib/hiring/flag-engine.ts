import type { TimelineRole, CompanyRead } from "./candidate-assessment";

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

export type Severity = "high" | "medium" | "low";
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
}

// ── Role-relative configuration (PRD §5.1: role-relative scoring) ───

export interface RoleRubric {
  /** A stint under this is "short" for this seat. */
  shortStintMonths: number;
  /** How many short stints constitute a pattern. */
  serialShortStintCount: number;
  /** Months of ramp assumed when showing productive selling time. */
  rampMonths: number;
}

/**
 * Cycle length drives the bar: an 18-month enterprise cycle needs a
 * longer runway to prove anything than transactional SDR work does.
 */
export const ROLE_RUBRICS: Record<string, RoleRubric> = {
  SDR: { shortStintMonths: 12, serialShortStintCount: 3, rampMonths: 2 },
  AE: { shortStintMonths: 18, serialShortStintCount: 3, rampMonths: 4 },
  AM: { shortStintMonths: 18, serialShortStintCount: 3, rampMonths: 3 },
  CSM: { shortStintMonths: 18, serialShortStintCount: 3, rampMonths: 3 },
  Manager: { shortStintMonths: 18, serialShortStintCount: 3, rampMonths: 5 },
  VP: { shortStintMonths: 24, serialShortStintCount: 2, rampMonths: 6 },
};

export function rubricFor(roleLabel: string): RoleRubric {
  const key = Object.keys(ROLE_RUBRICS).find(
    (k) => k.toLowerCase() === (roleLabel || "AE").trim().toLowerCase()
  );
  return ROLE_RUBRICS[key || "AE"];
}

// ── Company registry (PRD §7.3 — a curated, compounding asset) ──────

/**
 * "Academy" orgs: they select hard, train hard, and cut fast, so
 * surviving and progressing there is third-party validation. Starter
 * list from the PRD; era-awareness and user extension ("treat my last
 * company as high-bar") are the obvious next iteration.
 */
export const ACADEMY_ORGS = [
  "salesforce", "oracle", "adp", "paychex", "xerox", "ibm", "cintas",
  "snowflake", "datadog", "mongodb", "gong", "procore", "toast",
  "samsara", "rippling", "workday", "hubspot", "stripe", "databricks",
  "klaviyo", "braze", "zoominfo", "outreach", "segment",
];

/**
 * Macro windows where short stints are usually the market, not the
 * person. Suppression is date-based and deliberately generous — the
 * cost of a false "job hopper" flag is a good candidate discarded.
 */
export const LAYOFF_WINDOWS: Array<{ from: string; to: string; label: string }> = [
  { from: "2020-03", to: "2020-10", label: "the COVID-era cuts" },
  { from: "2022-05", to: "2024-03", label: "the 2022-24 tech correction" },
];

function isAcademy(company: string): boolean {
  const c = company.toLowerCase();
  return ACADEMY_ORGS.some((a) => c === a || c.startsWith(`${a} `) || c.includes(` ${a}`));
}

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
  // A role they are STILL IN is not a short stint — nobody has left it.
  // Counting the current job as evidence of hopping is the single
  // easiest way to libel a candidate who simply started recently.
  const shortStints = dated.filter(
    (r) =>
      !!r.end &&
      (r.start || "") >= recentCutoff &&
      (r.months as number) < rubric.shortStintMonths
  );
  const suppressed = shortStints.filter((r) => layoffWindowFor(r.end));
  const counted = shortStints.filter((r) => !layoffWindowFor(r.end));

  if (counted.length >= rubric.serialShortStintCount) {
    flags.push({
      code: "serial_short_stints",
      polarity: "red",
      severity: "high",
      confidence: conf,
      claim: `${counted.length} stints under ${rubric.shortStintMonths} months in the last 6 years`,
      evidence: counted
        .map((r) => `${r.company} — ${r.months}mo (${r.start}–${r.end || "present"})`)
        .join("; "),
      companies: counted.map((r) => r.company),
    });
  } else if (shortStints.length >= rubric.serialShortStintCount) {
    // The pattern only exists if you ignore the market context.
    flags.push({
      code: "serial_short_stints",
      polarity: "red",
      severity: "high",
      confidence: conf,
      claim: `${shortStints.length} short stints, but ${suppressed.length} ended during a known downturn`,
      evidence: shortStints
        .map((r) => `${r.company} — ${r.months}mo, ended ${r.end || "present"}`)
        .join("; "),
      companies: shortStints.map((r) => r.company),
      suppressedBy: `${suppressed.length} of these ended in ${[
        ...new Set(suppressed.map((r) => layoffWindowFor(r.end))),
      ].join(" / ")} — below the ${rubric.serialShortStintCount}-stint bar once discounted`,
    });
  }

  // ── RED: washed out of a high-bar org ────────────────────────────
  for (const [company, tenure] of companyTenure) {
    if (!isAcademy(company) || !tenure.to || tenure.months >= 12) continue;
    const layoff = layoffWindowFor(tenure.to);
    flags.push({
      code: "short_stint_high_bar_org",
      polarity: "red",
      severity: "high",
      confidence: conf,
      claim: `${tenure.months} months at ${company}, a high-bar sales org`,
      evidence: (byCompany.get(company) || [])
        .map((r) => `${r.title}, ${r.start}–${r.end || "present"}`)
        .join("; "),
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
  const preMilestone = dated.filter(
    (r) => !!r.end && r.isSales && (r.months as number) >= 10 && (r.months as number) <= 14
  );
  if (preMilestone.length >= 2) {
    flags.push({
      code: "pre_milestone_departures",
      polarity: "red",
      severity: "low",
      confidence: conf,
      claim: `${preMilestone.length} departures at 10-14 months — just before a full quota year would show`,
      evidence: preMilestone.map((r) => `${r.company} — ${r.months}mo`).join("; "),
      companies: preMilestone.map((r) => r.company),
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
    const levels = rs.map((r) => titleLevel(r.title)).filter((l) => l > 0);
    if (levels.length >= 2 && Math.max(...levels) > Math.min(...levels)) {
      flags.push({
        code: "promotion_velocity",
        polarity: "green",
        severity: "high",
        confidence: conf,
        claim: `Promoted within ${company}`,
        evidence: rs.map((r) => `${r.title} (${r.start}–${r.end || "present"})`).join(" → "),
        companies: [company],
      });
    }
  }

  // ── GREEN: academy alumni with real tenure ───────────────────────
  for (const [company, tenure] of companyTenure) {
    if (!isAcademy(company) || tenure.months < 18) continue;
    flags.push({
      code: "academy_org_alumni",
      polarity: "green",
      severity: "high",
      confidence: conf,
      claim: `${Math.round((tenure.months / 12) * 10) / 10} years at ${company}, a high-bar sales org`,
      evidence: (byCompany.get(company) || [])
        .map((r) => `${r.title}, ${r.start}–${r.end || "present"}`)
        .join("; "),
      companies: [company],
    });
  }

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

/** Split for rendering: live flags vs the "considered but discounted" section. */
export function partitionFlags(flags: Flag[]): { active: Flag[]; discounted: Flag[] } {
  return {
    active: flags.filter((f) => !f.suppressedBy),
    discounted: flags.filter((f) => !!f.suppressedBy),
  };
}
