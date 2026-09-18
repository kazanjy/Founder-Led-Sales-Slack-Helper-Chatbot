import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET — list recently viewed teammate chats
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const views = await prisma.chatView.findMany({
      where: { userId: user.id },
      orderBy: { viewedAt: "desc" },
      take: 20,
      include: {
        conversation: {
          select: {
            id: true,
            title: true,
            firstMessagePreview: true,
            lastMessageAt: true,
            userId: true,
            user: {
              select: {
                name: true,
                slackUserName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    const recentlyViewed = views.map((v) => ({
      id: v.conversation.id,
      title: v.conversation.title,
      firstMessagePreview: v.conversation.firstMessagePreview,
      lastMessageAt: v.conversation.lastMessageAt.toISOString(),
      viewedAt: v.viewedAt.toISOString(),
      ownerName: v.conversation.user.name || v.conversation.user.slackUserName || v.conversation.user.email || "Unknown",
    }));

    return NextResponse.json({ recentlyViewed });
  } catch (error) {
    console.error("Error fetching recently viewed:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
