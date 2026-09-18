import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET — get full detail of a specific sync
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!user.accountId) {
      return NextResponse.json({ error: "No account found" }, { status: 400 });
    }

    const { id } = await params;

    const record = await prisma.salesReadinessSyncHistory.findFirst({
      where: { id, accountId: user.accountId },
    });

    if (!record) {
      return NextResponse.json({ error: "Sync record not found" }, { status: 404 });
    }

    // Get user name
    const syncUser = await prisma.user.findUnique({
      where: { id: record.userId },
      select: { name: true, slackUserName: true, email: true },
    });

    return NextResponse.json({
      id: record.id,
      source: record.source,
      sourceContent: record.sourceContent,
      analysisResult: JSON.parse(record.analysisResult),
      acceptedItemIds: JSON.parse(record.acceptedItemIds),
      stageAccepted: record.stageAccepted,
      totalProposed: record.totalProposed,
      totalAccepted: record.totalAccepted,
      createdAt: record.createdAt.toISOString(),
      userName: syncUser?.name || syncUser?.slackUserName || syncUser?.email || "Unknown",
    });
  } catch (error) {
    console.error("Error fetching sync detail:", error);
    return NextResponse.json({ error: "Failed to fetch sync detail" }, { status: 500 });
  }
}
