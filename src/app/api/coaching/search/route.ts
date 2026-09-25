import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/coaching/search?q=…&userId=…
 * Searches the user's coaching goals, tasks, and subtasks for the
 * query string against title + description (case-insensitive
 * contains). Returns up to ~50 results, active items first, then by
 * recency. Used by the search box in the Goals & Tasks header of the
 * coaching-history page.
 *
 * Cross-account viewing: if a `userId` query param is provided and the
 * caller and target are in the same account, the search runs against
 * that user's data (mirrors /api/coaching/goals behavior).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const targetUserId = request.nextUrl.searchParams.get("userId");
  let userId = user.id;
  if (targetUserId && targetUserId !== user.id && user.accountId) {
    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, accountId: user.accountId },
      select: { id: true },
    });
    if (targetUser) userId = targetUser.id;
  }

  const where = {
    userId,
    OR: [
      { title: { contains: q, mode: "insensitive" as const } },
      { description: { contains: q, mode: "insensitive" as const } },
    ],
  };

  const [goals, tasks] = await Promise.all([
    prisma.coachingGoal.findMany({
      where,
      take: 50,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, title: true, description: true,
        status: true, statusChangedAt: true, createdAt: true,
        sessionId: true,
        session: { select: { id: true, title: true, sessionDate: true } },
      },
    }),
    prisma.coachingTask.findMany({
      where,
      take: 100,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, title: true, description: true,
        status: true, statusChangedAt: true, createdAt: true,
        parentTaskId: true,
        goal: {
          select: {
            id: true, title: true, sessionId: true,
            session: { select: { id: true, title: true, sessionDate: true } },
          },
        },
        parentTask: { select: { id: true, title: true } },
      },
    }),
  ]);

  type Result = {
    kind: "goal" | "task" | "subtask";
    id: string;
    title: string;
    snippet: string | null;
    status: string;
    completedAt: string | null;
    createdAt: string;
    sessionId: string;
    sessionTitle: string | null;
    sessionDate: string | null;
    goalTitle?: string;
    parentTaskTitle?: string;
  };

  const results: Result[] = [];

  for (const g of goals) {
    results.push({
      kind: "goal",
      id: g.id,
      title: g.title,
      snippet: g.description ? g.description.slice(0, 140) : null,
      status: g.status,
      completedAt: g.statusChangedAt?.toISOString() ?? null,
      createdAt: g.createdAt.toISOString(),
      sessionId: g.sessionId,
      sessionTitle: g.session?.title ?? null,
      sessionDate: g.session?.sessionDate.toISOString() ?? null,
    });
  }

  for (const t of tasks) {
    results.push({
      kind: t.parentTaskId ? "subtask" : "task",
      id: t.id,
      title: t.title,
      snippet: t.description ? t.description.slice(0, 140) : null,
      status: t.status,
      completedAt: t.statusChangedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      sessionId: t.goal.sessionId,
      sessionTitle: t.goal.session?.title ?? null,
      sessionDate: t.goal.session?.sessionDate.toISOString() ?? null,
      goalTitle: t.goal.title,
      parentTaskTitle: t.parentTask?.title ?? undefined,
    });
  }

  // Active items first, then by recency. Most users searching "did we
  // do X?" want the still-open ones up top because those are the
  // actionable hits.
  results.sort((a, b) => {
    const aActive = a.status === "active" ? 0 : 1;
    const bActive = b.status === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return NextResponse.json({ results: results.slice(0, 50) });
}
