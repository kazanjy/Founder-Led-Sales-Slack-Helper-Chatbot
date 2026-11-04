/**
 * ScreenshotOne API client for capturing website screenshots.
 * Used to capture prospect homepage aesthetics for brand-matched deck generation.
 *
 * API docs: https://screenshotone.com/docs/getting-started/
 */

const SCREENSHOTONE_API = "https://api.screenshotone.com/take";

export interface ScreenshotOptions {
  /** Full URL to screenshot */
  url: string;
  /** Image format */
  format?: "png" | "jpeg" | "webp";
  /** Viewport width */
  viewportWidth?: number;
  /** Viewport height */
  viewportHeight?: number;
  /** Capture full page (not just viewport) */
  fullPage?: boolean;
  /** Device scale factor */
  deviceScaleFactor?: number;
  /** Delay in ms before capturing (for JS-heavy pages) */
  delay?: number;
  /** Block cookie banners / popups */
  blockCookieBanners?: boolean;
  /** Block ads */
  blockAds?: boolean;
}

export interface ScreenshotResult {
  /** Base64-encoded image data */
  imageBase64: string;
  /** Data URL ready for OpenAI vision */
  dataUrl: string;
  /** Format used */
  format: string;
}

/**
 * Capture a screenshot of a URL using ScreenshotOne API.
 * Returns base64-encoded image data ready for OpenAI vision analysis.
 */
export async function captureScreenshot(options: ScreenshotOptions): Promise<ScreenshotResult> {
  const accessKey = process.env.SCREENSHOTONE_ACCESS_KEY;
  if (!accessKey) {
    throw new Error("SCREENSHOTONE_ACCESS_KEY is not configured");
  }

  const {
    url,
    format = "png",
    viewportWidth = 1280,
    viewportHeight = 900,
    fullPage = false,
    deviceScaleFactor = 1,
    delay = 2000,
    blockCookieBanners = true,
    blockAds = true,
  } = options;

  // Build query params
  const params = new URLSearchParams({
    access_key: accessKey,
    url,
    format,
    viewport_width: String(viewportWidth),
    viewport_height: String(viewportHeight),
    full_page: String(fullPage),
    device_scale_factor: String(deviceScaleFactor),
    delay: String(delay),
    block_cookie_banners: String(blockCookieBanners),
    block_ads: String(blockAds),
    // Ensure page is fully loaded
    block_chats: "true",
    cache: "true",
    cache_ttl: "86400", // 24h cache
  });

  const requestUrl = `${SCREENSHOTONE_API}?${params.toString()}`;
  console.log(`[ScreenshotOne] Capturing: ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const response = await fetch(requestUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`ScreenshotOne API error ${response.status}: ${errorText}`);
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";

    console.log(`[ScreenshotOne] Captured ${url}: ${Math.round(base64.length / 1024)}KB`);

    return {
      imageBase64: base64,
      dataUrl: `data:${mimeType};base64,${base64}`,
      format,
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`ScreenshotOne timeout capturing ${url}`);
    }
    throw error;
  }
}

/**
 * Capture screenshots of multiple URLs in parallel.
 * Returns results in the same order as input URLs, with null for failures.
 */
export async function captureScreenshots(
  urls: string[],
  options?: Partial<ScreenshotOptions>
): Promise<(ScreenshotResult | null)[]> {
  const results = await Promise.allSettled(
    urls.map((url) =>
      captureScreenshot({ ...options, url })
    )
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    console.error(`[ScreenshotOne] Failed to capture ${urls[i]}:`, result.reason);
    return null;
  });
}
