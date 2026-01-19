import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { randomBytes } from "crypto";

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

    // Verify the conversation belongs to this user
    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Check if already shared
    let sharedConversation = await prisma.sharedConversation.findFirst({
      where: {
        conversationId: id,
        createdByUserId: user.id,
      },
    });

    // If not shared, create a share link
    if (!sharedConversation) {
      const shareCode = randomBytes(8).toString("hex");
      sharedConversation = await prisma.sharedConversation.create({
        data: {
          conversationId: id,
          createdByUserId: user.id,
          shareCode,
        },
      });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
    const shareUrl = `${appUrl}/share/${sharedConversation.shareCode}`;

    return NextResponse.json({ shareUrl, shareCode: sharedConversation.shareCode });
  } catch (error) {
    console.error("Error sharing conversation:", error);
    return NextResponse.json({ error: "Failed to share conversation" }, { status: 500 });
  }
}
