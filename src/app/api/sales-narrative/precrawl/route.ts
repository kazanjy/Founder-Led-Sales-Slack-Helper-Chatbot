import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { crawlWebsiteForContext, CrawlResult } from "@/lib/narrative-prefill/crawl-website";

export const maxDuration = 120;

/**
 * In-memory cache for pre-crawl results, keyed by `userId:url`.
 * Entries expire after 5 minutes.
 */
const crawlCache = new Map<string, { result: CrawlResult; expiresAt: number }>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getCachedCrawl(userId: string, url: string): CrawlResult | null {
  const key = `${userId}:${url.toLowerCase().replace(/\/+$/, "")}`;
  const entry = crawlCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    crawlCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedCrawl(userId: string, url: string, result: CrawlResult) {
  const key = `${userId}:${url.toLowerCase().replace(/\/+$/, "")}`;
  crawlCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });

  // Evict old entries periodically
  if (crawlCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of crawlCache) {
      if (now > v.expiresAt) crawlCache.delete(k);
    }
  }
}

/**
 * POST /api/sales-narrative/precrawl
 * Kicks off website crawling in advance so results are cached
 * when the user hits "Analyze & Pre-Fill".
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { websiteUrl } = await request.json();
    if (!websiteUrl?.trim()) {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    const url = websiteUrl.trim();

    // Check if already cached
    const cached = getCachedCrawl(user.id, url);
    if (cached) {
      console.log(`[Precrawl] Cache hit for ${url}`);
      return NextResponse.json({ status: "cached", urlCount: cached.urls.length });
    }

    console.log(`[Precrawl] Starting background crawl for ${url}`);
    const result = await crawlWebsiteForContext(url);
    setCachedCrawl(user.id, url, result);

    console.log(`[Precrawl] Crawl complete: ${result.urls.length} pages, ${result.text.length} chars`);
    return NextResponse.json({ status: "completed", urlCount: result.urls.length });
  } catch (error) {
    console.error("[Precrawl] Error:", error);
    return NextResponse.json({ error: "Crawl failed" }, { status: 500 });
  }
}
