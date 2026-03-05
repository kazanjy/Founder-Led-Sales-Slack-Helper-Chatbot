import type { ParsedSearchInput, SearchPlan, SearchQuery } from "./types";

/**
 * Generate a search plan from parsed input.
 *
 * Person and company data comes from People Data Labs enrichment
 * (handled in results.ts). This plan also generates:
 * - Direct URL fetches for the company homepage and LinkedIn profile
 * - A Brave search for job postings / ads to infer technographics,
 *   growth areas, and organizational priorities
 */
export function generateSearchPlan(input: ParsedSearchInput): SearchPlan {
  const queries: SearchQuery[] = [];
  const directFetches: { url: string; purpose: string }[] = [];

  // User-provided URLs (company homepage)
  for (const url of input.urls) {
    directFetches.push({
      url,
      purpose: "Company homepage",
    });
  }

  // LinkedIn profile if provided directly
  if (input.contactLinkedIn) {
    directFetches.push({
      url: input.contactLinkedIn,
      purpose: "Contact LinkedIn profile",
    });
  }

  // Job postings / ads — reveals tech stack, growth areas, and org priorities
  queries.push({
    query: `"${input.companyName}" jobs OR careers OR hiring`,
    purpose: "Job postings and ads to infer technographics, growth areas, and organizational priorities",
    priority: 1,
  });

  return {
    queries,
    directFetches,
    parsedInput: input,
  };
}
