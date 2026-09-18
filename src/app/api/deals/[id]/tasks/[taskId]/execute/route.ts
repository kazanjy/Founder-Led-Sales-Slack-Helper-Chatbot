import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { executeDealTaskViaSlack } from "@/lib/deals/task-execution";

/**
 * POST /api/deals/[id]/tasks/[taskId]/execute — JSON twin of the
 * Slack ping's GET "Do it" link, used by the execute-now preview
 * overlay. Body: { message? } — an edited draft is persisted and
 * sent. Sends as the founder into the deal's linked channel, logs
 * the proof entry, marks the task done.
 */

export const maxDuration = 60;

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
      select: { id: true, dealId: true },
    });
    if (!task || task.dealId !== id) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message : undefined;
    const result = await executeDealTaskViaSlack(user.id, taskId, message);
    if (!result.ok) {
      return NextResponse.json(
        { error: "Execution failed", reason: result.reason },
        { status: result.reason === "forbidden" ? 403 : 400 }
      );
    }
    return NextResponse.json({ ok: true, reason: result.reason });
  } catch (err) {
    console.error("[deal task execute] failed:", err);
    return NextResponse.json({ error: "Execution failed" }, { status: 500 });
  }
}
