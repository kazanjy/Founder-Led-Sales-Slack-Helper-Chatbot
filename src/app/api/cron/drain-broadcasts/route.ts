import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runCampaign, MissingUserTokenError } from "@/lib/broadcast/send";

/**
 * GET /api/cron/drain-broadcasts
 *
 * Vercel Cron entry point. Runs every minute (see vercel.json), finds
 * BroadcastCampaign rows whose scheduledFor has arrived, and drives each
 * to completion via the shared runCampaign helper.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` on
 * every invocation. We require that header even in development so we
 * don't accidentally let an unauthenticated request trigger a wave of
 * outbound Slack messages.
 *
 * Concurrency safety: each candidate campaign is moved from "scheduled"
 * to "sending" via an atomic CAS updateMany filtered on the prior
 * status, so two overlapping cron ticks never both grab the same
 * campaign. A campaign that fails the CAS is silently skipped — the
 * other tick has it.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await prisma.broadcastCampaign.findMany({
    where: { status: "scheduled", scheduledFor: { lte: now } },
    select: { id: true },
    // Cap per-tick work so a backlog can't bury Slack's rate limit. The
    // unfinished tail rolls over to the next minute's tick.
    take: 25,
  });

  const results: Array<{
    campaignId: string;
    status: "claimed" | "skipped" | "failed";
    sent?: number;
    failed?: number;
    error?: string;
  }> = [];

  for (const c of due) {
    // CAS: only one tick wins the right to drive this campaign.
    const claimed = await prisma.broadcastCampaign.updateMany({
      where: { id: c.id, status: "scheduled" },
      data: { status: "sending", startedAt: new Date() },
    });
    if (claimed.count === 0) {
      results.push({ campaignId: c.id, status: "skipped" });
      continue;
    }

    try {
      const { sent, failed } = await runCampaign(c.id);
      results.push({ campaignId: c.id, status: "claimed", sent, failed });
    } catch (err) {
      // Either path marks the campaign failed and stops retrying — the
      // distinction matters only for the log so an admin scanning cron
      // output can see "this is a missing-user-token issue" at a glance.
      const isMissingToken = err instanceof MissingUserTokenError;
      await prisma.broadcastCampaign.update({
        where: { id: c.id },
        data: { status: "failed", completedAt: new Date() },
      });
      results.push({
        campaignId: c.id,
        status: "failed",
        error: isMissingToken
          ? "missing_user_token"
          : err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ranAt: now.toISOString(), results });
}
