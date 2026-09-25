/**
 * Backfill ChannelClaim.slackChannelName (and lastMessageAt, opportunistically)
 * for existing rows that were claimed without a name or have never had a
 * message event fire.
 *
 * Run with: npx ts-node scripts/backfill-channel-metadata.ts
 */

import { PrismaClient } from "@prisma/client";
import { syncChannelClaim } from "../src/lib/slack/channels";

const prisma = new PrismaClient();

async function main() {
  const claims = await prisma.channelClaim.findMany({
    where: {
      OR: [{ slackChannelName: null }, { lastMessageAt: null }],
    },
    select: { id: true, slackChannelId: true, slackChannelName: true, lastMessageAt: true },
  });

  console.log(`Found ${claims.length} channel claim(s) needing backfill.`);
  if (claims.length === 0) return;

  let nameBackfilled = 0;
  let activityBackfilled = 0;

  for (const claim of claims) {
    await syncChannelClaim(claim.id);

    const after = await prisma.channelClaim.findUnique({
      where: { id: claim.id },
      select: { slackChannelName: true, lastMessageAt: true },
    });
    if (!claim.slackChannelName && after?.slackChannelName) nameBackfilled++;
    if (!claim.lastMessageAt && after?.lastMessageAt) activityBackfilled++;

    console.log(
      `  ${claim.slackChannelId}: name=${after?.slackChannelName ?? "(still null)"}, ` +
        `lastMessageAt=${after?.lastMessageAt?.toISOString() ?? "(still null)"}`
    );

    // Be kind to Slack's Tier 3 rate limit (~50/min). The WebClient
    // auto-retries on 429, but a small gap keeps us well under the ceiling.
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nDone. Names backfilled: ${nameBackfilled}. Activity backfilled: ${activityBackfilled}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
