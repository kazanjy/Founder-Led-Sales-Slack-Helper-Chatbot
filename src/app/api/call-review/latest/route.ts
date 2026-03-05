import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest call review version
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.callReviewVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!latestVersion) {
      return NextResponse.json({
        hasCallReview: false,
        version: null,
      });
    }

    let scores;
    try {
      scores = JSON.parse(latestVersion.scores);
    } catch {
      scores = {};
    }

    return NextResponse.json({
      hasCallReview: true,
      version: {
        id: latestVersion.id,
        callType: latestVersion.callType,
        title: latestVersion.title,
        scores,
        overallScore: latestVersion.overallScore,
        maxScore: latestVersion.maxScore,
        conversationId: latestVersion.conversationId,
        createdAt: latestVersion.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching latest call review:", error);
    return NextResponse.json(
      { error: "Failed to fetch call review" },
      { status: 500 },
    );
  }
}
