import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/conversations - List user's conversations
 * Query params:
 *   - archived: "true" to show only archived, "false" or omit for non-archived
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const showArchived = searchParams.get("archived") === "true";

  const conversations = await prisma.conversation.findMany({
    where: {
      userId: user.id,
      archived: showArchived,
    },
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
      archived: true,
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
