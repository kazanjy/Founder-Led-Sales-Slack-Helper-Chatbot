import * as cheerio from "cheerio";
import type { FetchedPage } from "./types";

/** Max text content length to extract from a page */
const MAX_TEXT_LENGTH = 15000;
/** Fetch timeout in ms */
const FETCH_TIMEOUT = 10000;

/**
 * Fetch a URL and extract its text content (HTML stripped).
 */
export async function fetchPage(url: string, purpose: string): Promise<FetchedPage> {
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
 * Extract readable text content from HTML using cheerio.
 */
function extractTextFromHtml(html: string): { title?: string; textContent: string } {
  const $ = cheerio.load(html);

  // Get title
  const title = $("title").first().text().trim() || undefined;

  // Remove elements that don't contribute useful text
  const removeTags = ["script", "style", "nav", "footer", "header", "iframe", "noscript", "svg", "aside"];
  for (const tag of removeTags) {
    $(tag).remove();
  }

  // Remove common noise selectors
  const noiseSelectors = [
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    ".cookie-banner",
    ".cookie-consent",
    ".nav",
    ".navbar",
    ".footer",
    ".sidebar",
    "#cookie-banner",
    "#nav",
    "#footer",
    "#sidebar",
  ];

  for (const selector of noiseSelectors) {
    try {
      $(selector).remove();
    } catch {
      // Invalid selector, skip
    }
  }

  // Try to find main content area
  const mainContent =
    $("main").first().length ? $("main").first() :
    $("article").first().length ? $("article").first() :
    $('[role="main"]').first().length ? $('[role="main"]').first() :
    $("#content").first().length ? $("#content").first() :
    $(".content").first().length ? $(".content").first() :
    $("body");

  if (!mainContent.length) {
    return { title, textContent: "" };
  }

  // Extract text and clean up whitespace
  let text = mainContent.text();

  // Collapse whitespace: multiple spaces/tabs to single space, multiple newlines to double
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .replace(/^\s+/gm, "")
    .trim();

  return { title, textContent: text };
}

/**
 * Fetch multiple URLs in parallel with concurrency control.
 */
export async function fetchPages(
  fetches: { url: string; purpose: string }[],
  maxConcurrent: number = 5
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
