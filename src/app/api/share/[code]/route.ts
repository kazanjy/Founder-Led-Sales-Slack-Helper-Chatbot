import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    // Find the shared conversation
    const sharedConversation = await prisma.sharedConversation.findUnique({
      where: { shareCode: code },
      include: {
        conversation: {
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    if (!sharedConversation) {
      return NextResponse.json({ error: "Shared conversation not found" }, { status: 404 });
    }

    // Check if expired
    if (sharedConversation.expiresAt && new Date() > sharedConversation.expiresAt) {
      return NextResponse.json({ error: "This shared link has expired" }, { status: 410 });
    }

    // Increment view count
    await prisma.sharedConversation.update({
      where: { id: sharedConversation.id },
      data: { viewCount: { increment: 1 } },
    });

    return NextResponse.json({
      conversation: {
        id: sharedConversation.conversation.id,
        title: sharedConversation.conversation.title,
        firstMessagePreview: sharedConversation.conversation.firstMessagePreview,
        messages: sharedConversation.conversation.messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt,
        })),
        createdAt: sharedConversation.conversation.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching shared conversation:", error);
    return NextResponse.json({ error: "Failed to fetch shared conversation" }, { status: 500 });
  }
}
