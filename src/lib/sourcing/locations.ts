/**
 * Location vocabulary for the sourcing search.
 *
 * Apollo has no public location-suggest endpoint — person_locations is
 * a bare array of strings, and the typeahead in Apollo's own UI runs on
 * an internal API. So the suggestions come from this curated list
 * instead, and free text is still accepted: the list is a convenience,
 * not a constraint.
 *
 * Everything here is written the way Apollo expects it — "San
 * Francisco, CA" rather than "SF" or "San Francisco Bay Area" — because
 * a location string Apollo doesn't recognise doesn't error, it just
 * silently matches nobody.
 *
 * Weighted toward US sales hubs because that is where the hiring
 * profiles point: Helium's, for instance, names SF, NY, Austin, LA,
 * Boston and remote US.
 */

export interface LocationOption {
  /** Exactly what gets sent to Apollo. */
  value: string;
  /** Grouping for the dropdown. */
  kind: "metro" | "state" | "country";
  /** Extra terms that should match this entry while typing. */
  aliases?: string[];
}

export const LOCATION_OPTIONS: LocationOption[] = [
  // ── US metros, sales-hub first ──
  { value: "San Francisco, CA", kind: "metro", aliases: ["sf", "bay area", "silicon valley"] },
  { value: "New York, NY", kind: "metro", aliases: ["nyc", "manhattan", "brooklyn"] },
  { value: "Austin, TX", kind: "metro", aliases: ["atx"] },
  { value: "Boston, MA", kind: "metro" },
  { value: "Los Angeles, CA", kind: "metro", aliases: ["la", "socal"] },
  { value: "Chicago, IL", kind: "metro" },
  { value: "Denver, CO", kind: "metro" },
  { value: "Seattle, WA", kind: "metro" },
  { value: "Atlanta, GA", kind: "metro" },
  { value: "Salt Lake City, UT", kind: "metro", aliases: ["slc", "silicon slopes"] },
  { value: "San Diego, CA", kind: "metro" },
  { value: "Miami, FL", kind: "metro" },
  { value: "Dallas, TX", kind: "metro" },
  { value: "Nashville, TN", kind: "metro" },
  { value: "Raleigh, NC", kind: "metro", aliases: ["research triangle", "durham"] },
  { value: "Philadelphia, PA", kind: "metro", aliases: ["philly"] },
  { value: "Phoenix, AZ", kind: "metro" },
  { value: "Portland, OR", kind: "metro" },
  { value: "Minneapolis, MN", kind: "metro" },
  { value: "Washington, DC", kind: "metro", aliases: ["dc", "washington dc"] },
  { value: "Houston, TX", kind: "metro" },
  { value: "Charlotte, NC", kind: "metro" },
  { value: "Indianapolis, IN", kind: "metro" },
  { value: "Columbus, OH", kind: "metro" },
  { value: "Detroit, MI", kind: "metro" },
  { value: "Tampa, FL", kind: "metro" },
  { value: "Pittsburgh, PA", kind: "metro" },
  { value: "Kansas City, MO", kind: "metro" },

  // ── US states that come up as whole territories ──
  { value: "California", kind: "state" },
  { value: "New York", kind: "state" },
  { value: "Texas", kind: "state" },
  { value: "Massachusetts", kind: "state" },
  { value: "Colorado", kind: "state" },
  { value: "Illinois", kind: "state" },
  { value: "Florida", kind: "state" },
  { value: "Washington", kind: "state" },
  { value: "Georgia", kind: "state" },
  { value: "Utah", kind: "state" },

  // ── Countries and regions ──
  { value: "United States", kind: "country", aliases: ["usa", "us", "america", "remote us"] },
  { value: "Canada", kind: "country" },
  { value: "United Kingdom", kind: "country", aliases: ["uk", "england", "britain"] },
  { value: "London, United Kingdom", kind: "metro", aliases: ["london"] },
  { value: "Ireland", kind: "country", aliases: ["dublin"] },
  { value: "Germany", kind: "country", aliases: ["berlin", "munich"] },
  { value: "France", kind: "country", aliases: ["paris"] },
  { value: "Netherlands", kind: "country", aliases: ["amsterdam", "holland"] },
  { value: "Spain", kind: "country", aliases: ["madrid", "barcelona"] },
  { value: "Poland", kind: "country", aliases: ["warsaw", "krakow"] },
  { value: "Israel", kind: "country", aliases: ["tel aviv"] },
  { value: "India", kind: "country", aliases: ["bangalore", "bengaluru", "mumbai"] },
  { value: "Australia", kind: "country", aliases: ["sydney", "melbourne"] },
  { value: "Singapore", kind: "country" },
  { value: "Brazil", kind: "country", aliases: ["sao paulo"] },
  { value: "Mexico", kind: "country", aliases: ["mexico city", "cdmx"] },
];

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Suggestions for what has been typed so far.
 *
 * Prefix matches rank above substring ones so typing "san" offers San
 * Francisco before Salt Lake City. Anything already picked is dropped
 * from the list rather than being offered and then silently ignored.
 */
export function suggestLocations(
  query: string,
  already: string[] = [],
  limit = 8
): LocationOption[] {
  const q = norm(query);
  const taken = new Set(already.map(norm));
  const pool = LOCATION_OPTIONS.filter((o) => !taken.has(norm(o.value)));
  if (!q) return pool.slice(0, limit);

  const scored: Array<{ o: LocationOption; score: number }> = [];
  for (const o of pool) {
    const value = norm(o.value);
    const terms = [value, ...(o.aliases || []).map(norm)];
    let score = Infinity;
    for (const t of terms) {
      if (t.startsWith(q)) score = Math.min(score, 0);
      else if (t.includes(q)) score = Math.min(score, 1);
    }
    if (score !== Infinity) scored.push({ o, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.o.value.localeCompare(b.o.value))
    .slice(0, limit)
    .map((s) => s.o);
}
