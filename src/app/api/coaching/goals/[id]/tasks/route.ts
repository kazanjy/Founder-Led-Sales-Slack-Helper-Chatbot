import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canEditOwnedBy } from "@/lib/coaching/access";

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

    const allowed = await canEditOwnedBy(user.id, goal.userId);
    if (!allowed) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
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

    // Sort key for the new task. Tasks are fetched orderBy order
    // ASC, so to land the new task at the TOP of its sibling group
    // (the client prepends it visually on add, and the founder
    // expects it to stay there across a session save / refetch) we
    // give it the LOWEST order — one below the current min. Using
    // max+1 would shove it to the bottom on the next reload, which
    // was the "new tasks drop to the bottom on save" bug. Order can
    // go negative; reorder PATCHes write explicit values so the
    // running min just keeps drifting down with each new add, which
    // is fine.
    const minOrder = await prisma.coachingTask.aggregate({
      where: parentTaskId
        ? { parentTaskId }
        : { goalId: id, parentTaskId: null },
      _min: { order: true },
    });

    const order = (minOrder._min.order ?? 1) - 1;

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
