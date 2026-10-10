import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * PATCH /api/coaching/comments/[id]
 * Body: { body: string }
 * Edits a comment's body. Only the author can edit. Sets editedAt
 * the first time the body actually changes.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.coachingComment.findUnique({
    where: { id },
    select: { id: true, authorId: true, body: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (existing.authorId !== user.id) {
    return NextResponse.json({ error: "Only the author can edit" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const body = (payload as { body?: unknown } | null)?.body;
  if (typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  const trimmed = body.trim();

  const comment = await prisma.coachingComment.update({
    where: { id },
    data: {
      body: trimmed,
      // Only stamp editedAt when the content actually changes — a
      // re-save with identical text shouldn't make the row look edited.
      editedAt: trimmed === existing.body ? undefined : new Date(),
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      updatedAt: true,
      editedAt: true,
      author: {
        select: {
          id: true,
          name: true,
          slackUserName: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  });

  return NextResponse.json({ comment });
}

/**
 * DELETE /api/coaching/comments/[id]
 * Hard-delete. Only the author can delete.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.coachingComment.findUnique({
    where: { id },
    select: { authorId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (existing.authorId !== user.id) {
    return NextResponse.json({ error: "Only the author can delete" }, { status: 403 });
  }

  await prisma.coachingComment.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
