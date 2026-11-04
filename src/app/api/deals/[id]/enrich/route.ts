import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enrichDeal } from "@/lib/deals/enrich";

// Manual / on-validate deal enrichment. Pulls last 30d of calendar
// events + recorder calls matching the deal's domain, PDL-enriches
// every external attendee, and seeds DealParticipants + timeline
// entries. Idempotent — safe to retry.
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const summary = await enrichDeal(user.id, id);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[enrich] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Enrichment failed" },
      { status: 500 }
    );
  }
}
