import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/conversations/[id] - Get conversation with messages
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  const isOwner = conversation.userId === user.id;

  // Check access: owner, same account (non-private), or shared via ChatShare
  if (!isOwner) {
    // Check same-account access
    let hasAccountAccess = false;
    if (user.accountId) {
      const convOwner = await prisma.user.findUnique({
        where: { id: conversation.userId },
        select: { accountId: true },
      });
      if (convOwner?.accountId === user.accountId && !conversation.isPrivate) {
        hasAccountAccess = true;
      }
    }

    // Check ChatShare access
    const hasShareAccess = !hasAccountAccess && await prisma.chatShare.findFirst({
      where: {
        conversationId: id,
        OR: [
          { sharedToUserId: user.id },
          ...(user.email ? [{ sharedToEmail: user.email.toLowerCase() }] : []),
        ],
      },
    });

    if (!hasAccountAccess && !hasShareAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Track view for non-owner access
    await prisma.chatView.upsert({
      where: { userId_conversationId: { userId: user.id, conversationId: id } },
      update: { viewedAt: new Date() },
      create: { userId: user.id, conversationId: id },
    }).catch(() => {}); // Non-critical
  }

  return NextResponse.json({
    conversation,
    isOwner,
    readOnly: !isOwner,
  });
}

/**
 * DELETE /api/conversations/[id] - Delete a conversation
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  if (conversation.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.conversation.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

/**
 * PATCH /api/conversations/[id] - Update conversation (archive/unarchive)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const conversation = await prisma.conversation.findUnique({
    where: { id },
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  if (conversation.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validate mode if provided
  const validModes = ["CHATBASE", "DIRECT"];
  const newMode = body.mode && validModes.includes(body.mode) ? body.mode : undefined;

  // Allow updating archived status, title, mode, projectId, privacy, and account sharing
  const updatedConversation = await prisma.conversation.update({
    where: { id },
    data: {
      archived: body.archived ?? conversation.archived,
      title: body.title !== undefined ? body.title : conversation.title,
      ...(newMode ? { mode: newMode } : {}),
      ...(body.projectId !== undefined ? { projectId: body.projectId || null } : {}),
      ...(body.isPrivate !== undefined ? { isPrivate: body.isPrivate } : {}),
      ...(body.sharedWithAccount !== undefined ? { sharedWithAccount: body.sharedWithAccount } : {}),
    },
    select: {
      id: true,
      archived: true,
      title: true,
      mode: true,
      projectId: true,
      isPrivate: true,
      sharedWithAccount: true,
    },
  });

  return NextResponse.json({ conversation: updatedConversation });
}
