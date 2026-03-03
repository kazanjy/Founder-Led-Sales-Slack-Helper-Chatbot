import type { ParsedSearchInput, SearchPlan, SearchQuery, DirectFetch } from "./types";

/**
 * Generate a search plan (queries + direct fetches) from parsed input.
 *
 * This is deterministic — no AI call needed. The queries are templated
 * based on what information we have about the prospect.
 *
 * We intentionally keep the search surface tight: LinkedIn company page,
 * LinkedIn prospect profile, and Crunchbase company page.
 */
export function generateSearchPlan(input: ParsedSearchInput): SearchPlan {
  const queries: SearchQuery[] = [];
  const directFetches: DirectFetch[] = [];

  const company = input.companyName;

  // ── LinkedIn Company Page ──────────────────────────────────────
  queries.push({
    query: `site:linkedin.com/company "${company}"`,
    purpose: "LinkedIn company page",
    priority: 1,
  });

  // ── LinkedIn Prospect Profile ──────────────────────────────────
  if (input.contactName) {
    const contact = input.contactName;
    const title = input.contactTitle;
    const entityParts = [`"${contact}"`, `"${company}"`];
    if (title) entityParts.push(`"${title}"`);
    const entityClause = entityParts.join(" ");

    queries.push({
      query: `site:linkedin.com/in ${entityClause}`,
      purpose: `${contact}'s LinkedIn profile`,
      priority: 1,
    });
  }

  // ── Crunchbase Company Page ────────────────────────────────────
  queries.push({
    query: `site:crunchbase.com/organization "${company}"`,
    purpose: "Crunchbase company profile",
    priority: 1,
  });

  // ── Direct URL Fetches ─────────────────────────────────────────

  // User-provided URLs
  for (const url of input.urls) {
    directFetches.push({
      url,
      purpose: "User-provided URL",
    });
  }

  // LinkedIn profile if provided directly
  if (input.contactLinkedIn) {
    directFetches.push({
      url: input.contactLinkedIn,
      purpose: "Contact LinkedIn profile",
    });
  }

  return {
    queries,
    directFetches,
    parsedInput: input,
  };
}
