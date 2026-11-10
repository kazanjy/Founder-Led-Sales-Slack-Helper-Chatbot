import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

/**
 * PATCH /api/admin/broadcast/[campaignId]
 *
 * Body: { action: "cancel" }
 *
 * Hard-cancels a scheduled campaign. Atomic CAS on status so a cron
 * tick that's already promoted the campaign to "sending" can't be
 * undone halfway through. Pending deliveries get marked "canceled" so
 * the detail page can show what didn't go out.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { campaignId } = await params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = (payload as { action?: string } | null)?.action;
  if (action !== "cancel") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }

  // Only "scheduled" campaigns can be cancelled. updateMany returns the
  // count of rows that matched both the id and the status filter, which
  // gives us a free CAS without a transaction.
  const updated = await prisma.broadcastCampaign.updateMany({
    where: { id: campaignId, status: "scheduled" },
    data: { status: "canceled", completedAt: new Date() },
  });

  if (updated.count === 0) {
    const current = await prisma.broadcastCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!current) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `campaign is in status "${current.status}" and cannot be canceled` },
      { status: 409 }
    );
  }

  await prisma.broadcastDelivery.updateMany({
    where: { campaignId, status: "pending" },
    data: { status: "canceled" },
  });

  return NextResponse.json({ ok: true });
}
