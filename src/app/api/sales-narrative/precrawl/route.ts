import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { crawlWebsiteForContext } from "@/lib/narrative-prefill/crawl-website";
import { getCachedCrawl, setCachedCrawl } from "@/lib/narrative-prefill/crawl-cache";

export const maxDuration = 120;

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
