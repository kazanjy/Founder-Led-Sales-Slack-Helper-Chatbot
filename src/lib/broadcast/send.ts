import { prisma } from "@/lib/db";
import { getSlackClient, sendSlackMessage } from "@/lib/slack/client";

/**
 * Drive a single BroadcastCampaign to completion: load its pending
 * BroadcastDelivery rows, post the campaign body to Slack for each, write
 * the per-channel result back to the delivery row, then mark the
 * campaign done. Safe to call from the POST handler (synchronous "send
 * now") and the cron worker ("send later"). Idempotent at the
 * BroadcastDelivery level because we only touch rows still in "pending".
 *
 * Caller is responsible for moving the campaign into "sending" first.
 * For send-now this is the create flow; for the cron drainer it's a CAS
 * update from "scheduled" → "sending" so two ticks can't race.
 */
export async function runCampaign(campaignId: string): Promise<{
  sent: number;
  failed: number;
}> {
  const campaign = await prisma.broadcastCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      body: true,
      status: true,
      workspace: { select: { botToken: true } },
      deliveries: {
        where: { status: "pending" },
        select: { id: true, channelClaim: { select: { slackChannelId: true } } },
      },
    },
  });
  if (!campaign) throw new Error(`runCampaign: campaign ${campaignId} not found`);
  if (campaign.status !== "sending") {
    throw new Error(`runCampaign: campaign ${campaignId} is in status "${campaign.status}", expected "sending"`);
  }

  const client = getSlackClient(campaign.workspace.botToken);

  let sent = 0;
  let failed = 0;
  // Sequential, not parallel, to stay under Slack's per-workspace
  // chat.postMessage rate limit (~50/min Tier 3). At one channel per
  // ~150ms we're comfortably under; if we ever push hundreds of channels
  // we should add a deliberate sleep + 429 handling here.
  for (const d of campaign.deliveries) {
    try {
      const ts = await sendSlackMessage(client, d.channelClaim.slackChannelId, campaign.body);
      await prisma.broadcastDelivery.update({
        where: { id: d.id },
        data: { status: "sent", slackMessageTs: ts ?? null, sentAt: new Date() },
      });
      sent++;
    } catch (err) {
      await prisma.broadcastDelivery.update({
        where: { id: d.id },
        data: {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        },
      });
      failed++;
    }
  }

  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: { status: "done", completedAt: new Date() },
  });

  return { sent, failed };
}
