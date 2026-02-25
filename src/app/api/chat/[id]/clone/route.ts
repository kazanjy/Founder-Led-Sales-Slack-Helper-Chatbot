import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/chat/[id]/clone
 * Clone a shared chat to the current user's account
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: conversationId } = await params;
    const userEmail = user.email || user.slackEmail;

    // Get the conversation and verify it's shared with this user
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
        chatShares: {
          where: userEmail
            ? {
                OR: [
                  { sharedToUserId: user.id },
                  { sharedToEmail: userEmail.toLowerCase() },
                ],
              }
            : { sharedToUserId: user.id },
        },
        user: {
          select: { name: true, email: true, slackEmail: true },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // User can clone if they own it OR if it's shared with them
    const isOwner = conversation.userId === user.id;
    const isShared = conversation.chatShares.length > 0;

    if (!isOwner && !isShared) {
      return NextResponse.json(
        { error: "You don't have access to this chat" },
        { status: 403 }
      );
    }

    // If they own it, just return the same conversation
    if (isOwner) {
      return NextResponse.json({
        success: true,
        conversationId: conversation.id,
        message: "This is already your chat",
      });
    }

    // Create a cloned conversation
    const originalOwnerName =
      conversation.user.name ||
      conversation.user.email ||
      conversation.user.slackEmail ||
      "Unknown";

    const clonedConversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        source: "WEB",
        title: conversation.title
          ? `${conversation.title} (from ${originalOwnerName})`
          : `Chat from ${originalOwnerName}`,
        firstMessagePreview: conversation.firstMessagePreview,
        messageCount: conversation.messageCount,
        ...(conversation.attachmentsIncluded !== null && {
          attachmentsIncluded: conversation.attachmentsIncluded,
        }),
      },
    });

    // Clone all messages
    if (conversation.messages.length > 0) {
      await prisma.message.createMany({
        data: conversation.messages.map((msg) => ({
          conversationId: clonedConversation.id,
          userId: msg.role === "USER" ? user.id : null,
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt,
        })),
      });
    }

    return NextResponse.json({
      success: true,
      conversationId: clonedConversation.id,
      message: "Chat cloned successfully",
    });
  } catch (error) {
    console.error("Clone chat error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
