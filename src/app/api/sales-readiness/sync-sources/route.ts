import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET — return available sync sources with dates
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Latest completed assessment
    const latestAssessment = await prisma.maturityAssessment.findFirst({
      where: { userId: user.id },
      orderBy: { completedAt: "desc" },
      select: { id: true, completedAt: true, title: true },
    });

    // Latest coaching session
    const latestSession = await prisma.coachingSession.findFirst({
      where: { userId: user.id },
      orderBy: { sessionDate: "desc" },
      select: { id: true, sessionDate: true, title: true },
    });

    // Count of coaching sessions
    const sessionCount = await prisma.coachingSession.count({
      where: { userId: user.id },
    });

    return NextResponse.json({
      assessment: latestAssessment
        ? {
            available: true,
            date: latestAssessment.completedAt.toISOString(),
            title: latestAssessment.title,
          }
        : { available: false },
      coaching: latestSession
        ? {
            available: true,
            date: latestSession.sessionDate.toISOString(),
            title: latestSession.title,
            sessionCount,
          }
        : { available: false },
    });
  } catch (error) {
    console.error("Error fetching sync sources:", error);
    return NextResponse.json({ error: "Failed to fetch sync sources" }, { status: 500 });
  }
}
