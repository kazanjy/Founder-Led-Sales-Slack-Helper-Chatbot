import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest LinkedIn sequence version
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.linkedInSequenceVersion.findFirst({
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
        hasLinkedInSequence: false,
        version: null,
        hasSalesNarrative: !!hasNarrative,
      });
    }

    return NextResponse.json({
      hasLinkedInSequence: true,
      version: {
        id: latestVersion.id,
        content: latestVersion.content,
        orgPersona: latestVersion.orgPersona,
        humanPersona: latestVersion.humanPersona,
        specialNotes: latestVersion.specialNotes,
        salesNarrativeVersionId: latestVersion.salesNarrativeVersionId,
        salesNarrativeVersion: latestVersion.salesNarrativeVersion,
        firstCallChecklistVersionId: latestVersion.firstCallChecklistVersionId,
        conversationId: latestVersion.conversationId,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching latest LinkedIn sequence:", error);
    return NextResponse.json(
      { error: "Failed to fetch LinkedIn sequence" },
      { status: 500 }
    );
  }
}
