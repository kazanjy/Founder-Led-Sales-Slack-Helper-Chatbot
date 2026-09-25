import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { applyDealDisposition } from "@/lib/deals/slack-disposition";

/**
 * GET /deals/[id]/restore — the "↩️ Undo — it IS a deal" link on Slack
 * dismissal stubs. Restores the deal to ACTIVE (with triage-override
 * bookkeeping) and lands on the deal page. Unauthenticated hits
 * (Slack's link crawler) redirect without touching anything.
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
      await applyDealDisposition(user.id, user.accountId ?? null, id, "restore");
    } catch (err) {
      console.error(`[restore-deal] restore failed for ${id}:`, err);
    }
  }
  return NextResponse.redirect(dealUrl);
}
