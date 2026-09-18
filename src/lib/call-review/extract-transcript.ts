import type { VendorConfig } from "./vendors";
import { getExtractionScript, getHtmlExtractionConfig } from "./extraction-strategies";

interface ExtractionSuccess {
  transcript: string;
  title?: string;
}

interface ExtractionError {
  error: string;
}

export type ExtractionResult = ExtractionSuccess | ExtractionError;

/**
 * Extract a transcript from a public share link.
 *
 * Strategy:
 *  1. Try a direct HTTP fetch + server-side HTML parsing (fast, no dependencies).
 *  2. If that fails and a headless browser service (Browserless) is configured,
 *     fall back to browser-based extraction for JS-rendered pages.
 *  3. If both fail, return an error with manual-paste guidance.
 */
export async function extractTranscriptFromUrl(
  url: string,
  vendor: VendorConfig,
): Promise<ExtractionResult> {
  const overallStart = Date.now();

  // ── Attempt 1: Direct HTML fetch ──────────────────────────────────────
  console.log(`[extract-transcript] Starting extraction`, {
    vendor: vendor.name,
    vendorId: vendor.id,
    url,
    browserlessConfigured: !!process.env.BROWSER_SERVICE_URL,
  });

  const directResult = await extractTranscriptDirect(url, vendor);

  if ("transcript" in directResult) {
    console.log(`[extract-transcript] Direct fetch succeeded`, {
      vendor: vendor.name,
      url,
      elapsed: `${Date.now() - overallStart}ms`,
      transcriptLength: directResult.transcript.length,
    });
    return directResult;
  }

  console.log(`[extract-transcript] Direct fetch failed, reason: ${directResult.error}`, {
    vendor: vendor.name,
    url,
    elapsed: `${Date.now() - overallStart}ms`,
  });

  // ── Attempt 2: Headless browser (Browserless) ─────────────────────────
  const serviceUrl = process.env.BROWSER_SERVICE_URL;
  if (serviceUrl) {
    console.log(`[extract-transcript] Falling back to Browserless`, {
      vendor: vendor.name,
      url,
      serviceUrl: serviceUrl.replace(/\/+$/, ""),
    });

    const browserResult = await extractTranscriptViaBrowser(url, vendor, serviceUrl);

    if ("transcript" in browserResult) {
      console.log(`[extract-transcript] Browserless fallback succeeded`, {
        vendor: vendor.name,
        url,
        totalElapsed: `${Date.now() - overallStart}ms`,
        transcriptLength: browserResult.transcript.length,
      });
      return browserResult;
    }

    console.warn(`[extract-transcript] Both extraction methods failed`, {
      vendor: vendor.name,
      url,
      totalElapsed: `${Date.now() - overallStart}ms`,
      directError: directResult.error,
      browserError: browserResult.error,
    });
    return browserResult;
  }

  console.warn(`[extract-transcript] Direct fetch failed and Browserless not configured`, {
    vendor: vendor.name,
    url,
    totalElapsed: `${Date.now() - overallStart}ms`,
    error: directResult.error,
  });

  // Neither approach worked
  return { error: directResult.error };
}

// ── Direct HTML fetch approach ────────────────────────────────────────────────

const FETCH_TIMEOUT = 15_000;

/**
 * Fetch the share page via plain HTTP and extract the transcript from the
 * server-rendered HTML. Works for pages that include transcript text in the
 * initial HTML response (not behind client-side JS rendering).
 */
