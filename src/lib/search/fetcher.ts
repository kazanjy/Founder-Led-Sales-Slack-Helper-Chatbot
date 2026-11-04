import type { FetchedPage } from "./types";

/** Max text content length to extract from a page */
const MAX_TEXT_LENGTH = 15000;
/** Fetch timeout in ms */
const FETCH_TIMEOUT = 10000;

/**
 * Fetch a URL and extract its text content (HTML stripped).
 */
export async function fetchPage(url: string, purpose: string): Promise<FetchedPage> {
  // Skip LinkedIn URLs — they block server-side fetching and return empty/login pages
  if (url.includes("linkedin.com")) {
    console.log(`[Fetcher] Skipping LinkedIn URL (blocked by anti-scraping): ${url}`);
    return {
      url,
      purpose,
      textContent: "",
      success: false,
      error: "LinkedIn blocks server-side fetching — content available via Brave search snippets",
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MikeyBot/1.0; +https://mikey.com)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        url,
        purpose,
        textContent: "",
        success: false,
        error: `HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";

    // Only process HTML and text content
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
      return {
        url,
        purpose,
        textContent: "",
        success: false,
        error: `Unsupported content type: ${contentType}`,
      };
    }

    const html = await response.text();

    // For plain text, return as-is
    if (contentType.includes("text/plain")) {
      return {
        url,
        purpose,
        textContent: html.substring(0, MAX_TEXT_LENGTH),
        success: true,
      };
    }

    // Parse HTML and extract text
    const { title, textContent } = extractTextFromHtml(html);

    return {
      url,
      purpose,
      title,
      textContent: textContent.substring(0, MAX_TEXT_LENGTH),
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Fetcher] Error fetching ${url}:`, message);
    return {
      url,
      purpose,
      textContent: "",
      success: false,
      error: message.includes("abort") ? "Timeout" : message,
    };
  }
}

/**
 * Extract readable text content from HTML using regex (zero external dependencies).
 */
function extractTextFromHtml(html: string): { title?: string; textContent: string } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || undefined;

  // Try to find main content area first
  let content = html;
  const mainMatch =
    html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i) ||
    html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i) ||
    html.match(/<div[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/div>/i);

  if (mainMatch) {
    content = mainMatch[1];
  }

  // Remove elements that don't contribute useful text
  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ");

  // Strip all remaining HTML tags
  content = content.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  content = content
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Collapse whitespace
  content = content
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .replace(/^\s+/gm, "")
    .trim();

  return { title, textContent: content };
}

/**
 * Fetch multiple URLs in parallel with concurrency control.
 */
export async function fetchPages(
  fetches: { url: string; purpose: string }[],
  maxConcurrent: number = 10
): Promise<FetchedPage[]> {
  const results: FetchedPage[] = [];

  for (let i = 0; i < fetches.length; i += maxConcurrent) {
    const batch = fetches.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map((f) => fetchPage(f.url, f.purpose))
    );
    results.push(...batchResults);
  }

  return results;
}
