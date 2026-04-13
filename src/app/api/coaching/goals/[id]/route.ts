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
    const { title, description, status, order } = body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (order !== undefined) updateData.order = order;
    if (status !== undefined) {
      updateData.status = status;
      if (status !== goal.status) {
        updateData.statusChangedAt = new Date();
      }
    }

    const updated = await prisma.coachingGoal.update({
      where: { id },
      data: updateData,
      include: {
        tasks: {
          orderBy: { order: "asc" },
        },
      },
    });

    return NextResponse.json({ goal: updated });
  } catch (error) {
    console.error("Error updating coaching goal:", error);
    return NextResponse.json(
      { error: "Failed to update coaching goal" },
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

    await prisma.coachingGoal.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting coaching goal:", error);
    return NextResponse.json(
      { error: "Failed to delete coaching goal" },
      { status: 500 }
    );
  }
}
