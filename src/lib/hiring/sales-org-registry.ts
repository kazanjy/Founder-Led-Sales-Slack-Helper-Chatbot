/**
 * The well-regarded sales organization registry.
 *
 * These are orgs that select hard, train hard and cut fast, so having
 * survived and progressed inside one is third-party validation you
 * cannot get from a résumé claim. It is the single highest-leverage
 * proprietary asset in the assessment product: everything else in the
 * flag engine is arithmetic anyone could reimplement, whereas knowing
 * that a given company's 2011 sales floor was a genuine academy is
 * accumulated judgment.
 *
 * TWO THINGS MAKE THIS HARDER THAN A FLAT LIST.
 *
 * 1. ERA. Reputation has a window. Xerox's sales training was the
 *    industry's finishing school for decades and is not that today.
 *    Salesforce in 2008 was a machine that minted enterprise reps;
 *    Salesforce in 2024 is a large company where the answer depends
 *    entirely on which org you sat in. A registry without date windows
 *    will systematically over-credit recent hires at faded names and
 *    under-credit people who were somewhere great at the right time.
 *
 * 2. LOCALITY. The most valuable entries are the ones we would never
 *    guess — the regional payroll company everyone in that city knows
 *    trains ferociously, the vertical SaaS leader in a niche. Those
 *    come from the founder, not from us, which is why account-level
 *    overrides are a first-class input rather than an afterthought.
 *
 * See candidate-assessment-plan.md for the population strategy.
 */

export type OrgTier = "elite" | "strong";

export interface SalesOrgEntry {
  /** Canonical name, lowercase. */
  name: string;
  /** Other spellings we might see on a résumé. */
  aliases?: string[];
  tier: OrgTier;
  /**
   * When this org was genuinely a training ground. `to: null` means
   * "still is". Omit the window entirely only when the reputation is
   * era-independent.
   */
  window?: { from: string; to: string | null };
  /** Why it's here — surfaced in the flag evidence, so it must be specific. */
  basis: string;
}

/**
 * SEED LIST. Deliberately conservative: a wrong entry here silently
 * inflates a candidate, which is worse than a missing entry that merely
 * fails to credit one. Everything here should be defensible to a
 * skeptical sales leader in one sentence.
 */
export const SALES_ORG_REGISTRY: SalesOrgEntry[] = [
  // ── The classical training grounds ────────────────────────────────
  {
    name: "xerox",
    tier: "elite",
    window: { from: "1970-01", to: "2005-12" },
    basis: "the original structured B2B sales curriculum; its alumni built most of what followed",
  },
  {
    name: "adp",
    tier: "elite",
    basis: "high-volume territory selling with relentless activity discipline; perennial rep factory",
  },
  {
    name: "paychex",
    tier: "strong",
    basis: "same transactional territory model as ADP, same reputation for cutting fast",
  },
  {
    name: "cintas",
    tier: "strong",
    basis: "door-to-door route selling; famous for washing out anyone who won't prospect",
  },
  {
    name: "oracle",
    tier: "elite",
    window: { from: "1990-01", to: "2015-12" },
    basis: "the enterprise sales bootcamp of its era; brutal quota culture, heavy formal training",
  },
  {
    name: "ibm",
    tier: "strong",
    window: { from: "1970-01", to: "2010-12" },
    basis: "structured enterprise sales education and a genuine up-or-out ladder",
  },
  {
    name: "stryker",
    tier: "elite",
    basis: "medical device selling; among the most competitive and highest-accountability sales floors anywhere",
  },
  {
    name: "adobe",
    tier: "strong",
    window: { from: "2012-01", to: null },
    basis: "ran a disciplined enterprise motion through the Creative Cloud transition",
  },

  // ── Modern SaaS academies ────────────────────────────────────────
  {
    name: "salesforce",
    tier: "elite",
    window: { from: "2004-01", to: "2018-12" },
    basis: "defined modern SaaS enterprise selling; the era when its floor was a genuine academy",
  },
  {
    name: "workday",
    tier: "elite",
    window: { from: "2010-01", to: null },
    basis: "long-cycle enterprise deals with rigorous deal inspection",
  },
  {
    name: "datadog",
    tier: "elite",
    window: { from: "2016-01", to: null },
    basis: "high-bar hiring and one of the strongest efficiency records in enterprise SaaS",
  },
  {
    name: "snowflake",
    tier: "elite",
    window: { from: "2017-01", to: null },
    basis: "consumption-model enterprise selling under exceptionally aggressive quotas",
  },
  {
    name: "mongodb",
    tier: "strong",
    window: { from: "2016-01", to: null },
    basis: "technical enterprise selling to developers; strong formal enablement",
  },
  {
    name: "gong",
    tier: "strong",
    window: { from: "2018-01", to: null },
    basis: "sells to sales leaders, so its own motion is held to an unusually public standard",
  },
  { name: "hubspot", tier: "strong", window: { from: "2010-01", to: null }, basis: "built the modern inbound/velocity sales playbook and trains it explicitly" },
  { name: "procore", tier: "strong", window: { from: "2016-01", to: null }, basis: "vertical SaaS selling into a hard, low-tech buyer" },
  { name: "toast", tier: "strong", window: { from: "2017-01", to: null }, basis: "field sales into restaurants; genuinely difficult territory work" },
  { name: "samsara", tier: "strong", window: { from: "2018-01", to: null }, basis: "high-velocity field sales into non-technical operators" },
  { name: "rippling", tier: "strong", window: { from: "2020-01", to: null }, basis: "notoriously high activity bar and fast performance culture" },
  { name: "stripe", tier: "strong", window: { from: "2016-01", to: null }, basis: "technical enterprise selling with an exceptionally high hiring bar" },
  { name: "databricks", tier: "elite", window: { from: "2018-01", to: null }, basis: "complex technical enterprise sales at very large deal sizes" },
  { name: "klaviyo", tier: "strong", window: { from: "2018-01", to: null }, basis: "high-volume commercial selling with strong ramp discipline" },
  { name: "braze", tier: "strong", window: { from: "2017-01", to: null }, basis: "enterprise martech selling with rigorous deal qualification" },
  { name: "zoominfo", tier: "strong", window: { from: "2017-01", to: null }, basis: "extremely high activity expectations; a well-known rep proving ground" },
  { name: "outreach", tier: "strong", window: { from: "2017-01", to: null }, basis: "sells sales execution, and runs its own to match" },
  { name: "segment", tier: "strong", window: { from: "2016-01", to: "2021-12" }, basis: "technical selling to engineering buyers pre-Twilio" },
];

