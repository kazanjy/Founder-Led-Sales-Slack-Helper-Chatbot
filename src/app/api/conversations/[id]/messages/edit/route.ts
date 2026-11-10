import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// POST — truncate conversation from a specific message and re-send
// Deletes all messages after the given messageId, then updates the message content
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const { messageId, newContent } = (await request.json()) as {
      messageId: string;
      newContent: string;
    };

    if (!messageId || !newContent?.trim()) {
      return NextResponse.json({ error: "messageId and newContent are required" }, { status: 400 });
    }

    // Verify conversation ownership
    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation || conversation.userId !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Get the target message to verify it exists and belongs to this conversation
    const targetMessage = await prisma.message.findFirst({
      where: { id: messageId, conversationId: id },
    });

    if (!targetMessage) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Delete all messages created after the target message
    await prisma.message.deleteMany({
      where: {
        conversationId: id,
        createdAt: { gt: targetMessage.createdAt },
      },
    });

    // Update the target message with new content
    await prisma.message.update({
      where: { id: messageId },
      data: { content: newContent.trim() },
    });

    // Reset Chatbase conversation ID so the next message starts fresh context
    // (Chatbase can't retroactively remove messages from its state)
    if (conversation.chatbaseConversationId) {
      await prisma.conversation.update({
        where: { id },
        data: { chatbaseConversationId: null },
      });
    }

    // Update message count
    const remainingCount = await prisma.message.count({
      where: { conversationId: id },
    });

    await prisma.conversation.update({
      where: { id },
      data: { messageCount: remainingCount },
    });

    return NextResponse.json({ success: true, messageCount: remainingCount });
  } catch (error) {
    console.error("Error editing message:", error);
    return NextResponse.json({ error: "Failed to edit message" }, { status: 500 });
  }
}
