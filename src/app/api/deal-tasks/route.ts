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
        slackChannelId: true,
        slackChannelName: true,
      },
    };
    const [open, resolved] = await Promise.all([
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
    ]);
    return NextResponse.json({ open, resolved });
  } catch (err) {
    console.error("[deal-tasks] GET failed:", err);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }
}
