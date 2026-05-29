import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySlackRequest } from "@/lib/slack/verify";
import { getSlackClient } from "@/lib/slack/client";

/**
 * POST /api/slack/interactivity
 *
 * Handles Slack interactive component callbacks (button clicks,
 * select menus, etc.). Currently routes:
 *
 *   action_id = "validate_potential_deal"  → Deal.status = "active"
 *   action_id = "dismiss_potential_deal"   → Deal.status = "dismissed"
 *
 * Configured in Slack app settings → Interactivity & Shortcuts →
 * Request URL = https://<host>/api/slack/interactivity
 */

export async function POST(request: NextRequest) {
  // Slack sends interactive payloads as application/x-www-form-
  // urlencoded with a single `payload` field containing JSON.
  const body = await request.text();

  const timestamp = request.headers.get("x-slack-request-timestamp") || "";
  const signature = request.headers.get("x-slack-signature") || "";
  if (process.env.SLACK_SIGNING_SECRET) {
    if (!verifySlackRequest(body, timestamp, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const params = new URLSearchParams(body);
  const rawPayload = params.get("payload");
  if (!rawPayload) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  let payload: {
    type?: string;
    user?: { id?: string };
    team?: { id?: string };
    response_url?: string;
    actions?: Array<{ action_id?: string; value?: string }>;
    message?: { ts?: string };
    channel?: { id?: string };
  };
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return NextResponse.json({ error: "Invalid payload JSON" }, { status: 400 });
  }

  if (payload.type !== "block_actions") {
    return NextResponse.json({ ok: true });
  }

  const action = payload.actions?.[0];
  const actionId = action?.action_id;
  const dealId = action?.value;
  if (!actionId || !dealId) {
    return NextResponse.json({ ok: true });
  }
  if (actionId !== "validate_potential_deal" && actionId !== "dismiss_potential_deal") {
    return NextResponse.json({ ok: true });
  }

  // Resolve the Slack user → Mikey user → deal owner so a random
  // Slack member can't validate someone else's potential deal.
  const slackUserId = payload.user?.id;
  const slackTeamId = payload.team?.id;
  if (!slackUserId || !slackTeamId) {
    return NextResponse.json({ error: "Missing actor" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId },
    select: { id: true, botToken: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const actingUser = await prisma.user.findFirst({
    where: { workspaceId: workspace.id, slackUserId },
    select: { id: true, accountId: true },
  });
  if (!actingUser) {
    return NextResponse.json({ error: "User not linked" }, { status: 403 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, userId: true, name: true, companyName: true, status: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Same-account members can also act on each other's potential
  // deals so a teammate noticing the alert can clear it. Solo
  // users still get owner-only.
  let allowed = deal.userId === actingUser.id;
  if (!allowed && actingUser.accountId) {
    const owner = await prisma.user.findUnique({
      where: { id: deal.userId },
      select: { accountId: true },
    });
    allowed = !!owner?.accountId && owner.accountId === actingUser.accountId;
  }
  if (!allowed) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const newStatus = actionId === "validate_potential_deal" ? "active" : "dismissed";
  await prisma.deal.update({
    where: { id: dealId },
    data: { status: newStatus },
  });

  // Edit the original message so the buttons disappear and the
  // user sees the resolution inline. Slack lets us update via
  // chat.update against the original message's ts.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";
  const dealUrl = `${appUrl}/deals/${deal.id}`;
  const verb = newStatus === "active" ? "validated" : "dismissed";
  const emoji = newStatus === "active" ? "✅" : "🚫";
  try {
    if (payload.message?.ts && payload.channel?.id) {
      const client = getSlackClient(workspace.botToken);
      await client.chat.update({
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: `${emoji} Potential deal ${verb}: ${deal.companyName}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `${emoji} *${deal.companyName}* — ${verb} by <@${slackUserId}>.\n` +
                `<${dealUrl}|Open deal →>`,
            },
          },
        ],
      });
    }
  } catch (err) {
    console.error("[slack/interactivity] chat.update failed:", err);
  }

  return NextResponse.json({ ok: true });
}
