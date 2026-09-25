import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/** PATCH — resolve/undo and/or edit:
 *  { status?: "done" | "dismissed" | "scheduled",
 *    title?, dueAt?: ISO | null, draftMessage?: string }
 *  Editing dueAt to a FUTURE time on a pinged task re-arms it
 *  (scheduled) so the cron pings again at the new time. Saving a
 *  non-empty draftMessage upgrades a non-executable task to
 *  slack_channel — a task with a message loaded is sendable. */
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
      select: { id: true, dealId: true, userId: true, title: true, status: true, executeVia: true },
    });
    if (!task || task.dealId !== id || task.userId !== user.id) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const { status } = body;
    const data: Record<string, unknown> = {};
    if (status !== undefined) {
      if (!["done", "dismissed", "scheduled"].includes(status)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
      }
      data.status = status;
      data.resolvedAt = status === "scheduled" ? null : new Date();
    }
    if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
    if (body.dueAt !== undefined) {
      if (body.dueAt === null) {
        data.dueAt = null;
      } else {
        const due = new Date(body.dueAt);
        if (isNaN(due.getTime())) {
          return NextResponse.json({ error: "invalid dueAt" }, { status: 400 });
        }
        data.dueAt = due;
        if (status === undefined && task.status === "pinged" && due.getTime() > Date.now()) {
          data.status = "scheduled";
        }
      }
    }
    if (typeof body.draftMessage === "string") {
      const draft = body.draftMessage.trim();
      data.draftMessage = draft || null;
      if (draft && !task.executeVia) data.executeVia = "slack_channel";
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    const updated = await prisma.dealTask.update({
      where: { id: taskId },
      data,
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
