import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/deal-tasks — cross-deal task inbox: every open (scheduled /
 * pinged) task across the user's deals ordered by due date, plus the
 * 15 most recently resolved for the "recently handled" tail. Backs
 * the /deals/tasks review page.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const dealSelect = {
      select: {
        id: true,
        name: true,
        companyName: true,
        status: true,
        stage: true,
        slackChannelId: true,
        slackChannelName: true,
      },
    };
    const [open, resolved, lastActivity] = await Promise.all([
      prisma.dealTask.findMany({
        where: { userId: user.id, status: { in: ["scheduled", "pinged"] } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        take: 200,
        include: { deal: dealSelect },
      }),
      prisma.dealTask.findMany({
        where: { userId: user.id, status: { in: ["done", "dismissed", "expired"] } },
        orderBy: { resolvedAt: "desc" },
        take: 15,
        include: { deal: dealSelect },
      }),
      // Most recent past (non-chat) entry per deal — powers the
      // inbox's "sort by last activity".
      prisma.dealTimelineEntry.groupBy({
        by: ["dealId"],
        where: {
          deal: { userId: user.id },
          entryDate: { lte: new Date() },
          type: { not: "chat" },
        },
        _max: { entryDate: true },
      }),
    ]);
    const lastById = new Map(lastActivity.map((r) => [r.dealId, r._max.entryDate]));
    const withActivity = (tasks: typeof open) =>
      tasks.map((t) => ({
        ...t,
        deal: { ...t.deal, lastActivityAt: lastById.get(t.dealId)?.toISOString() || null },
      }));
    return NextResponse.json({ open: withActivity(open), resolved: withActivity(resolved) });
  } catch (err) {
    console.error("[deal-tasks] GET failed:", err);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }
}
