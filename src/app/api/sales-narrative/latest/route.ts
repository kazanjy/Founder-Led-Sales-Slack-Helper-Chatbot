import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest sales narrative version (for merge variables display)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        narrative: true,
        description100w: true,
        description50w: true,
        description25w: true,
        createdAt: true,
      },
    });

    if (!latestVersion) {
      return NextResponse.json({
        hasNarrative: false,
        version: null,
      });
    }

    return NextResponse.json({
      hasNarrative: true,
      version: latestVersion,
    });
  } catch (error) {
    console.error("Error fetching latest sales narrative:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest narrative" },
      { status: 500 }
    );
  }
}
