import type { BraveSearchResult, BraveSearchResponse } from "./types";

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

/**
 * Execute a single search query against the Brave Search API.
 */
export async function braveSearch(
  query: string,
  purpose: string,
  count: number = 10
): Promise<BraveSearchResponse> {
  if (!BRAVE_API_KEY) {
    console.error("[BraveSearch] BRAVE_SEARCH_API_KEY not configured");
    return {
      query,
      purpose,
      results: [],
      error: "Brave Search API key not configured",
    };
  }

  try {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
      text_decorations: "false",
      search_lang: "en",
    });

    const response = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BraveSearch] API error ${response.status}:`, errorText);
      return {
        query,
        purpose,
        results: [],
        error: `Brave API error: ${response.status}`,
      };
    }

    const data = await response.json();

    // Extract web results
    const webResults = data.web?.results || [];
    const results: BraveSearchResult[] = webResults.map(
      (r: { title?: string; url?: string; description?: string; age?: string }) => ({
        title: r.title || "",
        url: r.url || "",
        description: r.description || "",
        age: r.age,
      })
    );

    console.log(`[BraveSearch] "${query}" returned ${results.length} results`);

    return {
      query,
      purpose,
      results,
    };
  } catch (error) {
    console.error(`[BraveSearch] Error searching "${query}":`, error);
    return {
      query,
      purpose,
      results: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute multiple search queries in parallel with rate limiting.
 */
export async function braveSearchBatch(
  queries: { query: string; purpose: string }[],
  maxConcurrent: number = 3
): Promise<BraveSearchResponse[]> {
  const results: BraveSearchResponse[] = [];

  // Process in batches to respect rate limits
  for (let i = 0; i < queries.length; i += maxConcurrent) {
    const batch = queries.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map((q) => braveSearch(q.query, q.purpose))
    );
    results.push(...batchResults);

    // Small delay between batches to be nice to the API
    if (i + maxConcurrent < queries.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}