/** Normalizes for matching: lowercase, strip suffixes and punctuation. */
function normalize(company: string): string {
  return company
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|technologies|software|group|holdings)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Per-account additions. The founder knows their market better than a
 * seed list does — a regional org with a fearsome reputation is exactly
 * the entry we'd never guess and they'd never doubt.
 */
export interface OrgOverride {
  name: string;
  tier?: OrgTier;
  basis?: string;
}

export interface SalesOrgMatch {
  entry: SalesOrgEntry;
  /**
   * False when the tenure fell outside the org's window. The caller
   * still gets the match so it can say "Oracle, but in 2021, well after
   * the era that made its name" instead of silently crediting nothing.
   */
  inWindow: boolean;
  source: "registry" | "account";
}

/**
 * Look up a company, optionally against a tenure window.
 *
 * Matching is deliberately strict — token-boundary, not substring. A
 * naive `includes` match reads "Oracle Red Bull Racing" as Oracle and
 * "Xerox Business Solutions of the Southeast" (a franchised dealer) as
 * Xerox proper, both of which silently inflate a candidate.
 */
export function lookupSalesOrg(
  company: string,
  opts: { start?: string | null; end?: string | null; overrides?: OrgOverride[] } = {}
): SalesOrgMatch | null {
  const c = normalize(company);
  if (!c) return null;

  for (const o of opts.overrides || []) {
    if (normalize(o.name) === c) {
      return {
        entry: {
          name: o.name,
          tier: o.tier || "strong",
          basis: o.basis || "flagged as a high-bar org by your team",
        },
        inWindow: true,
        source: "account",
      };
    }
  }

  const entry = SALES_ORG_REGISTRY.find(
    (e) => [e.name, ...(e.aliases || [])].some((n) => normalize(n) === c)
  );
  if (!entry) return null;

  let inWindow = true;
  if (entry.window) {
    // Overlap test, not containment: someone who joined inside the
    // window and stayed past it still trained inside it.
    const tenureStart = opts.start || "1900-01";
    const tenureEnd = opts.end || "2999-12";
    const windowEnd = entry.window.to || "2999-12";
    inWindow = tenureStart <= windowEnd && tenureEnd >= entry.window.from;
  }
  return { entry, inWindow, source: "registry" };
}

/** Human phrasing for a window, used in flag evidence. */
export function windowLabel(entry: SalesOrgEntry): string {
  if (!entry.window) return "";
  const to = entry.window.to ? entry.window.to.slice(0, 4) : "present";
  return `${entry.window.from.slice(0, 4)}–${to}`;
}
