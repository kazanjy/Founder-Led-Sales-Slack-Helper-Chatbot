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
    const goal = await prisma.coachingNextGoal.findFirst({ where: { id, userId: user.id } });
    if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description || null;
    if (body.order !== undefined) updateData.order = body.order;

    const updated = await prisma.coachingNextGoal.update({
      where: { id },
      data: updateData,
      include: { tasks: { orderBy: { order: "asc" } } },
    });

    return NextResponse.json({ goal: updated });
  } catch (error) {
    console.error("Error updating next goal:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
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
    const goal = await prisma.coachingNextGoal.findFirst({ where: { id, userId: user.id } });
    if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.coachingNextGoal.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting next goal:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
