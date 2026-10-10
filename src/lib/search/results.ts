import type {
  SearchPlan,
  SearchResults,
  BraveSearchResponse,
  FetchedPage,
  SearchProgressCallback,
} from "./types";
import { braveSearchBatch } from "./brave";
import { fetchPages } from "./fetcher";
import { enrichWithPDL, formatPDLForSynthesis } from "./pdl";

/**
 * Execute a search plan: run PDL enrichment, Brave queries, and direct URL
 * fetches in parallel, then aggregate results.
 */
export async function executeSearchPlan(
  plan: SearchPlan,
  onProgress?: SearchProgressCallback
): Promise<SearchResults> {
  onProgress?.({
    stage: "searching",
    message: "Enriching prospect data and fetching pages...",
    progress: 30,
  });

  // Run PDL enrichment, Brave searches, and URL fetches in parallel
  const [pdlResult, searchResults, fetchedPages] = await Promise.all([
    // People Data Labs enrichment
    enrichWithPDL(plan.parsedInput),

    // Brave searches (if any)
    plan.queries.length > 0
      ? braveSearchBatch(plan.queries)
      : Promise.resolve([] as BraveSearchResponse[]),

    // Direct URL fetches (if any)
    plan.directFetches.length > 0
      ? (onProgress?.({
          stage: "fetching",
          message: `Fetching ${plan.directFetches.length} pages...`,
          progress: 50,
        }),
        fetchPages(plan.directFetches))
      : Promise.resolve([] as FetchedPage[]),
  ]);

  const pdlData = formatPDLForSynthesis(pdlResult);

  // Count total results
  const pdlHits = (pdlResult.person ? 1 : 0) + (pdlResult.company ? 1 : 0);
  const totalResults =
    pdlHits +
    searchResults.reduce((sum, r) => sum + r.results.length, 0) +
    fetchedPages.filter((p) => p.success).length;

  console.log(
    `[SearchResults] Collected ${totalResults} total results — PDL: ${pdlHits}, Brave: ${searchResults.length} queries, Fetches: ${fetchedPages.length}`
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
    pdlData,
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

  // ── People Data Labs ────────────────────────────────────────────
  if (results.pdlData) {
    sections.push(results.pdlData);
  }

  // ── Fetched Pages ───────────────────────────────────────────────
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

  // ── Search Results (Brave snippets as supplemental) ─────────────
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

  if (sections.length === 0) {
    return "No search results or fetched content available.";
  }

  return sections.join("\n\n---\n\n");
}
