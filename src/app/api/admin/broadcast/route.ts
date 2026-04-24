import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { getSlackClient, sendSlackMessage } from "@/lib/slack/client";

interface DeliveryResult {
  channelClaimId: string;
  channelName: string | null;
  status: "sent" | "failed";
  ts?: string;
  error?: string;
}

// POST /api/admin/broadcast
// Body: { workspaceId: string, channelClaimIds: string[], body: string }
// Posts the same message to every selected channel. Returns per-channel
// status so the UI can show success / failure breakdown.
//
// v1 is synchronous + best-effort: no retry on Slack rate limits, no audit
// log row, no BroadcastCampaign / Delivery persistence. Those are follow-up
// milestones. For now a failed channel just gets a "failed" row in the
// response and the admin retries manually.
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
  const { workspaceId, channelClaimIds, body } = (payload ?? {}) as {
    workspaceId?: string;
    channelClaimIds?: unknown;
    body?: string;
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

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, botToken: true, slackTeamName: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }

  // Re-read the claims from the DB so we don't trust the client about
  // which channels belong to which workspace.
  const claims = await prisma.channelClaim.findMany({
    where: { id: { in: channelClaimIds as string[] }, workspaceId },
    select: { id: true, slackChannelId: true, slackChannelName: true },
  });
  if (claims.length === 0) {
    return NextResponse.json({ error: "no matching channels in that workspace" }, { status: 400 });
  }

  const client = getSlackClient(workspace.botToken);

  // Parallel is fine at small-to-medium volumes. Slack's per-workspace rate
  // limit for chat.postMessage (~50/min for Tier 3) will 429 if we try to
  // blast 100+ channels in one go; when that starts happening we'll add a
  // sequential drain + backoff. For a first cut, failures land in the
  // response with an error message and the admin retries.
  const results = await Promise.allSettled(
    claims.map(async (c): Promise<DeliveryResult> => {
      try {
        const ts = await sendSlackMessage(client, c.slackChannelId, body);
        return {
          channelClaimId: c.id,
          channelName: c.slackChannelName,
          status: "sent",
          ts,
        };
      } catch (err) {
        return {
          channelClaimId: c.id,
          channelName: c.slackChannelName,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  const deliveries: DeliveryResult[] = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          channelClaimId: "unknown",
          channelName: null,
          status: "failed",
          error: String(r.reason),
        }
  );

  return NextResponse.json({ deliveries });
}
