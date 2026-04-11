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

  const selectFields = {
    id: true,
    userId: true,
    source: true,
    title: true,
    firstMessagePreview: true,
    messageCount: true,
    createdAt: true,
    lastMessageAt: true,
    slackChannelId: true,
    archived: true,
    attachmentsIncluded: true,
    imagesIncluded: true,
    mode: true,
    projectId: true,
    isPrivate: true,
    sharedWithAccount: true,
    user: { select: { id: true, name: true, email: true, slackUserName: true } },
  };

  // User's own conversations
  const ownConversations = await prisma.conversation.findMany({
    where: {
      userId: user.id,
      archived: showArchived,
    },
    orderBy: { lastMessageAt: "desc" },
    select: selectFields,
  });

  // Account teammates' conversations shared with account
  let teamConversations: typeof ownConversations = [];
  if (user.accountId && !showArchived) {
    teamConversations = await prisma.conversation.findMany({
      where: {
        user: { accountId: user.accountId },
        userId: { not: user.id },
        sharedWithAccount: true,
        isPrivate: false,
        archived: false,
      },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
      select: selectFields,
    });
  }

  return NextResponse.json({
    conversations: ownConversations,
    teamConversations,
  });
}

/**
 * POST /api/conversations - Create a new web conversation
 * Optional body: { mode: "CHATBASE" | "DIRECT" }
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse optional body for mode
  let mode: "CHATBASE" | "DIRECT" = "CHATBASE";
  try {
    const body = await request.json();
    if (body.mode === "DIRECT") {
      mode = "DIRECT";
    }
  } catch {
    // No body or invalid JSON — use defaults
  }

  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      source: "WEB",
      mode,
    },
  });

  return NextResponse.json({ conversation });
}
