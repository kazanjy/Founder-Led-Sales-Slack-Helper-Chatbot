/**
 * Website crawler for Sales Narrative pre-fill.
 * Fetches a homepage, discovers relevant sub-pages, and extracts text context.
 */

import { openai } from "@/lib/openai";
import { fetchPage } from "@/lib/search/fetcher";

const FETCH_TIMEOUT = 10_000;
const MAX_PAGES_TO_CRAWL = 8;
const MAX_CONTEXT_LENGTH = 50_000;

/**
 * Crawl a website and return combined text context for narrative pre-fill.
 */
export async function crawlWebsiteForContext(url: string): Promise<string> {
  // Normalise the URL
  let baseUrl: URL;
  try {
    baseUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  console.log(`[Crawler] Starting crawl of ${baseUrl.origin}`);

  // 1. Fetch the homepage HTML (raw — we need links before stripping)
  const homepageHtml = await fetchRawHtml(baseUrl.href);
  if (!homepageHtml) {
    console.warn("[Crawler] Could not fetch homepage, returning empty context");
    return "";
  }

  // 2. Extract all same-domain links from the homepage
  const links = extractLinks(homepageHtml, baseUrl);

  // 3. Try to find sitemap and add those URLs too
  const sitemapUrls = await fetchSitemapUrls(baseUrl);
  const allLinks = deduplicateUrls([...links, ...sitemapUrls]);

  console.log(`[Crawler] Found ${allLinks.length} unique same-domain links (${links.length} from page, ${sitemapUrls.length} from sitemap)`);

  // 4. Use LLM to pick the most relevant pages
  const selectedUrls = await selectRelevantPages(allLinks, baseUrl);
  console.log(`[Crawler] LLM selected ${selectedUrls.length} pages to crawl`);

  // 5. Fetch homepage text + selected pages in parallel
  const homepageFetch = fetchPage(baseUrl.href, "Homepage");
  const subpageFetches = selectedUrls.map((u) => fetchPage(u, "Sub-page"));
  const allFetches = await Promise.all([homepageFetch, ...subpageFetches]);

  // 6. Combine all text
  const sections: string[] = [];
  for (const page of allFetches) {
    if (page.success && page.textContent?.trim()) {
      const label = page.title || page.url;
      sections.push(`=== ${label} (${page.url}) ===\n${page.textContent}`);
    }
  }

  const combined = sections.join("\n\n");
  const truncated = combined.length > MAX_CONTEXT_LENGTH
    ? combined.substring(0, MAX_CONTEXT_LENGTH) + "\n\n[...content truncated for length...]"
    : combined;

  console.log(`[Crawler] Crawl complete: ${allFetches.filter((f) => f.success).length} pages fetched, ${truncated.length} chars of context`);
  return truncated;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Fetch raw HTML from a URL (without stripping — we need the links).
 */
async function fetchRawHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MikeyBot/1.0; +https://mikey.com)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return null;
    }

    return await response.text();
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Crawler] Failed to fetch ${url}: ${msg}`);
    return null;
  }
}

/**
 * Extract all same-domain <a href> links from HTML.
 */
function extractLinks(html: string, baseUrl: URL): string[] {
  const hrefRegex = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  const urls = new Set<string>();
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl.href);
      // Same-domain only, HTTP(S) only
      if (resolved.hostname === baseUrl.hostname && resolved.protocol.startsWith("http")) {
        // Remove hash and trailing slash for dedup
        resolved.hash = "";
        const clean = resolved.href.replace(/\/+$/, "");
        urls.add(clean);
      }
    } catch {
      // Skip malformed URLs
    }
  }

  // Remove the homepage itself
  const homeClean = baseUrl.href.replace(/\/+$/, "");
  urls.delete(homeClean);

  return Array.from(urls);
}

/**
 * Try to fetch and parse /sitemap.xml for additional URLs.
 */
async function fetchSitemapUrls(baseUrl: URL): Promise<string[]> {
  const sitemapUrl = `${baseUrl.origin}/sitemap.xml`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(sitemapUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MikeyBot/1.0)" },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) return [];

    const xml = await response.text();

    // Extract <loc> URLs from sitemap
    const locRegex = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi;
    const urls: string[] = [];
    let match;

    while ((match = locRegex.exec(xml)) !== null) {
      try {
        const parsed = new URL(match[1]);
        if (parsed.hostname === baseUrl.hostname) {
          urls.push(parsed.href.replace(/\/+$/, ""));
        }
      } catch {
        // Skip
      }
    }

    console.log(`[Crawler] Sitemap found with ${urls.length} URLs`);
    return urls;
  } catch {
    console.log("[Crawler] No sitemap found or failed to fetch");
    return [];
  }
}

/**
 * Deduplicate URLs (case-insensitive path, remove trailing slashes).
 */
function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((url) => {
    const key = url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Use LLM to pick the most relevant pages to crawl for sales narrative context.
 */
async function selectRelevantPages(urls: string[], baseUrl: URL): Promise<string[]> {
  if (urls.length === 0) return [];
  if (urls.length <= MAX_PAGES_TO_CRAWL) return urls;

  // Truncate the list if massive (some sitemaps have thousands of URLs)
  const urlsForSelection = urls.slice(0, 200);

  const numberedList = urlsForSelection.map((u, i) => `${i + 1}. ${u}`).join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You select the most useful web pages for understanding a company's product, value proposition, and sales positioning. Pick up to ${MAX_PAGES_TO_CRAWL} URLs.

Focus on pages about:
- Product / features / how it works
- Solutions / use cases
- Customers / case studies / testimonials
- Pricing
- About / company story
- Problems solved / benefits

Avoid: blog posts, legal pages, careers, login, docs/API reference, individual help articles.

Respond with ONLY a JSON array of URL strings, e.g. ["https://...", "https://..."]`,
        },
        {
          role: "user",
          content: `Website: ${baseUrl.origin}\n\nAvailable pages:\n${numberedList}\n\nPick up to ${MAX_PAGES_TO_CRAWL} most relevant URLs for understanding this company's product and sales positioning.`,
        },
      ],
      temperature: 0,
      max_completion_tokens: 1000,
    });

    const text = response.choices[0]?.message?.content?.trim() || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return urls.slice(0, MAX_PAGES_TO_CRAWL);

    const selected: string[] = JSON.parse(jsonMatch[0]);
    // Validate that all selected URLs were in our original list
    const urlSet = new Set(urls);
    return selected.filter((u) => urlSet.has(u)).slice(0, MAX_PAGES_TO_CRAWL);
  } catch (error) {
    console.error("[Crawler] LLM page selection failed, using first N pages:", error);
    return urls.slice(0, MAX_PAGES_TO_CRAWL);
  }
}
