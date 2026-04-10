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
      attachmentsIncluded: true,
      imagesIncluded: true,
      mode: true,
      projectId: true,
      isPrivate: true,
      sharedWithAccount: true,
    },
  });

  return NextResponse.json({ conversations });
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
