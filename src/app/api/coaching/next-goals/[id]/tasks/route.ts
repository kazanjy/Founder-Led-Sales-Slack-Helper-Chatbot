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
    const goal = await prisma.coachingNextGoal.findFirst({ where: { id, userId: user.id } });
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

    const { title, description } = await request.json();
    if (!title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const maxOrder = await prisma.coachingNextTask.aggregate({
      where: { goalId: id },
      _max: { order: true },
    });

    const task = await prisma.coachingNextTask.create({
      data: {
        userId: user.id,
        goalId: id,
        title: title.trim(),
        description: description?.trim() || null,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("Error creating next task:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
