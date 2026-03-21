import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.icpVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        salesNarrativeVersion: {
          select: { id: true, narrative: true, createdAt: true },
        },
      },
    });

    if (!latestVersion) {
      // Check if user has a sales narrative for enablement
      const hasNarrative = await prisma.salesNarrativeVersion.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      return NextResponse.json({
        hasIcp: false,
        version: null,
        hasSalesNarrative: !!hasNarrative,
      });
    }

    let parsedContent;
    try {
      parsedContent = JSON.parse(latestVersion.content);
    } catch {
      parsedContent = { sections: [] };
    }

    return NextResponse.json({
      hasIcp: true,
      version: {
        id: latestVersion.id,
        title: latestVersion.title,
        content: parsedContent,
        salesNarrativeVersionId: latestVersion.salesNarrativeVersionId,
        salesNarrative: latestVersion.salesNarrativeVersion,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
        userId: latestVersion.userId,
      },
      hasSalesNarrative: true,
    });
  } catch (error) {
    console.error("Error fetching latest ICP:", error);
    return NextResponse.json(
      { error: "Failed to fetch ICP" },
      { status: 500 }
    );
  }
}
