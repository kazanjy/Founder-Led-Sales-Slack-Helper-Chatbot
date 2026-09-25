import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { scanFutureMeetingsForUser } from "@/lib/deals/scan-future-meetings";

export const maxDuration = 300;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const result = await scanFutureMeetingsForUser(user.id);
    // Surface the dealIds that picked up new meetings so the client can
    // immediately fire the existing bulk-analyze SSE endpoint and show
    // live re-analysis progress. We don't kick the analyses off here —
    // 30+ deals × ~30s would blow past the route's 300s ceiling, and
    // the client experience is better with the streaming progress
    // banner anyway.
    const dealsNeedingAnalysis = result.perDeal
      .filter((d) => d.added > 0)
      .map((d) => d.dealId);
    return NextResponse.json({ ...result, dealsNeedingAnalysis });
  } catch (err) {
    console.error("[scan-future-meetings/sweep] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
