import type { ParsedSearchInput, SearchPlan, SearchQuery, DirectFetch } from "./types";

/**
 * Generate a search plan (queries + direct fetches) from parsed input.
 *
 * This is deterministic — no AI call needed. The queries are templated
 * based on what information we have about the prospect.
 */
export function generateSearchPlan(input: ParsedSearchInput): SearchPlan {
  const queries: SearchQuery[] = [];
  const directFetches: DirectFetch[] = [];

  const company = input.companyName;
  const domain = input.companyDomain;

  // ── Company Research Queries ──────────────────────────────────

  // Core company info
  queries.push({
    query: `"${company}" company overview`,
    purpose: "Company overview and description",
    priority: 1,
  });

  // Funding and stage
  queries.push({
    query: `"${company}" funding round investors`,
    purpose: "Funding history and investors",
    priority: 2,
  });

  // Recent news
  queries.push({
    query: `"${company}" news announcement 2025 OR 2026`,
    purpose: "Recent company news and announcements",
    priority: 2,
  });

  // Technology and product
  queries.push({
    query: `"${company}" product technology platform`,
    purpose: "Product and technology details",
    priority: 3,
  });

  // Company size and hiring
  queries.push({
    query: `"${company}" employees team size hiring`,
    purpose: "Company size and growth signals",
    priority: 3,
  });

  // ── Contact Research Queries ──────────────────────────────────

  if (input.contactName) {
    const contact = input.contactName;

    // LinkedIn profile
    queries.push({
      query: `"${contact}" "${company}" LinkedIn`,
      purpose: `${contact}'s professional background`,
      priority: 1,
    });

    // Published content / speaking
    queries.push({
      query: `"${contact}" "${company}" interview OR podcast OR article OR blog`,
      purpose: `${contact}'s public thought leadership and interviews`,
      priority: 3,
    });
  }

  // ── Industry / Competitive Queries ────────────────────────────

  if (input.industry) {
    queries.push({
      query: `${input.industry} market trends 2025 2026`,
      purpose: "Industry trends and market context",
      priority: 4,
    });
  }

  // Competitors
  queries.push({
    query: `"${company}" competitors alternatives`,
    purpose: "Competitive landscape",
    priority: 3,
  });

  // ── Direct URL Fetches ────────────────────────────────────────

  // User-provided URLs
  for (const url of input.urls) {
    directFetches.push({
      url,
      purpose: "User-provided URL",
    });
  }

  // If we have a domain, fetch the homepage and about page
  if (domain) {
    directFetches.push({
      url: `https://${domain}`,
      purpose: "Company homepage",
    });

    directFetches.push({
      url: `https://${domain}/about`,
      purpose: "Company about page",
    });
  }

  // LinkedIn profile if provided
  if (input.contactLinkedIn) {
    directFetches.push({
      url: input.contactLinkedIn,
      purpose: "Contact LinkedIn profile",
    });
  }

  // Sort queries by priority
  queries.sort((a, b) => a.priority - b.priority);

  return {
    queries,
    directFetches,
    parsedInput: input,
  };
}
