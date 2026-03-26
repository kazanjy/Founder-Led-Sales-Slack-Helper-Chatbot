import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { crawlWebsiteForContext } from "@/lib/narrative-prefill/crawl-website";

export const maxDuration = 120;

/**
 * POST /api/sales-narrative/precrawl
 * Crawls a website and returns the content so the client can pass it
 * directly to the prefill endpoint, avoiding a second crawl.
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
    console.log(`[Precrawl] Starting crawl for ${url}`);

    const result = await crawlWebsiteForContext(url);
    console.log(`[Precrawl] Crawl complete: ${result.urls.length} pages, ${result.text.length} chars`);

    return NextResponse.json({
      status: "completed",
      crawlText: result.text,
      crawlUrls: result.urls,
    });
  } catch (error) {
    console.error("[Precrawl] Error:", error);
    return NextResponse.json({ error: "Crawl failed" }, { status: 500 });
  }
}
