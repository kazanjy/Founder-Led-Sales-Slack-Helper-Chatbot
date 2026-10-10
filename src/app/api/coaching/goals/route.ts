import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const targetUserId = searchParams.get("userId");

    // Allow viewing another user's goals if they're in the same account
    let userId = user.id;
    if (targetUserId && targetUserId !== user.id && user.accountId) {
      const targetUser = await prisma.user.findFirst({
        where: { id: targetUserId, accountId: user.accountId },
        select: { id: true },
      });
      if (targetUser) userId = targetUser.id;
    }

    const where: {
      userId: string;
      status?: string;
      sessionId?: string;
      createdAt?: { lte?: Date; lt?: Date };
      OR?: Array<{ sessionId?: string; createdAt?: { lt?: Date } }>;
    } = { userId };
    if (status) {
      where.status = status;
    }
    const createdBefore = searchParams.get("createdBefore");
    const sessionIdParam = searchParams.get("sessionId");

    // Three filter shapes:
    //   1. sessionId + createdBefore — non-locked session view. Include
    //      this session's own goals (sessionId match) OR earlier-created
    //      active goals (carry-forward from prior sessions). Stops
    //      goals authored in a NEWER session from polluting this view.
    //   2. createdBefore only — locked session snapshot (everything
    //      that existed at lock time).
    //   3. sessionId only — single-session view (rare).
    if (sessionIdParam && createdBefore) {
      where.OR = [
        { sessionId: sessionIdParam },
        { createdAt: { lt: new Date(createdBefore) } },
      ];
    } else if (createdBefore) {
      where.createdAt = { lte: new Date(createdBefore) };
    } else if (sessionIdParam) {
      where.sessionId = sessionIdParam;
    }

    const goals = await prisma.coachingGoal.findMany({
      where,
      orderBy: { order: "asc" },
      include: {
        tasks: {
          orderBy: { order: "asc" },
        },
      },
    });

    // For carry-forward goals (not native to this session) the parent
    // goal might have had tasks added in a NEWER session that we also
    // need to clip — otherwise the user would still see tasks-from-the-
    // future on an older session view. Tasks native to this session's
    // own goals (sessionId match) are kept regardless of createdAt.
    if (sessionIdParam && createdBefore) {
      const cutoff = new Date(createdBefore);
      for (const goal of goals) {
        if (goal.sessionId !== sessionIdParam) {
          goal.tasks = goal.tasks.filter((t) => t.createdAt < cutoff);
        }
      }
    }

    return NextResponse.json({ goals });
  } catch (error) {
    console.error("Error fetching coaching goals:", error);
    return NextResponse.json(
      { error: "Failed to fetch coaching goals" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { sessionId, title, description } = body;

    const maxOrder = await prisma.coachingGoal.aggregate({
      where: { userId: user.id },
      _max: { order: true },
    });

    const order = (maxOrder._max.order ?? -1) + 1;

    const goal = await prisma.coachingGoal.create({
      data: {
        userId: user.id,
        sessionId,
        title,
        description,
        order,
      },
      include: {
        tasks: true,
      },
    });

    return NextResponse.json({ goal });
  } catch (error) {
    console.error("Error creating coaching goal:", error);
    return NextResponse.json(
      { error: "Failed to create coaching goal" },
      { status: 500 }
    );
  }
}
