import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET — list sync history for the account
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!user.accountId) {
      return NextResponse.json({ error: "No account found" }, { status: 400 });
    }

    const history = await prisma.salesReadinessSyncHistory.findMany({
      where: { accountId: user.accountId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        source: true,
        totalProposed: true,
        totalAccepted: true,
        stageAccepted: true,
        createdAt: true,
        userId: true,
      },
    });

    // Get user names
    const userIds = [...new Set(history.map((h) => h.userId))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, slackUserName: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.name || u.slackUserName || u.email || "Unknown"]));

    const enriched = history.map((h) => ({
      ...h,
      createdAt: h.createdAt.toISOString(),
      userName: userMap.get(h.userId) || "Unknown",
    }));

    return NextResponse.json({ history: enriched });
  } catch (error) {
    console.error("Error fetching sync history:", error);
    return NextResponse.json({ error: "Failed to fetch sync history" }, { status: 500 });
  }
}

// POST — save a sync result after user applies changes
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!user.accountId) {
      return NextResponse.json({ error: "No account found" }, { status: 400 });
    }

    const body = await request.json();
    const {
      source,
      sourceContent,
      analysisResult,
      acceptedItemIds,
      stageAccepted,
      totalProposed,
      totalAccepted,
    } = body;

    const record = await prisma.salesReadinessSyncHistory.create({
      data: {
        accountId: user.accountId,
        userId: user.id,
        source,
        sourceContent,
        analysisResult: JSON.stringify(analysisResult),
        acceptedItemIds: JSON.stringify(acceptedItemIds),
        stageAccepted: stageAccepted || false,
        totalProposed: totalProposed || 0,
        totalAccepted: totalAccepted || 0,
      },
    });

    return NextResponse.json({ id: record.id });
  } catch (error) {
    console.error("Error saving sync history:", error);
    return NextResponse.json({ error: "Failed to save sync history" }, { status: 500 });
  }
}
