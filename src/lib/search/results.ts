import type {
  SearchPlan,
  SearchResults,
  BraveSearchResponse,
  FetchedPage,
  SearchProgressCallback,
} from "./types";
import { braveSearchBatch } from "./brave";
import { fetchPages } from "./fetcher";

/**
 * Execute a search plan: run all Brave queries and direct URL fetches,
 * then aggregate results.
 */
export async function executeSearchPlan(
  plan: SearchPlan,
  onProgress?: SearchProgressCallback
): Promise<SearchResults> {
  onProgress?.({
    stage: "searching",
    message: `Running ${plan.queries.length} search queries...`,
    progress: 30,
  });

  // Run searches and fetches in parallel
  const [searchResults, fetchedPages] = await Promise.all([
    // Brave searches
    plan.queries.length > 0
      ? braveSearchBatch(plan.queries)
      : Promise.resolve([] as BraveSearchResponse[]),

    // Direct URL fetches
    plan.directFetches.length > 0
      ? (onProgress?.({
          stage: "fetching",
          message: `Fetching ${plan.directFetches.length} pages...`,
          progress: 50,
        }),
        fetchPages(plan.directFetches))
      : Promise.resolve([] as FetchedPage[]),
  ]);

  // Count total results
  const totalResults =
    searchResults.reduce((sum, r) => sum + r.results.length, 0) +
    fetchedPages.filter((p) => p.success).length;

  console.log(
    `[SearchResults] Collected ${totalResults} total results from ${searchResults.length} queries and ${fetchedPages.length} fetches`
  );

  onProgress?.({
    stage: "fetching",
    message: `Collected ${totalResults} results`,
    progress: 70,
  });

  return {
    parsedInput: plan.parsedInput,
    searchResults,
    fetchedPages,
    totalResults,
  };
}

/**
 * Format search results into a text block suitable for LLM synthesis.
 * Deduplicates URLs and prioritizes higher-quality content.
 */
export function formatResultsForSynthesis(results: SearchResults): string {
  const sections: string[] = [];
  const seenUrls = new Set<string>();

  // ── Search Results ────────────────────────────────────────────
  for (const searchResponse of results.searchResults) {
    if (searchResponse.error || searchResponse.results.length === 0) continue;

    const resultLines: string[] = [];
    for (const result of searchResponse.results) {
      if (seenUrls.has(result.url)) continue;
      seenUrls.add(result.url);

      resultLines.push(`- **${result.title}** (${result.url})`);
      if (result.description) {
        resultLines.push(`  ${result.description}`);
      }
    }

    if (resultLines.length > 0) {
      sections.push(
        `### Search: "${searchResponse.query}" (${searchResponse.purpose})\n\n${resultLines.join("\n")}`
      );
    }
  }

  // ── Fetched Pages ─────────────────────────────────────────────
  for (const page of results.fetchedPages) {
    if (!page.success || !page.textContent) continue;
    if (seenUrls.has(page.url)) continue;
    seenUrls.add(page.url);

    // Truncate long page content for the synthesis prompt
    const content =
      page.textContent.length > 5000
        ? page.textContent.substring(0, 5000) + "\n[...content truncated...]"
        : page.textContent;

    sections.push(
      `### Fetched Page: ${page.title || page.url} (${page.purpose})\nURL: ${page.url}\n\n${content}`
    );
  }

  if (sections.length === 0) {
    return "No search results or fetched content available.";
  }

  return sections.join("\n\n---\n\n");
}
