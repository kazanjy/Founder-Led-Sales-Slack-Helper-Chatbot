import type { ParsedSearchInput, SearchPlan } from "./types";

/**
 * Generate a search plan from parsed input.
 *
 * Person and company data now comes from People Data Labs enrichment
 * (handled in results.ts). This plan only generates direct URL fetches
 * for the company homepage (user-provided) and any LinkedIn profile URL.
 *
 * Brave search queries are no longer generated — PDL is the primary
 * data source.
 */
export function generateSearchPlan(input: ParsedSearchInput): SearchPlan {
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
    queries: [],
    directFetches,
    parsedInput: input,
  };
}
