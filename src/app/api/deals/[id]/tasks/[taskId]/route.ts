import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/** PATCH — { status: "done" | "dismissed" | "scheduled" } (UI resolve/undo). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id, taskId } = await params;
    const task = await prisma.dealTask.findUnique({
      where: { id: taskId },
      select: { id: true, dealId: true, userId: true },
    });
    if (!task || task.dealId !== id || task.userId !== user.id) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const { status } = await request.json();
    if (!["done", "dismissed", "scheduled"].includes(status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    const updated = await prisma.dealTask.update({
      where: { id: taskId },
      data: {
        status,
        resolvedAt: status === "scheduled" ? null : new Date(),
      },
    });
    return NextResponse.json({ task: updated });
  } catch (err) {
    console.error("[deal task] PATCH failed:", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
