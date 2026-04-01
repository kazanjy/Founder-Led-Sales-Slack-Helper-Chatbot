import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const task = await prisma.coachingTask.findUnique({
      where: { id },
      include: { goal: true },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.goal.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const { title, description, status, order } = body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description || null;
    if (order !== undefined) updateData.order = order;
    if (status !== undefined) {
      updateData.status = status;
      if (status !== task.status) {
        updateData.statusChangedAt = new Date();
      }
    }

    const updated = await prisma.coachingTask.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ task: updated });
  } catch (error) {
    console.error("Error updating coaching task:", error);
    return NextResponse.json(
      { error: "Failed to update coaching task" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const task = await prisma.coachingTask.findUnique({
      where: { id },
      include: { goal: true },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.goal.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await prisma.coachingTask.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting coaching task:", error);
    return NextResponse.json(
      { error: "Failed to delete coaching task" },
      { status: 500 }
    );
  }
}
