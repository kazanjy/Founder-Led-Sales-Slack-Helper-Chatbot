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
 * Shape note: Apollo returns education INSIDE employment_history rather
 * than as its own array — an entry is education when it carries a
 * degree, a major, or kind/grade_level markers instead of a job title.
 * Some responses also carry a top-level `education` array. We read both
 * and let the caller de-duplicate, because getting this wrong means
 * silently losing the school-selectivity signal rather than erroring.
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
  if (!APOLLO_API_KEY) return { data: null, error: "APOLLO_API_KEY not configured" };
  const cleaned = linkedinUrl.trim().replace(/\/+$/, "");
  if (!cleaned) return { data: null, error: "No LinkedIn URL provided" };

  try {
    const response = await fetch(`${APOLLO_BASE_URL}/people/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "x-api-key": APOLLO_API_KEY,
      },
      body: JSON.stringify({
        linkedin_url: cleaned,
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
      console.error(`[Apollo] Person match error ${response.status}:`, text.slice(0, 500));
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
