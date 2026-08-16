/**
 * School selectivity registry.
 *
 * Keyed on DOMAIN, not name. PDL's School Cleaner resolves "UMich",
 * "U of M" and "University of Michigan-Ann Arbor" to one record with
 * domain umich.edu, so keying on the domain sidesteps the dozen ways a
 * résumé can spell an institution. Free-text name matching is the
 * fallback for when the cleaner misses or isn't called.
 *
 * WEIGHTING. This is a heavily-weighted signal by product decision:
 * elite fires at "high" severity, selective at "medium" — the same
 * tiering as the sales-org registry. The rationale is that a
 * single-digit admit rate is a hard selection event verified by a
 * third party, which is the same reason academy-org tenure counts.
 *
 * Two properties hold regardless of the weight, and both matter:
 *
 * 1. The flag is GREEN-ONLY. It never lowers a rating, and its absence
 *    never renders. Weighting it heavily makes a strong school a real
 *    positive; it does not make an unremarkable one a negative, which
 *    is what would turn this into a screen.
 * 2. The list is account-extendable, and that matters MORE the heavier
 *    the weight. PDL has no selectivity field — /school/clean returns
 *    identity only — so these tiers are judgment, not data, and the
 *    seed list is unavoidably US-centric. A founder hiring in Munich
 *    or São Paulo has a completely different and equally valid set,
 *    and a shipped list must not silently define their bar.
 */

export type SchoolTier = "elite" | "selective";

export interface SchoolEntry {
  domain: string;
  name: string;
  tier: SchoolTier;
}

/**
 * Seed list: US institutions with sustained sub-20% admit rates, plus
 * the internationally recognizable equivalents. Short on purpose — a
 * wrong entry silently flatters a candidate forever, and a missing one
 * merely fails to credit. Extend per account rather than guessing.
 */
export const SCHOOL_REGISTRY: SchoolEntry[] = [
  // Elite — sustained single-digit / low-teens admit rates
  { domain: "harvard.edu", name: "Harvard University", tier: "elite" },
  { domain: "stanford.edu", name: "Stanford University", tier: "elite" },
  { domain: "mit.edu", name: "MIT", tier: "elite" },
  { domain: "yale.edu", name: "Yale University", tier: "elite" },
  { domain: "princeton.edu", name: "Princeton University", tier: "elite" },
  { domain: "columbia.edu", name: "Columbia University", tier: "elite" },
  { domain: "uchicago.edu", name: "University of Chicago", tier: "elite" },
  { domain: "upenn.edu", name: "University of Pennsylvania", tier: "elite" },
  { domain: "caltech.edu", name: "Caltech", tier: "elite" },
  { domain: "duke.edu", name: "Duke University", tier: "elite" },
  { domain: "brown.edu", name: "Brown University", tier: "elite" },
  { domain: "dartmouth.edu", name: "Dartmouth College", tier: "elite" },
  { domain: "cornell.edu", name: "Cornell University", tier: "elite" },
  { domain: "northwestern.edu", name: "Northwestern University", tier: "elite" },
  { domain: "jhu.edu", name: "Johns Hopkins University", tier: "elite" },
  { domain: "rice.edu", name: "Rice University", tier: "elite" },
  { domain: "vanderbilt.edu", name: "Vanderbilt University", tier: "elite" },
  { domain: "wustl.edu", name: "Washington University in St. Louis", tier: "elite" },
  { domain: "berkeley.edu", name: "UC Berkeley", tier: "elite" },
  { domain: "ucla.edu", name: "UCLA", tier: "elite" },
  { domain: "cmu.edu", name: "Carnegie Mellon University", tier: "elite" },
  { domain: "georgetown.edu", name: "Georgetown University", tier: "elite" },
  { domain: "nd.edu", name: "University of Notre Dame", tier: "elite" },
  { domain: "usc.edu", name: "University of Southern California", tier: "elite" },
  { domain: "williams.edu", name: "Williams College", tier: "elite" },
  { domain: "amherst.edu", name: "Amherst College", tier: "elite" },
  { domain: "swarthmore.edu", name: "Swarthmore College", tier: "elite" },
  { domain: "pomona.edu", name: "Pomona College", tier: "elite" },
  { domain: "bowdoin.edu", name: "Bowdoin College", tier: "elite" },
  { domain: "middlebury.edu", name: "Middlebury College", tier: "elite" },
  { domain: "usma.edu", name: "West Point", tier: "elite" },
  { domain: "usna.edu", name: "US Naval Academy", tier: "elite" },
  { domain: "usafa.edu", name: "US Air Force Academy", tier: "elite" },
  // International
  { domain: "ox.ac.uk", name: "University of Oxford", tier: "elite" },
  { domain: "cam.ac.uk", name: "University of Cambridge", tier: "elite" },
  { domain: "imperial.ac.uk", name: "Imperial College London", tier: "elite" },
  { domain: "lse.ac.uk", name: "London School of Economics", tier: "elite" },
  { domain: "ethz.ch", name: "ETH Zurich", tier: "elite" },
  { domain: "utoronto.ca", name: "University of Toronto", tier: "elite" },
  { domain: "mcgill.ca", name: "McGill University", tier: "elite" },
  { domain: "nus.edu.sg", name: "National University of Singapore", tier: "elite" },
  { domain: "tsinghua.edu.cn", name: "Tsinghua University", tier: "elite" },
  { domain: "iitb.ac.in", name: "IIT Bombay", tier: "elite" },
  { domain: "iitd.ac.in", name: "IIT Delhi", tier: "elite" },

  // Selective — strong, competitive programs a notch below
  { domain: "umich.edu", name: "University of Michigan", tier: "selective" },
  { domain: "virginia.edu", name: "University of Virginia", tier: "selective" },
  { domain: "unc.edu", name: "UNC Chapel Hill", tier: "selective" },
  { domain: "utexas.edu", name: "UT Austin", tier: "selective" },
  { domain: "gatech.edu", name: "Georgia Tech", tier: "selective" },
  { domain: "illinois.edu", name: "UIUC", tier: "selective" },
  { domain: "wisc.edu", name: "University of Wisconsin-Madison", tier: "selective" },
  { domain: "washington.edu", name: "University of Washington", tier: "selective" },
  { domain: "ufl.edu", name: "University of Florida", tier: "selective" },
  { domain: "osu.edu", name: "Ohio State University", tier: "selective" },
  { domain: "purdue.edu", name: "Purdue University", tier: "selective" },
  { domain: "psu.edu", name: "Penn State", tier: "selective" },
  { domain: "bc.edu", name: "Boston College", tier: "selective" },
  { domain: "bu.edu", name: "Boston University", tier: "selective" },
  { domain: "nyu.edu", name: "New York University", tier: "selective" },
  { domain: "tufts.edu", name: "Tufts University", tier: "selective" },
  { domain: "emory.edu", name: "Emory University", tier: "selective" },
  { domain: "wm.edu", name: "William & Mary", tier: "selective" },
  { domain: "lehigh.edu", name: "Lehigh University", tier: "selective" },
  { domain: "bucknell.edu", name: "Bucknell University", tier: "selective" },
  { domain: "colgate.edu", name: "Colgate University", tier: "selective" },
  { domain: "villanova.edu", name: "Villanova University", tier: "selective" },
  { domain: "scu.edu", name: "Santa Clara University", tier: "selective" },
  { domain: "smu.edu", name: "Southern Methodist University", tier: "selective" },
  { domain: "tcu.edu", name: "Texas Christian University", tier: "selective" },
  { domain: "indiana.edu", name: "Indiana University", tier: "selective" },
  { domain: "miamioh.edu", name: "Miami University", tier: "selective" },
  { domain: "wfu.edu", name: "Wake Forest University", tier: "selective" },
  { domain: "warwick.ac.uk", name: "University of Warwick", tier: "selective" },
  { domain: "ucl.ac.uk", name: "University College London", tier: "selective" },
  { domain: "ed.ac.uk", name: "University of Edinburgh", tier: "selective" },
  { domain: "ubc.ca", name: "University of British Columbia", tier: "selective" },
  { domain: "unimelb.edu.au", name: "University of Melbourne", tier: "selective" },
  { domain: "sydney.edu.au", name: "University of Sydney", tier: "selective" },
];

