import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { applyDealDisposition } from "@/lib/deals/slack-disposition";

/**
 * GET /deals/[id]/not-a-deal — the "✕ Not a deal" link on Slack stub
 * posts. Dismisses the deal (with triage-override bookkeeping) and
 * lands on the deal page so the founder sees the dismissed pill.
 * Unauthenticated hits (Slack's link crawler) redirect without
 * touching anything.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const dealUrl = new URL(`/deals/${id}`, request.nextUrl.origin);
  const user = await getCurrentUser();
  if (user) {
    try {
      await applyDealDisposition(user.id, user.accountId ?? null, id, "dismiss");
    } catch (err) {
      console.error(`[not-a-deal] dismiss failed for ${id}:`, err);
    }
  }
  return NextResponse.redirect(dealUrl);
}
