import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { detectDealTasks } from "@/lib/deals/task-execution";

/**
 * POST /api/deals/[id]/tasks/detect — the "🔎 Detect follow-ups"
 * command. Scans the deal's full evidence for future commitments
 * (founder promises → executable tasks, prospect promises → Chase
 * watch tasks) and creates them as scheduled DealTasks, deduped
 * against existing ones. Evidence quote mandatory per task.
 */

export const maxDuration = 120;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    const deal = await prisma.deal.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!deal || deal.userId !== user.id) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    const result = await detectDealTasks(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[deal tasks detect] failed:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Detection failed", detail: detail.slice(0, 300) },
      { status: 500 }
    );
  }
}
