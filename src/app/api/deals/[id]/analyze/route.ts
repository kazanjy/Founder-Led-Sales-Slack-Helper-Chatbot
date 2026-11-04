import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runDealAnalysis, DealNotFoundError } from "@/lib/deals/analyze";

// Bumped from 120s. gpt-5.5 with a ~30K-char deal context + the
// re-analysis comparison block normally returns in 30-90s, but tail
// latency from OpenAI can push past 120s — and when Vercel kills
// the function mid-await none of the try/catch blocks fire, so
// failures land with zero log output. 300s is a hard ceiling; an
// explicit AbortController inside runDealAnalysis surfaces slow
// runs as logged errors before the function gets terminated.
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now();
  let dealId = "";
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { id } = await params;
    dealId = id;
    console.log(`[deals/analyze ${startedAt}] start user=${user.id} deal=${id}`);
    const result = await runDealAnalysis(user.id, id);
    console.log(`[deals/analyze ${startedAt}] done deal=${id} in ${Date.now() - startedAt}ms`);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DealNotFoundError) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    console.error(`[deals/analyze ${startedAt}] failed deal=${dealId} after ${Date.now() - startedAt}ms:`, error);
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted
          ? "Analysis timed out. Try again — if it keeps happening on the same deal, the timeline may be too long."
          : "Failed to analyze deal",
      },
      { status: aborted ? 504 : 500 }
    );
  }
}
