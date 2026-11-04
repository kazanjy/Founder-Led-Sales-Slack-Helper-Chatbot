import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { runCampaign, MissingUserTokenError } from "@/lib/broadcast/send";

interface DeliveryResult {
  channelClaimId: string;
  channelName: string | null;
  status: "sent" | "failed";
  ts?: string;
  error?: string;
}

/**
 * POST /api/admin/broadcast
 *
 * Body: {
 *   workspaceId: string,
 *   channelClaimIds: string[],
 *   body: string,
 *   scheduledFor?: string  // ISO 8601; absent / past = send now
 *   name?: string          // optional admin label
 * }
 *
 * Always persists a BroadcastCampaign + one BroadcastDelivery per target
 * channel. If scheduledFor is absent or already past, runs the send loop
 * inline and returns per-channel results in the same shape the channels
 * page has always rendered. If scheduledFor is in the future, returns
 * the campaign as "scheduled" and lets /api/cron/drain-broadcasts pick
 * it up at the right time.
 */
export async function POST(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { workspaceId, channelClaimIds, body, scheduledFor, name } = (payload ?? {}) as {
    workspaceId?: string;
    channelClaimIds?: unknown;
    body?: string;
    scheduledFor?: string;
    name?: string;
  };

  if (!workspaceId || typeof workspaceId !== "string") {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }
  if (!Array.isArray(channelClaimIds) || channelClaimIds.length === 0) {
    return NextResponse.json({ error: "channelClaimIds must be a non-empty array" }, { status: 400 });
  }
  if (!body || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  let scheduledForDate: Date | null = null;
  if (scheduledFor) {
    const d = new Date(scheduledFor);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "scheduledFor must be a valid ISO timestamp" }, { status: 400 });
    }
    scheduledForDate = d;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }

  // Preflight: posts go out as the admin, not as the bot. If the admin
  // never granted user_scope (or has revoked it), refuse here with a
  // 412 + actionable code so the composer can render the
  // "Connect Slack" prompt rather than letting the cron worker fail
  // later.
  const adminRecord = await prisma.user.findUnique({
    where: { id: admin.id },
    select: { slackUserToken: true },
  });
  if (!adminRecord?.slackUserToken) {
    return NextResponse.json(
      {
        error: "missing_user_token",
        message: "Connect your Slack with user-scope (Connect Slack on the Channels page) so messages post under your name instead of MikeyBot.",
      },
      { status: 412 }
    );
  }

  // Re-read the claims so the client can't smuggle in IDs from a different
  // workspace.
  const claims = await prisma.channelClaim.findMany({
    where: { id: { in: channelClaimIds as string[] }, workspaceId },
    select: { id: true, slackChannelName: true },
  });
  if (claims.length === 0) {
    return NextResponse.json({ error: "no matching channels in that workspace" }, { status: 400 });
  }

  const isImmediate = !scheduledForDate || scheduledForDate <= new Date();

  // Create the campaign + one delivery per target channel atomically. We
  // open the campaign in "sending" for the immediate path so a concurrent
  // cron tick can't grab it; the runCampaign call below flips it to
  // "done" once it finishes.
  const campaign = await prisma.broadcastCampaign.create({
    data: {
      name: name?.trim() || null,
      workspaceId,
      body,
      scheduledFor: isImmediate ? null : scheduledForDate,
      status: isImmediate ? "sending" : "scheduled",
      startedAt: isImmediate ? new Date() : null,
      createdByAdminId: admin.id,
      deliveries: {
        create: claims.map((c) => ({ channelClaimId: c.id })),
      },
    },
    select: {
      id: true,
      name: true,
      body: true,
      scheduledFor: true,
      status: true,
      createdAt: true,
    },
  });

  if (!isImmediate) {
    return NextResponse.json({ campaign });
  }

  // Run the send loop inline. runCampaign throws only on infrastructure
  // failure (workspace gone, user token revoked between preflight and
  // here, etc.); per-channel failures are recorded on the delivery rows.
  try {
    await runCampaign(campaign.id);
  } catch (err) {
    await prisma.broadcastCampaign.update({
      where: { id: campaign.id },
      data: { status: "failed", completedAt: new Date() },
    });
    if (err instanceof MissingUserTokenError) {
      return NextResponse.json(
        { error: "missing_user_token", message: err.message },
        { status: 412 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  // Re-read the per-channel results in the legacy shape the channels page
  // already knows how to render.
  const finalDeliveries = await prisma.broadcastDelivery.findMany({
    where: { campaignId: campaign.id },
    select: {
      channelClaimId: true,
      status: true,
      slackMessageTs: true,
      error: true,
      channelClaim: { select: { slackChannelName: true } },
    },
  });
  const deliveries: DeliveryResult[] = finalDeliveries.map((d) => ({
    channelClaimId: d.channelClaimId,
    channelName: d.channelClaim.slackChannelName,
    status: d.status === "sent" ? "sent" : "failed",
    ts: d.slackMessageTs ?? undefined,
    error: d.error ?? undefined,
  }));

  return NextResponse.json({ campaign, deliveries });
}

/**
 * GET /api/admin/broadcast?workspaceId=<id>
 *
 * Lists this workspace's recent and upcoming campaigns so the channels
 * page can show a "Scheduled" section + a sent-history view. Caps at 50
 * to keep payloads small; the campaign-detail page is the place for
 * deep history later.
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const [campaigns, currentAdmin] = await Promise.all([
    prisma.broadcastCampaign.findMany({
      where: { workspaceId },
      orderBy: [
        { scheduledFor: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: 50,
      select: {
        id: true,
        name: true,
        body: true,
        scheduledFor: true,
        status: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        createdByAdmin: { select: { id: true, name: true, email: true } },
        _count: { select: { deliveries: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: admin.id },
      select: { id: true, name: true, slackUserName: true, slackUserToken: true },
    }),
  ]);

  // Expose only "do they have a token" + display name, never the token
  // itself. The composer uses this to choose between the "Will post as
  // …" badge and the "Connect Slack" prompt.
  const adminConnection = {
    id: currentAdmin?.id ?? null,
    displayName: currentAdmin?.name || currentAdmin?.slackUserName || null,
    hasUserToken: !!currentAdmin?.slackUserToken,
  };

  return NextResponse.json({ campaigns, adminConnection });
}
