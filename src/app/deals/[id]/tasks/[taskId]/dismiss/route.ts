import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /deals/[id]/tasks/[taskId]/dismiss — the "✕ Dismiss task" link
 * on the ⚡ Proposed Task Execution ping. Marks the task dismissed and
 * lands on the deal. Unauthenticated hits redirect untouched.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id, taskId } = await params;
  const dealUrl = new URL(`/deals/${id}`, request.nextUrl.origin);
  const user = await getCurrentUser();
  if (user) {
    try {
      const task = await prisma.dealTask.findUnique({
        where: { id: taskId },
        select: { id: true, dealId: true, userId: true, status: true },
      });
      if (task && task.dealId === id && task.userId === user.id && task.status !== "done") {
        await prisma.dealTask.update({
          where: { id: taskId },
          data: { status: "dismissed", resolvedAt: new Date() },
        });
      }
    } catch (err) {
      console.error(`[task dismiss] failed for ${taskId}:`, err);
    }
  }
  return NextResponse.redirect(dealUrl);
}
