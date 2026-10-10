import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - List all call review versions for the current user
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const versions = await prisma.callReviewVersion.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        callType: true,
        title: true,
        overallScore: true,
        maxScore: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ versions });
  } catch (error) {
    console.error("Error fetching call review versions:", error);
    return NextResponse.json(
      { error: "Failed to fetch call review history" },
      { status: 500 },
    );
  }
}
