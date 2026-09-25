import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

/**
 * Read the admin-configured Slack destination for activity broadcasts.
 * Returns nulls when the feature hasn't been enabled yet.
 */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.globalSettings.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
    select: {
      activityBroadcastWorkspaceId: true,
      activityBroadcastChannelId: true,
      activityBroadcastChannelName: true,
      activityBroadcastLastSentAt: true,
    },
  });

  let workspace: { id: string; slackTeamName: string } | null = null;
  if (settings.activityBroadcastWorkspaceId) {
    const w = await prisma.workspace.findUnique({
      where: { id: settings.activityBroadcastWorkspaceId },
      select: { id: true, slackTeamName: true },
    });
    if (w) workspace = w;
  }

  return NextResponse.json({
    workspaceId: settings.activityBroadcastWorkspaceId,
    channelId: settings.activityBroadcastChannelId,
    channelName: settings.activityBroadcastChannelName,
    lastSentAt: settings.activityBroadcastLastSentAt?.toISOString() ?? null,
    workspace,
  });
}

/**
 * Update the destination. Pass null/empty to clear and disable the
 * feature.
 */
export async function PATCH(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId.length > 0
    ? body.workspaceId
    : null;
  const channelId = typeof body.channelId === "string" && body.channelId.length > 0
    ? body.channelId
    : null;
  const channelName = typeof body.channelName === "string" && body.channelName.length > 0
    ? body.channelName
    : null;

  // Validate workspace exists when set so we don't silently store a
  // dangling pointer that breaks the send flow later.
  if (workspaceId) {
    const exists = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!exists) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 400 });
    }
  }

  // Both workspace and channel must agree — no reason to persist one
  // without the other and no useful failure mode for the send endpoint.
  if ((workspaceId && !channelId) || (!workspaceId && channelId)) {
    return NextResponse.json(
      { error: "Workspace and channel must be set together" },
      { status: 400 }
    );
  }

  await prisma.globalSettings.upsert({
    where: { id: "global" },
    update: {
      activityBroadcastWorkspaceId: workspaceId,
      activityBroadcastChannelId: channelId,
      activityBroadcastChannelName: channelName,
    },
    create: {
      id: "global",
      activityBroadcastWorkspaceId: workspaceId,
      activityBroadcastChannelId: channelId,
      activityBroadcastChannelName: channelName,
    },
  });

  return NextResponse.json({ ok: true });
}
