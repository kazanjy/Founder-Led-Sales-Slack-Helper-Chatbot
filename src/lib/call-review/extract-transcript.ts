import type { VendorConfig } from "./vendors";
import { getExtractionScript } from "./extraction-strategies";

interface ExtractionSuccess {
  transcript: string;
  title?: string;
}

interface ExtractionError {
  error: string;
}

export type ExtractionResult = ExtractionSuccess | ExtractionError;

/**
 * Extract a transcript from a public share link using an external headless
 * browser service (e.g. Browserless.io).
 *
 * The service navigates to the URL, waits for the transcript DOM to appear,
 * runs a vendor-specific extraction script, and returns the text.
 */
export async function extractTranscriptFromUrl(
  url: string,
  vendor: VendorConfig,
): Promise<ExtractionResult> {
  const serviceUrl = process.env.BROWSER_SERVICE_URL;
  const serviceToken = process.env.BROWSER_SERVICE_TOKEN;

  if (!serviceUrl) {
    return { error: "Transcript extraction service is not configured (BROWSER_SERVICE_URL)." };
  }

  const waitSelector = vendor.waitSelector || "[class*='transcript']";
  const waitTimeout = vendor.waitTimeout ?? 15_000;
  const extractionScript = getExtractionScript(vendor);

  // Build the Browserless.io /chrome/function endpoint payload.
  // This works with Browserless v2 (browserless.io) — the most common
  // hosted headless-browser service. Adjust if using a different provider.
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

    // Browserless v2 hosted service uses /chrome/function path
    const endpoint = serviceUrl.replace(/\/+$/, "") + "/chrome/function";
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(browserPayload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[extract-transcript] Browser service error ${res.status}: ${text}`);

      if (res.status === 401 || res.status === 403) {
        return { error: "Browser service authentication failed. Check BROWSER_SERVICE_TOKEN." };
      }
      return { error: "Transcript extraction service returned an error. Please paste your transcript manually." };
    }

    const data = await res.json();

    if (data.error) {
      return { error: data.error };
    }

    const transcript = normalizeTranscript(data.transcript || "");

    if (!transcript || transcript.length < 50) {
      return {
        error:
          "The extracted transcript appears too short or empty. The page may require login, or the transcript is not publicly visible.",
      };
    }

    return { transcript, title: data.title || undefined };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { error: "Transcript extraction timed out after 45 seconds. Please paste your transcript manually." };
    }
    console.error("[extract-transcript] Unexpected error:", err);
    return { error: "Unexpected error during transcript extraction. Please paste your transcript manually." };
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
    .replace(/[ \t]+\n/g, "\n")      // trailing whitespace on lines
    .replace(/\n{3,}/g, "\n\n")      // collapse 3+ newlines to 2
    .trim();
}