export interface SchoolOverride {
  /** Domain or name — domain matches first and is more reliable. */
  name: string;
  domain?: string;
  tier?: SchoolTier;
}

export interface SchoolMatch {
  name: string;
  tier: SchoolTier;
  source: "registry" | "account";
  /** True when matched on a PDL-resolved domain rather than raw text. */
  viaDomain: boolean;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(the|university|college|institute|school) of\b/g, "")
    .replace(/\b(university|college|institute|univ|u)\b/g, "")
    // Connectors last: "U of Michigan" loses "u" above and would
    // otherwise normalize to "of michigan", missing "michigan".
    .replace(/\b(of|at|the|and)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(d: string): string {
  return d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
}

/**
 * Resolve a school to a tier. `domain` should come from PDL's cleaner
 * when available; the name path is a lossy fallback and is marked as
 * such so the flag can carry lower confidence.
 */
export function lookupSchool(
  rawName: string,
  domain?: string | null,
  overrides: SchoolOverride[] = []
): SchoolMatch | null {
  const d = domain ? normalizeDomain(domain) : null;
  const n = normalizeName(rawName || "");
  if (!d && !n) return null;

  for (const o of overrides) {
    const od = o.domain ? normalizeDomain(o.domain) : null;
    if ((od && d && od === d) || normalizeName(o.name) === n) {
      return { name: o.name, tier: o.tier || "selective", source: "account", viaDomain: !!(od && d) };
    }
  }

  if (d) {
    // Suffix match so a subdomain (eng.umich.edu) still resolves.
    const byDomain = SCHOOL_REGISTRY.find((e) => d === e.domain || d.endsWith(`.${e.domain}`));
    if (byDomain) {
      return { name: byDomain.name, tier: byDomain.tier, source: "registry", viaDomain: true };
    }
  }
  if (n) {
    const byName = SCHOOL_REGISTRY.find((e) => normalizeName(e.name) === n);
    if (byName) return { name: byName.name, tier: byName.tier, source: "registry", viaDomain: false };
  }
  return null;
}
