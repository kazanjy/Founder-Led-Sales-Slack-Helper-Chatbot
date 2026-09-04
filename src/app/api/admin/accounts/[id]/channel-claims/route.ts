import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { syncChannelClaim } from "@/lib/slack/channels";

/**
 * POST /api/admin/accounts/[id]/channel-claims
 * Create a channel claim for an account.
 * Body: { slackChannelId, slackChannelName?, workspaceId, claimedByUserId }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: accountId } = await params;
    const body = await request.json();
    const { slackChannelId, slackChannelName, workspaceId, claimedByUserId } = body;

    if (!slackChannelId || !workspaceId || !claimedByUserId) {
      return NextResponse.json(
        { error: "slackChannelId, workspaceId, and claimedByUserId are required" },
        { status: 400 }
      );
    }

    // Verify account exists
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Verify workspace exists
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Verify user exists and belongs to the account
    const user = await prisma.user.findUnique({ where: { id: claimedByUserId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (user.accountId !== accountId) {
      return NextResponse.json(
        { error: "User does not belong to this account" },
        { status: 400 }
      );
    }

    // Check if channel is already claimed
    const existingClaim = await prisma.channelClaim.findUnique({
      where: { slackChannelId },
    });
    if (existingClaim) {
      return NextResponse.json(
        { error: "This channel is already claimed by another account" },
        { status: 409 }
      );
    }

    const claim = await prisma.channelClaim.create({
      data: {
        slackChannelId,
        slackChannelName: slackChannelName || null,
        workspaceId,
        accountId,
        claimedByUserId,
      },
      include: {
        claimedBy: {
          select: { id: true, name: true, email: true, slackUserName: true },
        },
        workspace: {
          select: { id: true, slackTeamName: true },
        },
      },
    });

    // Fire-and-forget backfill: pull channel name + latest-message ts from
    // Slack so the admin UI never shows a bare channel ID.
    void syncChannelClaim(claim.id);

    return NextResponse.json({ claim });
  } catch (error) {
    console.error("Admin create channel claim error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/accounts/[id]/channel-claims
 * Remove a channel claim.
 * Query param: ?claimId=...
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: accountId } = await params;
    const claimId = request.nextUrl.searchParams.get("claimId");

    if (!claimId) {
      return NextResponse.json({ error: "claimId is required" }, { status: 400 });
    }

    // Verify the claim belongs to this account
    const claim = await prisma.channelClaim.findUnique({ where: { id: claimId } });
    if (!claim) {
      return NextResponse.json({ error: "Channel claim not found" }, { status: 404 });
    }
    if (claim.accountId !== accountId) {
      return NextResponse.json(
        { error: "Channel claim does not belong to this account" },
        { status: 400 }
      );
    }

    await prisma.channelClaim.delete({ where: { id: claimId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin delete channel claim error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
