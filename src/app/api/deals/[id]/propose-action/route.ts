import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { proposeDealAction } from "@/lib/deals/execution-review";

export const maxDuration = 120;

/**
 * POST /api/deals/[id]/propose-action — LLM recommendation for a
 * quiet deal: send_message (with a tone-compliant draft), close_lost,
 * or wait. Nothing is persisted — the overlay's action buttons commit
 * via the existing task-create / execute / deal PATCH endpoints.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    const proposal = await proposeDealAction(user.id, id);
    if (!proposal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    return NextResponse.json(proposal);
  } catch (err) {
    console.error("[propose-action] failed:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Proposal failed", detail: detail.slice(0, 300) },
      { status: 500 }
    );
  }
}
