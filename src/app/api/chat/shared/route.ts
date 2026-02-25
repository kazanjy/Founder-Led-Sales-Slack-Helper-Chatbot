import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/chat/shared
 * Get all chats shared with the current user
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEmail = user.email || user.slackEmail;
    if (!userEmail) {
      return NextResponse.json({ sharedChats: [] });
    }

    // Find shares to this user (by email or userId)
    const shares = await prisma.chatShare.findMany({
      where: {
        OR: [
          { sharedToUserId: user.id },
          { sharedToEmail: userEmail.toLowerCase() },
        ],
      },
      include: {
        conversation: {
          select: {
            id: true,
            title: true,
            firstMessagePreview: true,
            messageCount: true,
            lastMessageAt: true,
            createdAt: true,
          },
        },
        sharedByUser: {
          select: {
            id: true,
            name: true,
            email: true,
            slackEmail: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Also update any shares that have our email but not our userId
    const sharesToUpdate = shares.filter(
      (s) => !s.sharedToUserId && s.sharedToEmail === userEmail.toLowerCase()
    );

    if (sharesToUpdate.length > 0) {
      await prisma.chatShare.updateMany({
        where: {
          id: { in: sharesToUpdate.map((s) => s.id) },
        },
        data: { sharedToUserId: user.id },
      });
    }

    return NextResponse.json({
      sharedChats: shares.map((share) => ({
        id: share.conversation.id,
        title: share.conversation.title,
        firstMessagePreview: share.conversation.firstMessagePreview,
        messageCount: share.conversation.messageCount,
        lastMessageAt: share.conversation.lastMessageAt,
        createdAt: share.conversation.createdAt,
        sharedAt: share.createdAt,
        sharedBy: {
          id: share.sharedByUser.id,
          name: share.sharedByUser.name,
          email: share.sharedByUser.email || share.sharedByUser.slackEmail,
          avatarUrl: share.sharedByUser.avatarUrl,
        },
      })),
    });
  } catch (error) {
    console.error("Get shared chats error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
