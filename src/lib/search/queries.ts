import type { ParsedSearchInput, SearchPlan, SearchQuery } from "./types";

/**
 * Generate a search plan from parsed input.
 *
 * Person and company data comes from People Data Labs enrichment
 * (handled in results.ts). This plan also generates:
 * - Direct URL fetches for the company homepage and LinkedIn profile
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

  return {
    queries,
    directFetches,
    parsedInput: input,
  };
}
