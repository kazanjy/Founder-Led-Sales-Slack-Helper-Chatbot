import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest pre-hire assessment version (optionally filtered by roleType)
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const roleType = searchParams.get("roleType");

    const where: { userId: string; roleType?: string } = { userId: user.id };
    if (roleType) {
      where.roleType = roleType;
    }

    const latestVersion = await prisma.preHireAssessmentVersion.findFirst({
      where,
      orderBy: { createdAt: "desc" },
    });

    if (!latestVersion) {
      return NextResponse.json({
        hasAssessment: false,
        version: null,
      });
    }

    return NextResponse.json({
      hasAssessment: true,
      version: {
        id: latestVersion.id,
        userId: latestVersion.userId,
        title: latestVersion.title,
        roleType: latestVersion.roleType,
        content: latestVersion.content,
        iterationHistory: latestVersion.iterationHistory,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching latest pre-hire assessment:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest pre-hire assessment" },
      { status: 500 }
    );
  }
}
