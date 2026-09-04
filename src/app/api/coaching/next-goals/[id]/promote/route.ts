import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// POST - Promote a next goal into the current session's active goals
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
    }

    // Verify the next goal belongs to the user
    const nextGoal = await prisma.coachingNextGoal.findFirst({
      where: { id, userId: user.id },
      include: { tasks: { orderBy: { order: "asc" } } },
    });

    if (!nextGoal) {
      return NextResponse.json({ error: "Next goal not found" }, { status: 404 });
    }

    // Verify the session belongs to the user
    const session = await prisma.coachingSession.findFirst({
      where: { id: sessionId, userId: user.id },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Get the max order of existing goals in the session
    const maxGoalOrder = await prisma.coachingGoal.aggregate({
      where: { sessionId },
      _max: { order: true },
    });

    // Create the active goal
    const activeGoal = await prisma.coachingGoal.create({
      data: {
        userId: user.id,
        sessionId,
        title: nextGoal.title,
        description: nextGoal.description,
        status: "active",
        order: (maxGoalOrder._max.order ?? -1) + 1,
      },
    });

    // Create active tasks from next tasks
    const activeTasks = [];
    for (const nextTask of nextGoal.tasks) {
      const activeTask = await prisma.coachingTask.create({
        data: {
          userId: user.id,
          goalId: activeGoal.id,
          title: nextTask.title,
          description: nextTask.description,
          order: nextTask.order,
        },
      });
      activeTasks.push(activeTask);
    }

    // Delete the next goal (cascade deletes its tasks)
    await prisma.coachingNextGoal.delete({ where: { id } });

    return NextResponse.json({
      goal: { ...activeGoal, tasks: activeTasks },
    });
  } catch (error) {
    console.error("Error promoting next goal:", error);
    return NextResponse.json({ error: "Failed to promote goal" }, { status: 500 });
  }
}
