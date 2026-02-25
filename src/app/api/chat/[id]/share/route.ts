import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/chat/[id]/share
 * Share a chat with a specific email address
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: conversationId } = await params;
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Verify user owns the conversation
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, title: true, firstMessagePreview: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    if (conversation.userId !== user.id) {
      return NextResponse.json(
        { error: "You can only share your own chats" },
        { status: 403 }
      );
    }

    // Don't allow sharing to yourself
    const userEmail = user.email || user.slackEmail;
    if (normalizedEmail === userEmail?.toLowerCase()) {
      return NextResponse.json(
        { error: "You cannot share a chat with yourself" },
        { status: 400 }
      );
    }

    // Check if recipient exists (for resolving sharedToUserId)
    const recipient = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { slackEmail: normalizedEmail },
          { secondaryEmails: { has: normalizedEmail } },
        ],
      },
      select: { id: true },
    });

    // Create or update the share
    const share = await prisma.chatShare.upsert({
      where: {
        conversationId_sharedToEmail: {
          conversationId,
          sharedToEmail: normalizedEmail,
        },
      },
      update: {
        // Re-share: update timestamp and recipient if they now have an account
        sharedToUserId: recipient?.id || null,
        createdAt: new Date(),
      },
      create: {
        conversationId,
        sharedByUserId: user.id,
        sharedToEmail: normalizedEmail,
        sharedToUserId: recipient?.id || null,
      },
      include: {
        sharedToUser: {
          select: { name: true, email: true, slackEmail: true },
        },
      },
    });

    console.log("[share] Created share:", share.id, "to:", share.sharedToEmail, "hasAccount:", !!share.sharedToUserId);

    return NextResponse.json({
      success: true,
      share: {
        id: share.id,
        email: share.sharedToEmail,
        recipientName: share.sharedToUser?.name || null,
        hasAccount: !!share.sharedToUserId,
        createdAt: share.createdAt,
      },
    });
  } catch (error) {
    console.error("Share chat error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/chat/[id]/share
 * List who a chat is shared with
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: conversationId } = await params;

    // Verify user owns the conversation
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    if (conversation.userId !== user.id) {
      return NextResponse.json(
        { error: "You can only view shares for your own chats" },
        { status: 403 }
      );
    }

    const shares = await prisma.chatShare.findMany({
      where: { conversationId },
      include: {
        sharedToUser: {
          select: { name: true, email: true, slackEmail: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      shares: shares.map((share) => ({
        id: share.id,
        email: share.sharedToEmail,
        recipientName: share.sharedToUser?.name || null,
        recipientAvatar: share.sharedToUser?.avatarUrl || null,
        hasAccount: !!share.sharedToUserId,
        createdAt: share.createdAt,
      })),
    });
  } catch (error) {
    console.error("Get shares error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/chat/[id]/share
 * Unshare a chat from a specific email
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: conversationId } = await params;
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Verify user owns the conversation
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    if (conversation.userId !== user.id) {
      return NextResponse.json(
        { error: "You can only unshare your own chats" },
        { status: 403 }
      );
    }

    // Delete the share
    await prisma.chatShare.deleteMany({
      where: {
        conversationId,
        sharedToEmail: normalizedEmail,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unshare chat error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
