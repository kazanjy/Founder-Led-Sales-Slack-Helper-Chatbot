import whitelist from "./data/elite-sales-orgs.v1.json";

/**
 * The well-regarded sales organization registry.
 *
 * Backed by the Elite Sales Organization Whitelist v1 (see
 * ./data/elite-sales-orgs.README.md) — 136 org records spanning 1930 to
 * present, with per-era tiers, signal flags, alumni lineages, alias and
 * acquisition normalization, and credit rules. This replaced a 26-entry
 * hand-seeded list; the asset is a versioned data product and should be
 * updated by dropping in a new JSON, never by editing entries here.
 *
 * THE TWO IDEAS THAT MAKE IT WORK, both taken from the asset's own
 * core_principles and both easy to get wrong:
 *
 * 1. **The logo is not the signal — the logo plus the ERA is.** Oracle
 *    1994 and Oracle 2016 are different companies for talent
 *    assessment. Every lookup resolves the era the candidate actually
 *    overlapped, and a stint entirely after an `era_bounded` window
 *    earns nothing. Scoring someone for a brand's best decade when they
 *    arrived a decade later is the single most common way a list like
 *    this misleads.
 *
 * 2. **Membership is a prior, not a verdict — and absence is NEUTRAL.**
 *    Not being on the list is never a penalty. The asset caps the
 *    org-era contribution at ~15% of an AE's score precisely so a logo
 *    can never clear a bar by itself.
 *
 * Everything here is deterministic and pure, in keeping with the rest
 * of the flag engine: same résumé in, same tier out.
 */

// ── Asset shapes (the JSON is untyped on disk) ──────────────────────

interface RawEra {
  start: number;
  end: number | null;
  tier: number;
  label?: string;
  rationale?: string;
  peak_window?: string | null;
  caveats?: string[];
  trend?: string;
}

interface RawOrg {
  id: string;
  name: string;
  category?: string;
  sector?: string;
  primary_motion?: string;
  aliases?: string[];
  signal_flags?: string[];
  eras: RawEra[];
  role_tier_overrides?: Record<string, number>;
  alumni_to?: string[];
  resume_guidance?: string;
}

interface RawAliasMapping {
  resume_string_examples: string[];
  map_to: string | null;
  rule?: string;
}

const ORGS = whitelist.organizations as unknown as RawOrg[];
const ALIAS_MAPPINGS = whitelist.acquisition_and_alias_mappings as unknown as RawAliasMapping[];
const TIER_CREDIT = (
  whitelist.application_logic as unknown as {
    tier_base_credit_suggestion: { by_tier: Record<string, number> };
  }
).tier_base_credit_suggestion.by_tier;

/** Public tier vocabulary, derived from the asset's numeric scale. */
export type OrgTier = "elite" | "strong";

export interface SalesOrgEntry {
  name: string;
  tier: OrgTier;
  basis: string;
}

// ── Name normalization and the lookup index ─────────────────────────

function normalize(company: string): string {
  return company
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\((.*?)\)/g, " $1 ")
    .replace(
      /\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology|software|group|holdings|systems)\b/g,
      ""
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * resume-string → org id. Built once at module load from three
 * sources, in the asset's own precedence order: canonical names,
 * declared aliases, then the acquisition/alias mapping table.
 */
const NAME_INDEX = new Map<string, string>();
/**
 * Strings that deliberately resolve to NOTHING — Zenefits, Meraki,
 * Slack. The asset calls these "lineage-only": they carry alumni
 * pedigree but award zero org credit, and silently treating them as a
 * miss would lose the distinction.
 */
const LINEAGE_ONLY = new Set<string>();

for (const org of ORGS) {
  NAME_INDEX.set(normalize(org.name), org.id);
  NAME_INDEX.set(normalize(org.id), org.id);
  for (const a of org.aliases || []) NAME_INDEX.set(normalize(a), org.id);
}
for (const m of ALIAS_MAPPINGS) {
  for (const s of m.resume_string_examples || []) {
    const key = normalize(s);
    if (!key || key === "general rule") continue;
    if (m.map_to === null) LINEAGE_ONLY.add(key);
    // Canonical names win over mapping-table entries.
    else if (!NAME_INDEX.has(key)) NAME_INDEX.set(key, m.map_to);
  }
}

const ORG_BY_ID = new Map(ORGS.map((o) => [o.id, o]));

