import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest sales deck version
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.salesDeckVersion.findFirst({
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
        hasSalesDeck: false,
        version: null,
        hasSalesNarrative: !!hasNarrative,
      });
    }

    return NextResponse.json({
      hasSalesDeck: true,
      version: {
        id: latestVersion.id,
        content: latestVersion.content,
        orgPersona: latestVersion.orgPersona,
        humanPersona: latestVersion.humanPersona,
        specialNotes: latestVersion.specialNotes,
        deckMode: latestVersion.deckMode,
        sourcePdfName: latestVersion.sourcePdfName,
        salesNarrativeVersionId: latestVersion.salesNarrativeVersionId,
        salesNarrativeVersion: latestVersion.salesNarrativeVersion,
        firstCallChecklistVersionId: latestVersion.firstCallChecklistVersionId,
        conversationId: latestVersion.conversationId,
        // Gamma fields
        gammaUrl: latestVersion.gammaUrl,
        gammaPdfUrl: latestVersion.gammaPdfUrl,
        gammaPptxUrl: latestVersion.gammaPptxUrl,
        prospectUrl: latestVersion.prospectUrl,
        contextUrls: latestVersion.contextUrls,
        contextPdfNames: latestVersion.contextPdfNames,
        brandAnalysis: latestVersion.brandAnalysis,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
      },
    });
  } catch (error: unknown) {
    // Handle missing table or column (migration not yet run)
    const errMsg = error instanceof Error ? error.message : String(error);
    if (
      errMsg.includes("does not exist") ||
      errMsg.includes("Unknown field") ||
      errMsg.includes("P2021") ||
      errMsg.includes("P2010") ||
      errMsg.includes("P2022")
    ) {
      console.warn("[sales-deck/latest] Table/column not found — migration likely pending:", errMsg.slice(0, 200));
      // Still try to check for sales narrative so the gate doesn't block unnecessarily
      try {
        const hasNarrative = await prisma.salesNarrativeVersion.findFirst({
          where: { userId: (await getCurrentUser())?.id || "" },
          select: { id: true },
        });
        return NextResponse.json({
          hasSalesDeck: false,
          version: null,
          hasSalesNarrative: !!hasNarrative,
        });
      } catch {
        return NextResponse.json({
          hasSalesDeck: false,
          version: null,
          hasSalesNarrative: false,
        });
      }
    }
    console.error("Error fetching latest sales deck:", error);
    return NextResponse.json(
      { error: "Failed to fetch sales deck" },
      { status: 500 }
    );
  }
}
