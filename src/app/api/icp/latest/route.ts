import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.iCPVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        salesNarrativeVersion: {
          select: {
            id: true,
            narrative: true,
            createdAt: true,
          },
        },
      },
    });

    if (!latestVersion) {
      const hasNarrative = await prisma.salesNarrativeVersion.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      return NextResponse.json({
        hasICP: false,
        version: null,
        hasSalesNarrative: !!hasNarrative,
      });
    }

    let content;
    try {
      content = JSON.parse(latestVersion.content);
    } catch {
      content = { segments: [] };
    }

    return NextResponse.json({
      hasICP: true,
      currentUserId: user.id,
      version: {
        id: latestVersion.id,
        title: latestVersion.title,
        content,
        salesNarrativeVersionId: latestVersion.salesNarrativeVersionId,
        salesNarrative: latestVersion.salesNarrativeVersion,
        createdAt: latestVersion.createdAt,
        userId: latestVersion.userId,
      },
    });
  } catch (error) {
    console.error("Error fetching latest ICP:", error);
    return NextResponse.json(
      { error: "Failed to fetch ICP" },
      { status: 500 }
    );
  }
}
