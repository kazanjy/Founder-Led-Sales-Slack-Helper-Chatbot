import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Fetch user's latest completed assessment
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get the most recent completed assessment
    const assessment = await prisma.maturityAssessment.findFirst({
      where: { userId: user.id },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        title: true,
        completedAt: true,
        conversationId: true,
      },
    });

    return NextResponse.json({
      assessment: assessment || null,
    });
  } catch (error) {
    console.error("Error fetching latest assessment:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest assessment" },
      { status: 500 }
    );
  }
}
