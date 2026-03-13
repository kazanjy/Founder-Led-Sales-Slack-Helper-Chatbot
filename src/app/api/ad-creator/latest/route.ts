import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest ad creator version
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.adCreatorVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        salesNarrativeVersion: {
          select: {
            id: true,
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
        hasAdCreator: false,
        version: null,
        hasSalesNarrative: !!hasNarrative,
      });
    }

    return NextResponse.json({
      hasAdCreator: true,
      version: {
        id: latestVersion.id,
        content: latestVersion.content,
        orgPersona: latestVersion.orgPersona,
        humanPersona: latestVersion.humanPersona,
        specialNotes: latestVersion.specialNotes,
        platforms: latestVersion.platforms,
        salesNarrativeVersionId: latestVersion.salesNarrativeVersionId,
        salesNarrativeVersion: latestVersion.salesNarrativeVersion,
        firstCallChecklistVersionId: latestVersion.firstCallChecklistVersionId,
        iteratedFromId: latestVersion.iteratedFromId,
        iterationNotes: latestVersion.iterationNotes,
        conversationId: latestVersion.conversationId,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching latest ad creator version:", error);
    return NextResponse.json(
      { error: "Failed to fetch ad creator version" },
      { status: 500 }
    );
  }
}
