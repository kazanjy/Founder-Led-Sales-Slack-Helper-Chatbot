/**
 * Website crawler for Sales Narrative pre-fill.
 * Two-level crawl: homepage → level-1 pages → discover sub-links → level-2 pages.
 */

import { openai } from "@/lib/openai";
import { fetchPage } from "@/lib/search/fetcher";

const FETCH_TIMEOUT = 10_000;
const MAX_LEVEL1_PAGES = 20;
const MAX_LEVEL2_PAGES = 10;
const MAX_CONTEXT_LENGTH = 70_000;

export interface CrawlResult {
  text: string;
  urls: string[];  // URLs that were actually fetched successfully
}

/**
 * Crawl a website and return combined text context for narrative pre-fill.
 * Uses a two-level crawl: first picks top pages from the homepage,
 * then discovers deeper pages (case studies, customer stories, etc.) from those.
 */
export async function crawlWebsiteForContext(url: string): Promise<CrawlResult> {
  // Normalise the URL
  let baseUrl: URL;
  try {
    baseUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  console.log(`[Crawler] Starting two-level crawl of ${baseUrl.origin}`);

  // 1. Fetch homepage HTML + sitemap in parallel
  const [homepageHtml, sitemapUrls] = await Promise.all([
    fetchRawHtml(baseUrl.href),
    fetchSitemapUrls(baseUrl),
  ]);
  if (!homepageHtml) {
    console.warn("[Crawler] Could not fetch homepage, returning empty context");
    return { text: "", urls: [] };
  }

  // 2. Extract all same-domain links from the homepage
  const links = extractLinks(homepageHtml, baseUrl);

  // 3. Combine homepage links + sitemap URLs
  const allLinks = deduplicateUrls([...links, ...sitemapUrls]);

  console.log(`[Crawler] Found ${allLinks.length} unique same-domain links (${links.length} from page, ${sitemapUrls.length} from sitemap)`);

  // 4. Use LLM to pick the most relevant level-1 pages
  const level1Urls = await selectRelevantPages(allLinks, baseUrl, MAX_LEVEL1_PAGES);
  console.log(`[Crawler] LLM selected ${level1Urls.length} level-1 pages to crawl`);

  // 5. Fetch homepage text + level-1 pages in parallel
  //    Also fetch raw HTML from level-1 pages to discover sub-links
  const homepageFetch = fetchPage(baseUrl.href, "Homepage");
  const level1ContentFetches = level1Urls.map((u) => fetchPage(u, "Sub-page"));
  const level1HtmlFetches = level1Urls.map((u) => fetchRawHtml(u));

  const [contentResults, level1HtmlResults] = await Promise.all([
    Promise.all([homepageFetch, ...level1ContentFetches]),
    Promise.all(level1HtmlFetches),
  ]);
  const [homepageResult, ...level1Results] = contentResults;

  // Collect level-1 results
  const sections: string[] = [];
  const fetchedUrls: string[] = [];
  const allLevel1Fetches = [homepageResult, ...level1Results];

  for (const page of allLevel1Fetches) {
    if (page.success && page.textContent?.trim()) {
      const label = page.title || page.url;
      sections.push(`=== ${label} (${page.url}) ===\n${page.textContent}`);
      fetchedUrls.push(page.url);
    }
  }

  console.log(`[Crawler] Level 1 complete: ${fetchedUrls.length} pages fetched`);

  // 6. Level 2: Discover new links from level-1 pages
  const alreadyCrawled = new Set(fetchedUrls.map((u) => u.toLowerCase().replace(/\/+$/, "")));
  alreadyCrawled.add(baseUrl.href.toLowerCase().replace(/\/+$/, ""));

  const newLinks: string[] = [];
  for (const html of level1HtmlResults) {
    if (html) {
      const subLinks = extractLinks(html, baseUrl);
      for (const link of subLinks) {
        const key = link.toLowerCase().replace(/\/+$/, "");
        if (!alreadyCrawled.has(key)) {
          newLinks.push(link);
          alreadyCrawled.add(key);
        }
      }
    }
  }

  const uniqueNewLinks = deduplicateUrls(newLinks);
  console.log(`[Crawler] Level 2: discovered ${uniqueNewLinks.length} new links from level-1 pages`);

  if (uniqueNewLinks.length > 0) {
    // 7. LLM picks the best level-2 pages, prioritizing case studies and customer stories
    const level2Urls = await selectRelevantPages(uniqueNewLinks, baseUrl, MAX_LEVEL2_PAGES, true);
    console.log(`[Crawler] LLM selected ${level2Urls.length} level-2 pages to crawl`);

    if (level2Urls.length > 0) {
      // 8. Fetch level-2 pages
      const level2Fetches = await Promise.all(
        level2Urls.map((u) => fetchPage(u, "Deep page"))
      );

      for (const page of level2Fetches) {
        if (page.success && page.textContent?.trim()) {
          const label = page.title || page.url;
          sections.push(`=== ${label} (${page.url}) ===\n${page.textContent}`);
          fetchedUrls.push(page.url);
        }
      }

      console.log(`[Crawler] Level 2 complete: ${level2Urls.length} attempted, ${level2Fetches.filter((f) => f.success).length} succeeded`);
    }
  }

  const combined = sections.join("\n\n");
  const truncated = combined.length > MAX_CONTEXT_LENGTH
    ? combined.substring(0, MAX_CONTEXT_LENGTH) + "\n\n[...content truncated for length...]"
    : combined;

  console.log(`[Crawler] Crawl complete: ${fetchedUrls.length} total pages, ${truncated.length} chars of context`);
  return { text: truncated, urls: fetchedUrls };
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
async function selectRelevantPages(urls: string[], baseUrl: URL, maxPages: number, deepCrawl = false): Promise<string[]> {
  if (urls.length === 0) return [];
  if (urls.length <= maxPages) return urls;

  // Truncate the list if massive (some sitemaps have thousands of URLs)
  const urlsForSelection = urls.slice(0, 200);

  const numberedList = urlsForSelection.map((u, i) => `${i + 1}. ${u}`).join("\n");

  const focusAreas = deepCrawl
    ? `PRIORITIZE (in order):
- Individual case studies / customer success stories / customer spotlights
- Testimonials / reviews / results pages
- ROI calculators / proof points / data sheets
- Detailed solution or use-case pages

Also consider:
- Product / features detail pages
- Integration or partner pages

Avoid: blog posts, legal pages, careers, login, docs/API reference, help articles, pages that look like top-level navigation you would have already seen.`
    : `Focus on pages about:
- Product / features / how it works
- Solutions / use cases
- Customers / case studies / testimonials
- Pricing
- About / company story
- Problems solved / benefits

Avoid: blog posts, legal pages, careers, login, docs/API reference, individual help articles.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You select the most useful web pages for understanding a company's product, value proposition, and sales positioning. Pick up to ${maxPages} URLs.

${focusAreas}

Respond with ONLY a JSON array of URL strings, e.g. ["https://...", "https://..."]`,
        },
        {
          role: "user",
          content: `Website: ${baseUrl.origin}\n\nAvailable pages:\n${numberedList}\n\nPick up to ${maxPages} most relevant URLs for understanding this company's product and sales positioning.`,
        },
      ],
      temperature: 0,
      max_completion_tokens: 1000,
    });

    const text = response.choices[0]?.message?.content?.trim() || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return urls.slice(0, maxPages);

    const selected: string[] = JSON.parse(jsonMatch[0]);
    // Validate that all selected URLs were in our original list
    const urlSet = new Set(urls);
    return selected.filter((u) => urlSet.has(u)).slice(0, maxPages);
  } catch (error) {
    console.error("[Crawler] LLM page selection failed, using first N pages:", error);
    return urls.slice(0, maxPages);
  }
}
