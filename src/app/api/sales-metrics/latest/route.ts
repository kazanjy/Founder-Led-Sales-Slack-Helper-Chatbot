import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latest = await prisma.salesMetricsAssessment.findFirst({
      where: { userId: user.id },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        title: true,
        completedAt: true,
        conversationId: true,
        csvFileName: true,
        calculatedMetrics: true,
        analysisReport: true,
      },
    });

    return NextResponse.json({
      hasSalesMetrics: !!latest,
      assessment: latest,
    });
  } catch (error) {
    console.error("Error fetching latest sales metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest assessment" },
      { status: 500 }
    );
  }
}
