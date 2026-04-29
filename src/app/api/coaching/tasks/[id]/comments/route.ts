import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/coaching/tasks/[id]/comments
 * Lists comments for a single task in chronological order.
 *
 * Auth: only the user who owns the task's parent goal. Multi-user
 * coaching (coach + coachee both commenting) is a follow-up — when
 * we add it, expand this check to also allow account-mates.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const task = await prisma.coachingTask.findUnique({
    where: { id },
    select: { id: true, goal: { select: { userId: true } } },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.goal.userId !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const comments = await prisma.coachingComment.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "asc" },
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

  // Returning the caller's user id alongside the comments so the
  // client can decide which rows are "own" without needing a
  // separate /me round-trip — and without depending on an
  // optional sessionUserId prop that turned out to be undefined
  // in most cases.
  return NextResponse.json({ comments, currentUserId: user.id });
}

/**
 * POST /api/coaching/tasks/[id]/comments
 * Body: { body: string }
 * Creates a new comment authored by the current user.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const task = await prisma.coachingTask.findUnique({
    where: { id },
    select: { id: true, goal: { select: { userId: true } } },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.goal.userId !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
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

  const comment = await prisma.coachingComment.create({
    data: {
      taskId: id,
      authorId: user.id,
      body: body.trim(),
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
