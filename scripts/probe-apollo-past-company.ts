/**
 * Does Apollo's People Search API support filtering by PAST employer?
 *
 * ANSWER: yes — person_past_organization_ids.
 *
 * Apollo's search UI emits personPastOrganizationIds[] in its URL, and
 * the same URL carries personTitles[], whose REST spelling we already
 * use successfully as person_titles. The camelCase-to-snake_case
 * transform is therefore confirmed within one observed URL. This script
 * survives as the runtime check, since a UI parameter is evidence about
 * the public API, not proof.
 *
 * For the record on what does NOT work: searching HubSpot AEs by
 * organization_ids and by q_organization_domains_list both return
 * exactly 1,430 — identical, and far too few to include thousands of
 * ex-HubSpot AEs. Both are current-employer-only. The docs line about a
 * domain matching "the current employer or a previous employer"
 * describes the Enrichment endpoint's person-disambiguation, not search.
 *
 * Run:  APOLLO_API_KEY=... npx tsx scripts/probe-apollo-past-company.ts
 *
 * THE FAILURE MODE THIS IS BUILT AROUND: an unknown parameter that
 * Apollo silently ignores. That returns a 200 with a huge unfiltered
 * count, which is easy to mistake for "it worked, there are lots of
 * alumni". So every candidate is judged against TWO baselines:
 *
 *   current  — organization_ids on the target company (alumni excluded)
 *   universe — no company constraint at all (nothing excluded)
 *
 * A parameter only works if its count lands meaningfully ABOVE current
 * and well BELOW universe. Equal to current means it filtered on the
 * current employer. Equal to universe means it was ignored.
 *
 * Costs one search credit per probe (~10 total). Read-only.
 */

const API_KEY = process.env.APOLLO_API_KEY;
const ENDPOINT = "https://api.apollo.io/api/v1/mixed_people/search";

// HubSpot: huge, and its alumni vastly outnumber its current AEs, so the
// signal is unmissable if past-company filtering is actually applied.
const ORG_ID = "5f49cce978959f0001c33e5c";
const ORG_DOMAIN = "hubspot.com";
const TITLES = ["account executive"];

/** Parameter shapes worth trying, newest-looking naming first. */
const CANDIDATES: Array<{ label: string; body: Record<string, unknown> }> = [
  { label: "person_past_organization_ids", body: { person_past_organization_ids: [ORG_ID] } },
  { label: "past_organization_ids", body: { past_organization_ids: [ORG_ID] } },
  { label: "organization_past_ids", body: { organization_past_ids: [ORG_ID] } },
  { label: "person_past_organization_names", body: { person_past_organization_names: ["HubSpot"] } },
  { label: "q_organization_past_domains_list", body: { q_organization_past_domains_list: [ORG_DOMAIN] } },
  // Flag-style variants: the UI reads like a modifier ON the company
  // filter rather than a separate field, so try it that way too.
  { label: "organization_ids + include_past_company", body: { organization_ids: [ORG_ID], include_past_company: true } },
  { label: "organization_ids + include_past_organizations", body: { organization_ids: [ORG_ID], include_past_organizations: true } },
  { label: "organization_ids + person_past_organization", body: { organization_ids: [ORG_ID], person_past_organization: true } },
];

async function count(body: Record<string, unknown>): Promise<number | string> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      "x-api-key": API_KEY!,
    },
    // per_page 1 — we only ever read total_entries.
    body: JSON.stringify({ person_titles: TITLES, per_page: 1, ...body }),
  });
  if (!res.ok) return `HTTP ${res.status}`;
  const json = await res.json();
  return typeof json?.total_entries === "number" ? json.total_entries : "no total_entries";
}

function verdict(n: number | string, current: number, universe: number): string {
  if (typeof n !== "number") return `ERROR (${n})`;
  if (n === current) return "NO — same as current-employee count; filtered on current employer";
  if (n >= universe * 0.9) return "NO — parameter ignored; this is the unfiltered universe";
  if (n > current) return "*** YES — more than current, far fewer than universe. This is the one. ***";
  return `inconclusive (${n} is below the current-employee count)`;
}

async function main() {
  if (!API_KEY) {
    console.error("Set APOLLO_API_KEY first.");
    process.exit(1);
  }

  const current = await count({ organization_ids: [ORG_ID] });
  const universe = await count({});
  if (typeof current !== "number" || typeof universe !== "number") {
    console.error("Baselines failed:", { current, universe });
    process.exit(1);
  }

  console.log(`\nBaselines for title(s) ${JSON.stringify(TITLES)}:`);
  console.log(`  current employees at HubSpot : ${current.toLocaleString()}`);
  console.log(`  no company constraint at all : ${universe.toLocaleString()}`);
  console.log(`\nA working past-company filter lands between these two.\n`);

  for (const c of CANDIDATES) {
    // Sequential: a burst risks a 429 that would read as "unsupported".
    const n = await count(c.body);
    console.log(`  ${c.label.padEnd(42)} ${String(typeof n === "number" ? n.toLocaleString() : n).padStart(10)}  ${verdict(n, current, universe)}`);
  }

  console.log(
    "\nIf nothing says YES, the public API does not expose it under these names.\n" +
      "Fastest way to get the real name: open Apollo's search UI, tick\n" +
      '"Include past company", and read the request payload in DevTools → Network.\n'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
