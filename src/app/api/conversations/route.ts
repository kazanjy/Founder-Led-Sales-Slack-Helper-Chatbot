import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/conversations - List user's conversations
 */
export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      source: true,
      title: true,
      firstMessagePreview: true,
      messageCount: true,
      createdAt: true,
      lastMessageAt: true,
      slackChannelId: true,
    },
  });

  return NextResponse.json({ conversations });
}

/**
 * POST /api/conversations - Create a new web conversation
 */
export async function POST() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      source: "WEB",
      // No workspace, channel, or thread for web conversations
    },
  });

  return NextResponse.json({ conversation });
}
