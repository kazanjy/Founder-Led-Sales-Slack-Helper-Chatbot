import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest cold call script version
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.coldCallScriptVersion.findFirst({
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
        hasColdCallScript: false,
        version: null,
        hasSalesNarrative: !!hasNarrative,
      });
    }

    return NextResponse.json({
      hasColdCallScript: true,
      version: {
        id: latestVersion.id,
        content: latestVersion.content,
        orgPersona: latestVersion.orgPersona,
        humanPersona: latestVersion.humanPersona,
        specialNotes: latestVersion.specialNotes,
        scriptType: latestVersion.scriptType,
        salesNarrativeVersionId: latestVersion.salesNarrativeVersionId,
        salesNarrativeVersion: latestVersion.salesNarrativeVersion,
        firstCallChecklistVersionId: latestVersion.firstCallChecklistVersionId,
        conversationId: latestVersion.conversationId,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
      },
    });
  } catch (error: unknown) {
    // Handle missing table (migration not yet run)
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("does not exist") || errMsg.includes("P2021") || errMsg.includes("P2010")) {
      console.warn("[cold-call-script/latest] Table not found — migration likely pending");
      return NextResponse.json({
        hasColdCallScript: false,
        version: null,
        hasSalesNarrative: false,
      });
    }
    console.error("Error fetching latest cold call script:", error);
    return NextResponse.json(
      { error: "Failed to fetch cold call script" },
      { status: 500 }
    );
  }
}
