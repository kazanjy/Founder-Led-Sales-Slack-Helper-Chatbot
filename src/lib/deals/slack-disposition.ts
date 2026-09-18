import { prisma } from "@/lib/db";

/**
 * Link-clickable deal disposition — the web-side twin of the Slack
 * interactivity handler's dismiss/undo actions. Slack stub posts carry
 * plain links (buttons proved unreliable), which land on
 * /deals/[id]/not-a-deal and /deals/[id]/restore; those routes call
 * this and redirect to the deal page. Auth + same-account teammate
 * authorization mirror the interactivity route: an unauthenticated hit
 * (e.g. Slack's unfurl crawler) never mutates anything.
 */
export async function applyDealDisposition(
  actingUserId: string,
  actingAccountId: string | null,
  dealId: string,
  action: "dismiss" | "restore"
): Promise<{ ok: boolean; reason?: string }> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, userId: true, status: true },
  });
  if (!deal) return { ok: false, reason: "not_found" };

  let allowed = deal.userId === actingUserId;
  if (!allowed && actingAccountId) {
    const owner = await prisma.user.findUnique({
      where: { id: deal.userId },
      select: { accountId: true },
    });
    allowed = owner?.accountId === actingAccountId;
  }
  if (!allowed) return { ok: false, reason: "forbidden" };

  if (action === "dismiss") {
    await prisma.deal.update({
      where: { id: dealId },
      data: { status: "dismissed" },
    });
    // Human override of the machine's verdict — record it so the
    // classifier's audit trail (and future tuning) sees the correction.
    await prisma.dealTriage.updateMany({
      where: { dealId, verdict: { in: ["likely_deal", "confirmed_deal"] } },
      data: { overriddenAt: new Date() },
    });
  } else {
    // Restore asserts "this IS a deal" — stronger than the machine's
    // likely, so straight to active (mirrors undo_dismiss_deal).
    await prisma.deal.update({
      where: { id: dealId },
      data: { status: "active" },
    });
    await prisma.dealTriage.updateMany({
      where: { dealId, verdict: { in: ["not_a_deal", "likely_deal"] } },
      data: { overriddenAt: new Date() },
    });
  }
  return { ok: true };
}
