/**
 * Apollo.io People Enrichment.
 *
 * The candidate assessor needs one thing from a LinkedIn URL: a dated
 * work history it can do tenure math on. PDL was doing that job only
 * because it happened to already be wired up for deal-participant
 * enrichment — Apollo is materially cheaper per match for the same
 * question, so the hiring path now asks Apollo.
 *
 * Deliberately NOT a general replacement for lib/search/pdl. The deal
 * and meeting paths enrich by EMAIL and want firmographics and funding
 * history; this module only covers LinkedIn-URL person matching for
 * hiring. Keeping the two separate means a change here can't regress
 * pre-call research.
 *
 * VERIFIED against live people/match responses (Sept 2026):
 *
 *  - employment_history carries full YYYY-MM-DD start_date/end_date, so
 *    tenure math is if anything sharper than PDL's — no year-only dates
 *    to downgrade a hopping flag to "possible".
 *  - Repeat titles at one employer arrive as SEPARATE rows (two HubSpot
 *    entries for one person), which is what the promotion detector
 *    wants and what the per-employer aggregation already handles.
 *  - Apollo returns NO EDUCATION AT ALL. No `education` array, and no
 *    degree/major/grade_level fields on employment rows. A school shows
 *    up only when the person WORKED there, which is a job.
 *
 * The education readers below are therefore dead code today, kept
 * because they cost nothing and would light up if Apollo starts
 * supplying it. Callers must not infer "no degree" from an empty
 * result — it means "not asked", and the assessment says so.
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

export interface ApolloEmploymentEntry {
  organization_name: string | null;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  current: boolean | null;
  /** Present on education rows. Apollo uses these to mark schooling. */
  degree: string | null;
  major: string | null;
  grade_level: string | null;
  kind: string | null;
}

export interface ApolloEducationEntry {
  school_name: string | null;
  degree: string | null;
  major: string | null;
}

export interface ApolloPersonResult {
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string | null;
  title: string | null;
  headline: string | null;
  organization_name: string | null;
  organization: { name: string | null; website_url: string | null } | null;
  employment_history: ApolloEmploymentEntry[];
  /** Not always present — see the shape note above. */
  education?: ApolloEducationEntry[];
}

/**
 * True when an employment_history row is really a school.
 *
 * Apollo has no single reliable discriminator, so this tests the union
 * of the markers it does use. Erring toward "education" on an ambiguous
 * row is the safer mistake: a mislabelled school entering the work
 * timeline would be scored as a job and could manufacture a tenure gap
 * or a hopping flag out of nothing.
 */
export function isEducationEntry(e: ApolloEmploymentEntry): boolean {
  if (e.kind && /school|education|university/i.test(e.kind)) return true;
  if (e.grade_level) return true;
  // A degree or major with no job title is schooling. A row with both a
  // title AND a degree is usually a job at a university, so keep it.
  if ((e.degree || e.major) && !e.title) return true;
  return false;
}

// ── Organization lookup ───────────────────────────────────────────

export interface ApolloOrg {
  id: string;
  name: string;
  domain: string | null;
}

/**
 * Resolve a company name to Apollo organization candidates.
 *
 * FREE — this endpoint consumes no credits, which is what makes
 * tier-list sourcing practical: a hiring profile naming forty companies
 * costs nothing to resolve.
 *
 * Returns candidates rather than one answer ON PURPOSE. Fuzzy matching
 * is not reliable enough to auto-pick: "Skio" ranks SKIOLD GROUP first,
 * and "Adapty" resolves as "Adapty.io". Sourcing the wrong company is
 * silent — you get a plausible list of the wrong people — so the caller
 * confirms.
 */
