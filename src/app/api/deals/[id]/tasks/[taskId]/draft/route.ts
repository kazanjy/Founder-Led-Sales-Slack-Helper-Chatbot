import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateTaskDraft } from "@/lib/deals/task-execution";

/**
 * POST /api/deals/[id]/tasks/[taskId]/draft — return the task's
 * drafted message for the execute-now preview overlay, generating
 * (and persisting) it when missing. { regenerate: true } forces a
 * fresh draft.
 */

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id, taskId } = await params;
    const task = await prisma.dealTask.findUnique({
      where: { id: taskId },
      select: {
        id: true, dealId: true, userId: true, title: true,
        rationale: true, draftMessage: true, status: true,
      },
    });
    if (!task || task.dealId !== id || task.userId !== user.id) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const regenerate = body?.regenerate === true;

    let draft = (task.draftMessage || "").trim();
    if (!draft || regenerate) {
      draft = await generateTaskDraft({
        userId: user.id,
        dealId: id,
        taskTitle: task.title,
        rationale: task.rationale,
      });
      await prisma.dealTask.update({
        where: { id: taskId },
        data: { draftMessage: draft },
      });
    }
    return NextResponse.json({ draft });
  } catch (err) {
    console.error("[deal task draft] failed:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Draft generation failed", detail: detail.slice(0, 300) },
      { status: 500 }
    );
  }
}
