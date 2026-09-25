import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/chat/[id]/clone
 * Clone a chat to the current user's account.
 * Works for both the owner (branching off) and shared-chat recipients.
 * The cloned conversation intentionally has no chatbaseConversationId so
 * that the full message history is sent to Chatbase on the first new message,
 * preserving all prior context in the new branch.
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

    // Get the conversation and verify access
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
          select: { name: true, email: true, slackEmail: true, accountId: true },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // User can clone if they own it, it's shared with them, or it's a
    // non-private chat from someone in their account — the SAME rule
    // the conversation read endpoint uses. Anything you can open you
    // can clone; a viewable chat that 403s on clone is just a trap.
    const isOwner = conversation.userId === user.id;
    const isShared = conversation.chatShares.length > 0;
    const isAccountMate =
      !!user.accountId &&
      conversation.user.accountId === user.accountId &&
      !conversation.isPrivate;

    if (!isOwner && !isShared && !isAccountMate) {
      return NextResponse.json(
        { error: "You don't have access to this chat" },
        { status: 403 }
      );
    }

    // Build the cloned conversation title
    let clonedTitle: string;
    if (isOwner) {
      // Owner cloning their own chat to branch off
      clonedTitle = conversation.title
        ? `${conversation.title} (copy)`
        : "Chat (copy)";
    } else {
      // Cloning a shared chat from someone else
      const originalOwnerName =
        conversation.user.name ||
        conversation.user.email ||
        conversation.user.slackEmail ||
        "Unknown";
      clonedTitle = conversation.title
        ? `${conversation.title} (from ${originalOwnerName})`
        : `Chat from ${originalOwnerName}`;
    }

    // Create a cloned conversation (no chatbaseConversationId — context
    // will be rebuilt from message history on the first new message)
    const clonedConversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        source: "WEB",
        title: clonedTitle,
        firstMessagePreview: conversation.firstMessagePreview,
        messageCount: conversation.messageCount,
        ...(conversation.attachmentsIncluded !== null && {
          attachmentsIncluded: conversation.attachmentsIncluded,
        }),
        ...(conversation.imagesIncluded !== null && {
          imagesIncluded: conversation.imagesIncluded,
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
