import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

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

    const goal = await prisma.coachingGoal.findUnique({
      where: { id },
    });

    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    // Allow same-account access
    if (goal.userId !== user.id) {
      if (!user.accountId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      const goalOwner = await prisma.user.findFirst({ where: { id: goal.userId, accountId: user.accountId }, select: { id: true } });
      if (!goalOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const { title, description, parentTaskId } = body;

    // If a parentTaskId is provided, this is a subtask. Validate:
    //  - the parent exists and belongs to the same goal
    //  - the parent itself has no parent — depth is capped at 1.
    if (parentTaskId) {
      const parent = await prisma.coachingTask.findUnique({
        where: { id: parentTaskId },
        select: { id: true, goalId: true, parentTaskId: true },
      });
      if (!parent || parent.goalId !== id) {
        return NextResponse.json({ error: "parentTaskId does not belong to this goal" }, { status: 400 });
      }
      if (parent.parentTaskId !== null) {
        return NextResponse.json({ error: "Subtasks cannot have their own subtasks" }, { status: 400 });
      }
    }

    // Order within the appropriate sibling group: under a parent task
    // for subtasks, otherwise across the goal's top-level tasks.
    const maxOrder = await prisma.coachingTask.aggregate({
      where: parentTaskId
        ? { parentTaskId }
        : { goalId: id, parentTaskId: null },
      _max: { order: true },
    });

    const order = (maxOrder._max.order ?? -1) + 1;

    const task = await prisma.coachingTask.create({
      data: {
        userId: user.id,
        goalId: id,
        parentTaskId: parentTaskId || null,
        title,
        description: description || null,
        order,
      },
    });

    return NextResponse.json({ task });
  } catch (error) {
    console.error("Error creating coaching task:", error);
    return NextResponse.json(
      { error: "Failed to create coaching task" },
      { status: 500 }
    );
  }
}
