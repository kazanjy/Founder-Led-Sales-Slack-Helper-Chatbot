import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateTaskDraft } from "@/lib/deals/task-execution";

/**
 * POST /api/deals/[id]/tasks/suggest-message — { title } → a
 * tone-compliant founder-voiced Slack message drafted from the deal's
 * historical evidence, for a task that DOESN'T EXIST YET (the
 * "✨ Suggest message" button in the task creation form). Nothing is
 * persisted — the draft rides the form and lands on the task at
 * creation.
 */

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
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
    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const draft = await generateTaskDraft({
      userId: user.id,
      dealId: id,
      taskTitle: title,
    });
    return NextResponse.json({ draft });
  } catch (err) {
    console.error("[deal task suggest-message] failed:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Suggestion failed", detail: detail.slice(0, 300) },
      { status: 500 }
    );
  }
}
