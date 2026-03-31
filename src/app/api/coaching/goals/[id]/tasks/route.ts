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

    if (goal.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const { title } = body;

    const maxOrder = await prisma.coachingTask.aggregate({
      where: { goalId: id },
      _max: { order: true },
    });

    const order = (maxOrder._max.order ?? -1) + 1;

    const task = await prisma.coachingTask.create({
      data: {
        goalId: id,
        title,
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