// ── Era resolution ──────────────────────────────────────────────────

function yearOf(ym: string | null | undefined): number | null {
  if (!ym) return null;
  const n = Number(String(ym).slice(0, 4));
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick the era the candidate actually overlapped, preferring the
 * strongest (lowest-numbered tier) among overlapping windows. Overlap,
 * not containment: someone who joined inside an elite window and stayed
 * past it still trained inside it.
 */
function resolveEra(
  org: RawOrg,
  start: string | null | undefined,
  end: string | null | undefined
): { era: RawEra | null; overlapped: boolean } {
  if (org.eras.length === 0) return { era: null, overlapped: false };
  const s = yearOf(start) ?? 1900;
  const e = yearOf(end) ?? new Date().getUTCFullYear();
  const overlapping = org.eras.filter((era) => {
    const eraEnd = era.end ?? 9999;
    return s <= eraEnd && e >= era.start;
  });
  if (overlapping.length === 0) {
    // No overlap: return the best era for context, flagged as missed,
    // so callers can say "Oracle, but well after the era that made its
    // name" instead of silently crediting or silently dropping it.
    const best = [...org.eras].sort((a, b) => a.tier - b.tier)[0];
    return { era: best, overlapped: false };
  }
  return {
    era: [...overlapping].sort((a, b) => a.tier - b.tier)[0],
    overlapped: true,
  };
}

// ── Signal flag rules (asset §5 / application_logic step 5) ─────────

/** Flags that zero out org credit entirely. */
const ZERO_CREDIT_FLAGS = new Set(["negative_signal", "not_a_sales_signal"]);
/**
 * Flags that cap credit at Tier 2 unless the résumé shows self-sourced
 * pipeline. A PLG or AI-demand-capture seat can mean the rep harvested
 * inbound rather than built anything, and the logo shouldn't paper over
 * that.
 */
const CAP_AT_TIER_2_FLAGS = new Set(["plg_overlay", "ai_demand_capture", "demand_capture_era"]);
const TOO_NEW_FLAG = "too_new";

// ── Account overrides ───────────────────────────────────────────────

export interface OrgOverride {
  name: string;
  tier?: OrgTier;
  basis?: string;
}

export interface SalesOrgMatch {
  entry: SalesOrgEntry;
  /** True when the tenure overlapped a scored era. */
  inWindow: boolean;
  source: "registry" | "account";
  /** The asset's numeric tier for the resolved era (1 … 3). */
  numericTier: number | null;
  /** Fraction of org credit after flag rules — 0 kills the flag. */
  creditMultiplier: number;
  signalFlags: string[];
  /** Things the report must say out loud alongside the credit. */
  caveats: string[];
  /** Era label + years, for the claim line. */
  eraLabel: string | null;
  /** Alumni pedigree with zero credit (Zenefits, Meraki, Slack). */
  lineageOnly: boolean;
}

function tierWord(numericTier: number): OrgTier {
  // 1 and 1.5 are the asset's canonical/elite band; 2 and below are
  // "strong professional org" and downward.
  return numericTier <= 1.5 ? "elite" : "strong";
}

/**
 * Resolve a company (and the years worked there) to a scored match.
 * Returns null when the company simply isn't on the list — which the
 * asset defines as NEUTRAL, never a penalty.
 */
export function lookupSalesOrg(
  company: string,
  opts: {
    start?: string | null;
    end?: string | null;
    overrides?: OrgOverride[];
    /** "AE" | "VP" | … — selects role_tier_overrides where present. */
    roleLabel?: string;
  } = {}
): SalesOrgMatch | null {
  const key = normalize(company);
  if (!key) return null;

  for (const o of opts.overrides || []) {
    if (normalize(o.name) === key) {
      const tier = o.tier || "strong";
      return {
        entry: { name: o.name, tier, basis: o.basis || "flagged as a high-bar org by your team" },
        inWindow: true,
        source: "account",
        numericTier: tier === "elite" ? 1 : 2,
        creditMultiplier: tier === "elite" ? 1 : 0.8,
        signalFlags: [],
        caveats: [],
        eraLabel: null,
        lineageOnly: false,
      };
    }
  }

  if (LINEAGE_ONLY.has(key)) {
    return {
      entry: {
        name: company,
        tier: "strong",
        basis: "alumni pedigree only — the asset awards no org credit for this logo",
      },
      inWindow: false,
      source: "registry",
      numericTier: null,
      creditMultiplier: 0,
      signalFlags: ["lineage_only"],
      caveats: ["Carries alumni-network pedigree but is not scored as a sales academy."],
      eraLabel: null,
      lineageOnly: true,
    };
  }

  const orgId = NAME_INDEX.get(key);
  if (!orgId) return null;
  const org = ORG_BY_ID.get(orgId);
  if (!org) return null;

  const { era, overlapped } = resolveEra(org, opts.start, opts.end);
  if (!era) return null;

  const flags = org.signal_flags || [];
  const caveats: string[] = [...(era.caveats || [])];

  // role_tier_overrides can only IMPROVE the tier, and only on an
  // explicit role match — e.g. Figma is Tier 1 for sales leadership but
  // Tier 2 for a line AE.
  let numericTier = era.tier;
  const roleKey = (opts.roleLabel || "").toLowerCase();
  for (const [k, v] of Object.entries(org.role_tier_overrides || {})) {
    if (roleKey && k.toLowerCase().includes(roleKey) && v < numericTier) numericTier = v;
  }

  let creditMultiplier = TIER_CREDIT[String(numericTier)] ?? 0;

  if (!overlapped) {
    // Tenure fell outside every scored era. The asset's era_bounded
    // rule: heavily discount, don't credit the brand's best decade to
    // someone who arrived after it.
    creditMultiplier = 0;
    caveats.push(
      `Tenure falls outside ${org.name}'s scored era${era.label ? ` (${era.label})` : ""} — the logo alone earns nothing here.`
    );
  }
  if (flags.some((f) => ZERO_CREDIT_FLAGS.has(f))) {
    creditMultiplier = 0;
    caveats.push(
      flags.includes("negative_signal")
        ? "The asset marks this org as adverse evidence for sales-skill assessment despite its brand — probe rather than credit."
        : "Revenue here came from concentrated or non-repeatable dynamics, so it is not a sales-machine signal."
    );
  }
  if (flags.some((f) => CAP_AT_TIER_2_FLAGS.has(f)) && numericTier < 2) {
    numericTier = 2;
    creditMultiplier = Math.min(creditMultiplier, TIER_CREDIT["2"]);
    caveats.push(
      "Sales here overlays heavy inbound/expansion demand — resolve upward only with evidence of self-sourced pipeline (≥30-40%) or net-new logos."
    );
  }
  if (flags.includes(TOO_NEW_FLAG)) {
    creditMultiplier = Math.min(creditMultiplier, 0.5);
    caveats.push("Too new to have proven itself as an academy — credit is capped pending reassessment.");
  }
  if (flags.includes("toxic_but_successful")) {
    caveats.push(
      "Churn-and-burn culture is documented here; weight the candidate's own quota evidence and probe what they actually controlled."
    );
  }
  if (flags.includes("thin_data_provisional")) {
    caveats.push("Tiered on thin independent data — validate before weighting heavily.");
  }

  // Some records carry an open start (era begins "whenever the company
  // did"), so don't print a literal "null–present".
  const years =
    era.start != null ? `${era.start}–${era.end ?? "present"}` : `through ${era.end ?? "present"}`;
  return {
    entry: {
      name: org.name,
      tier: tierWord(numericTier),
      basis: era.rationale || org.resume_guidance || `${org.name}, ${era.label || "scored era"}`,
    },
    // Strictly "did the tenure overlap a scored era". Whether it EARNED
    // anything is creditMultiplier, and callers must check both: an org
    // can overlap its era and still score zero (negative_signal), which
    // is a different fact from having arrived after the era ended.
    inWindow: overlapped,
    source: "registry",
    numericTier,
    creditMultiplier,
    signalFlags: flags,
    caveats,
    eraLabel: era.label ? `${era.label}, ${years}` : years,
    lineageOnly: false,
  };
}

/** Human phrasing for the resolved era, used in flag evidence. */
export function windowLabel(entry: SalesOrgEntry | SalesOrgMatch): string {
  return "eraLabel" in entry ? entry.eraLabel || "" : "";
}

/** Counts for the settings UI and for telling the founder what backs this. */
export const REGISTRY_STATS = {
  version: (whitelist.meta as unknown as { version: string }).version,
  organizations: ORGS.length,
  eras: ORGS.reduce((n, o) => n + o.eras.length, 0),
  aliasMappings: ALIAS_MAPPINGS.length,
};
