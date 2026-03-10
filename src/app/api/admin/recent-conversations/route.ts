import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        source: "WEB",
        archived: false,
      },
      orderBy: { lastMessageAt: "desc" },
      take: 20,
      select: {
        id: true,
        title: true,
        firstMessagePreview: true,
        messageCount: true,
        createdAt: true,
        lastMessageAt: true,
        source: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            slackUserName: true,
            avatarUrl: true,
            workspace: {
              select: {
                slackTeamName: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("Admin recent conversations error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
