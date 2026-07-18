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
      select: { id: true, dealId: true, userId: true, title: true, status: true },
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

    // Manually-completed tasks leave a timeline trace like executed
    // ones do (executed tasks log via executeDealTaskViaSlack with the
    // sent message; this is the done-on-trust twin). Dismissals stay
    // off the timeline — noise, not history.
    if (status === "done" && task.status !== "done") {
      try {
        await prisma.dealTimelineEntry.create({
          data: {
            dealId: id,
            type: "note",
            title: `✓ Task completed: ${task.title}`,
            content: `Marked done by the founder (completed outside Mikey).`,
            entryDate: new Date(),
            metadata: JSON.stringify({
              auto_logged: true,
              source: "deal_task",
              dealTaskId: task.id,
              resolution: "done_manual",
            }),
          },
        });
      } catch (err) {
        console.error(`[deal task] completion entry failed for ${taskId}:`, err);
      }
    }
    return NextResponse.json({ task: updated });
  } catch (err) {
    console.error("[deal task] PATCH failed:", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
