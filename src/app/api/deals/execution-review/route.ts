import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getExecutionReviewData } from "@/lib/deals/execution-review";

/**
 * GET /api/deals/execution-review — the overlay's data: overdue tasks
 * + quiet deals (no activity ≥7 days, still in play). Deterministic;
 * no LLM cost. Per-deal proposals are a separate explicit POST.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const data = await getExecutionReviewData(user.id);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[execution-review] GET failed:", err);
    return NextResponse.json({ error: "Failed to load review" }, { status: 500 });
  }
}