async function extractTranscriptDirect(
  url: string,
  vendor: VendorConfig,
): Promise<ExtractionResult> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      console.warn(`[extract-transcript:direct] HTTP error`, {
        vendor: vendor.id,
        url,
        status: response.status,
        statusText: response.statusText,
        elapsed: `${elapsed}ms`,
      });
      return { error: `Page returned HTTP ${response.status} (${response.statusText}).` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      console.warn(`[extract-transcript:direct] Non-HTML content type`, {
        vendor: vendor.id,
        url,
        contentType,
        elapsed: `${elapsed}ms`,
      });
      return { error: `Unexpected content type: ${contentType}` };
    }

    const html = await response.text();

    console.log(`[extract-transcript:direct] Fetched HTML`, {
      vendor: vendor.id,
      url,
      elapsed: `${Date.now() - startTime}ms`,
      htmlLength: html.length,
      contentType,
      finalUrl: response.url !== url ? response.url : "(no redirect)",
    });

    // Check for login / auth pages
    if (/sign.?in|log.?in|authenticate/i.test(html.substring(0, 2000)) &&
        !/<[^>]*class="[^"]*transcript/i.test(html)) {
      console.warn(`[extract-transcript:direct] Login page detected`, {
        vendor: vendor.id,
        url,
        htmlPreview: html.substring(0, 300).replace(/\s+/g, " "),
      });
      return {
        error:
          "This link appears to require login. Please open the call, copy the transcript, and paste it below.",
      };
    }

    // Try vendor-specific HTML extraction
    const result = extractTranscriptFromHtml(html, vendor);

    if ("error" in result) {
      console.warn(`[extract-transcript:direct] HTML parsing failed`, {
        vendor: vendor.id,
        url,
        elapsed: `${Date.now() - startTime}ms`,
        error: result.error,
        htmlLength: html.length,
        // Log whether common transcript markers exist in the raw HTML
        hasTranscriptClass: /<[^>]*class="[^"]*transcript/i.test(html),
        hasTranscriptId: /<[^>]*id="[^"]*transcript/i.test(html),
        hasTranscriptData: /<[^>]*data-[^=]*="[^"]*transcript/i.test(html),
      });
    }

    return result;
  } catch (err) {
    const elapsed = Date.now() - startTime;

    if (err instanceof DOMException && err.name === "AbortError") {
      console.warn(`[extract-transcript:direct] Timed out after ${elapsed}ms`, {
        vendor: vendor.id,
        url,
      });
      return { error: `Direct fetch timed out after ${FETCH_TIMEOUT / 1000}s.` };
    }

    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[extract-transcript:direct] Fetch error`, {
      vendor: vendor.id,
      url,
      elapsed: `${elapsed}ms`,
      error: msg,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { error: `Direct fetch failed: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse raw HTML and extract transcript text using vendor-specific selectors.
 *
 * Uses regex-based HTML parsing (same pattern as the existing fetcher.ts) to
 * avoid external dependencies.
 */
function extractTranscriptFromHtml(
  html: string,
  vendor: VendorConfig,
): ExtractionResult {
  const config = getHtmlExtractionConfig(vendor);

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || undefined;

  // Try each transcript container pattern in order
  let transcriptHtml: string | null = null;

  for (const pattern of config.containerPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      transcriptHtml = match[1];
      break;
    }
  }

  if (!transcriptHtml) {
    return {
      error:
        "Could not find transcript content in the page HTML. The page may load transcripts dynamically via JavaScript.",
    };
  }

  // Remove elements that shouldn't be in the transcript
  let cleaned = transcriptHtml;
  for (const stripPattern of config.stripPatterns) {
    cleaned = cleaned.replace(stripPattern, " ");
  }

  // Strip remaining HTML tags, preserving some structure
  // Convert block elements to newlines for readability
  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|h[1-6]|tr|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  // Decode HTML entities
  cleaned = decodeHtmlEntities(cleaned);

  // Normalize whitespace
  const transcript = normalizeTranscript(cleaned);

  if (!transcript || transcript.length < 50) {
    return {
      error:
        "The extracted transcript appears too short or empty. The page may load transcripts dynamically via JavaScript.",
    };
  }

  return { transcript, title };
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

// ── Browserless (headless browser) approach ───────────────────────────────────

/**
 * Extract transcript using an external headless browser service (Browserless.io).
 * This handles JS-rendered pages that the direct fetch cannot parse.
 */
async function extractTranscriptViaBrowser(
  url: string,
  vendor: VendorConfig,
  serviceUrl: string,
): Promise<ExtractionResult> {
  const serviceToken = process.env.BROWSER_SERVICE_TOKEN;
  const startTime = Date.now();

  const waitSelector = vendor.waitSelector || "[class*='transcript']";
  const waitTimeout = vendor.waitTimeout ?? 15_000;
  const extractionScript = getExtractionScript(vendor);

  const endpoint = serviceUrl.replace(/\/+$/, "") + "/chrome/function";

  console.log(`[extract-transcript:browser] Starting extraction`, {
    vendor: vendor.id,
    url,
    endpoint,
    waitSelector,
    waitTimeout,
    hasToken: !!serviceToken,
  });

  const browserPayload = {
    code: buildBrowserFunction(url, waitSelector, waitTimeout, extractionScript),
    context: { url, vendor: vendor.id },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (serviceToken) {
      headers["Authorization"] = `Bearer ${serviceToken}`;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(browserPayload),
      signal: controller.signal,
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      const responseBody = await res.text().catch(() => "(could not read response body)");
      console.error(`[extract-transcript:browser] HTTP error`, {
        vendor: vendor.id,
        url,
        status: res.status,
        statusText: res.statusText,
        elapsed: `${elapsed}ms`,
        responseHeaders: Object.fromEntries(res.headers.entries()),
        responseBody: responseBody.substring(0, 1000),
      });

      if (res.status === 401 || res.status === 403) {
        return {
          error: `Browser service auth failed (HTTP ${res.status}). Check BROWSER_SERVICE_TOKEN.`,
        };
      }
      return {
        error: `Browser service returned HTTP ${res.status}. Please paste your transcript manually.`,
      };
    }

    const data = await res.json();
    const elapsed2 = Date.now() - startTime;

    if (data.error) {
      console.warn(`[extract-transcript:browser] Extraction script returned error`, {
        vendor: vendor.id,
        url,
        elapsed: `${elapsed2}ms`,
        error: data.error,
      });
      return { error: data.error };
    }

    const rawLength = (data.transcript || "").length;
    const transcript = normalizeTranscript(data.transcript || "");

    if (!transcript || transcript.length < 50) {
      console.warn(`[extract-transcript:browser] Transcript too short`, {
        vendor: vendor.id,
        url,
        elapsed: `${elapsed2}ms`,
        rawLength,
        normalizedLength: transcript.length,
        preview: transcript.substring(0, 200),
      });
      return {
        error:
          "The extracted transcript appears too short or empty. The page may require login, or the transcript is not publicly visible.",
      };
    }

    console.log(`[extract-transcript:browser] Success`, {
      vendor: vendor.id,
      url,
      elapsed: `${elapsed2}ms`,
      transcriptLength: transcript.length,
      title: data.title || "(none)",
    });

    return { transcript, title: data.title || undefined };
  } catch (err) {
    const elapsed = Date.now() - startTime;

    if (err instanceof DOMException && err.name === "AbortError") {
      console.error(`[extract-transcript:browser] Timed out after ${elapsed}ms`, {
        vendor: vendor.id,
        url,
      });
      return {
        error:
          "Transcript extraction timed out after 45 seconds. Please paste your transcript manually.",
      };
    }

    console.error(`[extract-transcript:browser] Unexpected error`, {
      vendor: vendor.id,
      url,
      elapsed: `${elapsed}ms`,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return {
      error:
        "Unexpected error during transcript extraction. Please paste your transcript manually.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Build the self-contained JavaScript function that Browserless will execute.
 */
function buildBrowserFunction(
  url: string,
  waitSelector: string,
  waitTimeout: number,
  extractionScript: string,
): string {
  return `
    module.exports = async ({ page }) => {
      await page.goto(${JSON.stringify(url)}, { waitUntil: "networkidle2", timeout: 30000 });

      try {
        await page.waitForSelector(${JSON.stringify(waitSelector)}, { timeout: ${waitTimeout} });
      } catch {
        // Check if we landed on a login page
        const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
        if (/sign.?in|log.?in|authenticate/i.test(pageText)) {
          return { error: "This link appears to require login. Please open the call, copy the transcript, and paste it below." };
        }
        return { error: "Could not find transcript content on this page. The page structure may have changed." };
      }

      // Small delay to let lazy-loaded content settle
      await new Promise(r => setTimeout(r, 2000));

      const result = await page.evaluate(() => {
        ${extractionScript}
      });

      return result;
    };
  `;
}

/**
 * Clean up extracted transcript text.
 */
function normalizeTranscript(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n") // trailing whitespace on lines
    .replace(/[ \t]+/g, " ") // collapse horizontal whitespace
    .replace(/\n{3,}/g, "\n\n") // collapse 3+ newlines to 2
    .trim();
}