export async function lookupOrganizations(
  name: string,
  limit = 5
): Promise<{ orgs: ApolloOrg[]; error?: string }> {
  if (!APOLLO_API_KEY) return { orgs: [], error: "APOLLO_API_KEY not configured" };
  const q = name.trim();
  if (!q) return { orgs: [] };

  try {
    const response = await fetch(`${APOLLO_BASE_URL}/organizations/lookup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "x-api-key": APOLLO_API_KEY,
      },
      body: JSON.stringify({
        q_organization_fuzzy_name: q,
        display_mode: "fuzzy_select_mode",
        per_page: limit,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Apollo] Org lookup error ${response.status}:`, text.slice(0, 300));
      return { orgs: [], error: `Apollo API error: ${response.status}` };
    }
    const json = await response.json();
    const rows = Array.isArray(json?.organizations) ? json.organizations : [];
    return {
      orgs: rows.map((o: Record<string, unknown>) => ({
        id: String(o.id ?? ""),
        name: String(o.name ?? ""),
        domain: (o.domain as string) ?? null,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Apollo] Org lookup failed:", message);
    return { orgs: [], error: message };
  }
}

/** Normalized comparison for picking an unambiguous name match. */
function normalizeOrgName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|the)\b/g, "")
    .replace(/\.(io|com|ai|co)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Best candidate for a name, plus whether it was unambiguous.
 *
 * `confident` is true only on a normalized exact name match. Everything
 * else is handed back for a human to confirm rather than guessed at,
 * for the Skio reason above.
 */
export function pickOrg(
  name: string,
  orgs: ApolloOrg[]
): { org: ApolloOrg | null; confident: boolean } {
  if (orgs.length === 0) return { org: null, confident: false };
  const target = normalizeOrgName(name);
  const exact = orgs.filter((o) => normalizeOrgName(o.name) === target);
  if (exact.length === 1) return { org: exact[0], confident: true };
  if (exact.length > 1) return { org: exact[0], confident: false };
  return { org: orgs[0], confident: false };
}

// ── People search (sourcing) ──────────────────────────────────────

/**
 * One row of a people-search result.
 *
 * Search is deliberately thin — Apollo returns an id, a first name, a
 * MASKED surname, a title and the employer name, plus has_* booleans
 * standing in for everything it will sell you. There is no work
 * history and no LinkedIn URL, so a search result cannot be assessed:
 * it has to be enriched first. Treat these as leads, not candidates.
 */
export interface ApolloLead {
  id: string;
  firstName: string | null;
  /** e.g. "Ch***e". Resolves to a real surname only on enrichment. */
  lastNameMasked: string | null;
  title: string | null;
  organizationName: string | null;
}

export interface ApolloPeopleSearchParams {
  titles?: string[];
  /**
   * Current employer. Apollo organization ids (24 hex), from
   * /organizations/lookup — which is free, so resolving a hiring
   * profile's tier lists costs nothing.
   */
  organizationIds?: string[];
  /**
   * PAST employer — the filter that makes tier-list sourcing work.
   *
   * Current-employer filters are close to useless for the small,
   * specialist orgs a founder's "where to look" list names: Apollo
   * indexes exactly one current AE at RevenueCat. The people who left
   * are the pool. Verified current-only, for the avoidance of doubt:
   * HubSpot AEs by organizationIds and by employer domain both return
   * exactly 1,430, which cannot include thousands of alumni.
   */
  pastOrganizationIds?: string[];
  /** Where the PERSON lives, not the employer HQ. */
  personLocations?: string[];
  employeeCountRanges?: string[];
  /**
   * Total career experience. Preferred over days-in-current-title,
   * which resets on promotion and so quietly excludes people who were
   * promoted internally — a green flag in our own rubric.
   */
  totalYearsExperience?: { min?: number; max?: number };
  /** Apollo widens loose titles by default; false keeps "Enterprise AE" out. */
  includeSimilarTitles?: boolean;
  page?: number;
  perPage?: number;
}

/**
 * Search Apollo's people index.
 *
 * Consumes a search credit per call. Returns at most 100 per page and
 * caps at 50,000 records overall (500 pages).
 */
export async function searchPeople(
  params: ApolloPeopleSearchParams
): Promise<{ leads: ApolloLead[]; total: number; error?: string }> {
  if (!APOLLO_API_KEY) return { leads: [], total: 0, error: "APOLLO_API_KEY not configured" };

  const body: Record<string, unknown> = {
    page: params.page ?? 1,
    per_page: Math.min(params.perPage ?? 25, 100),
  };
  if (params.titles?.length) body.person_titles = params.titles;
  if (params.organizationIds?.length) body.organization_ids = params.organizationIds;
  if (params.pastOrganizationIds?.length) {
    body.person_past_organization_ids = params.pastOrganizationIds;
  }
  if (params.personLocations?.length) body.person_locations = params.personLocations;
  if (params.employeeCountRanges?.length) {
    body.organization_num_employees_ranges = params.employeeCountRanges;
  }
  if (params.totalYearsExperience) body.person_total_yoe_range = params.totalYearsExperience;
  if (params.includeSimilarTitles !== undefined) {
    body.include_similar_titles = params.includeSimilarTitles;
  }

  try {
    const response = await fetch(`${APOLLO_BASE_URL}/mixed_people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "x-api-key": APOLLO_API_KEY,
      },
      body: JSON.stringify(body),
    });
    if (response.status === 429) {
      return { leads: [], total: 0, error: "Apollo rate limit reached — try again shortly" };
    }
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Apollo] People search error ${response.status}:`, text.slice(0, 500));
      return { leads: [], total: 0, error: `Apollo API error: ${response.status}` };
    }

    const json = await response.json();
    const rows = Array.isArray(json?.people) ? json.people : [];
    const total = typeof json?.total_entries === "number" ? json.total_entries : rows.length;
    console.log(
      `[Apollo] People search: ${rows.length} of ${total}` +
        (params.pastOrganizationIds?.length ? " (past-employer filter)" : "")
    );
    return {
      total,
      leads: rows.map(
        (p: Record<string, unknown>): ApolloLead => ({
          id: String(p.id ?? ""),
          firstName: (p.first_name as string) ?? null,
          lastNameMasked: ((p.last_name_obfuscated ?? p.last_name) as string) ?? null,
          title: (p.title as string) ?? null,
          organizationName:
            ((p.organization as { name?: string } | undefined)?.name ??
              (p.organization_name as string)) ??
            null,
        })
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Apollo] People search failed:", message);
    return { leads: [], total: 0, error: message };
  }
}

/**
 * Match a person by LinkedIn URL.
 *
 * Returns { data: null } rather than throwing on a miss — a candidate
 * Apollo has never seen is an ordinary outcome, and the assessor falls
 * back to asking for a pasted résumé.
 */
export async function enrichPersonByLinkedIn(
  linkedinUrl: string
): Promise<{ data: ApolloPersonResult | null; error?: string }> {
  const cleaned = linkedinUrl.trim().replace(/\/+$/, "");
  if (!cleaned) return { data: null, error: "No LinkedIn URL provided" };
  return matchPerson({ linkedin_url: cleaned }, cleaned);
}

/**
 * Match a person by Apollo id.
 *
 * Sourcing needs this: people search returns ids and no LinkedIn URLs,
 * so an id is the only handle a lead comes with. The enriched result
 * DOES carry linkedin_url, which is what lets a sourced lead hand off
 * to the existing URL-based assessment flow.
 */
export async function enrichPersonById(
  apolloId: string
): Promise<{ data: ApolloPersonResult | null; error?: string }> {
  const id = apolloId.trim();
  if (!id) return { data: null, error: "No Apollo id provided" };
  return matchPerson({ id }, id);
}

async function matchPerson(
  selector: Record<string, string>,
  label: string
): Promise<{ data: ApolloPersonResult | null; error?: string }> {
  if (!APOLLO_API_KEY) return { data: null, error: "APOLLO_API_KEY not configured" };

  try {
    const response = await fetch(`${APOLLO_BASE_URL}/people/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "x-api-key": APOLLO_API_KEY,
      },
      body: JSON.stringify({
        ...selector,
        // Work history is all the assessor needs. Personal contact
        // details cost extra credits and would be a liability on a
        // hiring record we retain, so they stay off.
        reveal_personal_emails: false,
        reveal_phone_number: false,
      }),
    });

    if (response.status === 404) {
      return { data: null, error: "No matching profile found in Apollo" };
    }
    if (response.status === 429) {
      return { data: null, error: "Apollo rate limit reached — try again shortly" };
    }
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Apollo] Person match error ${response.status} for ${label}:`, text.slice(0, 500));
      return { data: null, error: `Apollo API error: ${response.status}` };
    }

    const json = await response.json();
    const person = json?.person as ApolloPersonResult | undefined;
    // A 200 with no person is Apollo's ordinary "no match" answer.
    if (!person) return { data: null, error: "No matching profile found in Apollo" };

    const history = person.employment_history || [];
    console.log(
      `[Apollo] Profile matched: ${person.name} (${history.length} history rows, ` +
        `${history.filter(isEducationEntry).length} education)`
    );
    return { data: person };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Apollo] Person match failed:", message);
    return { data: null, error: message };
  }
}
