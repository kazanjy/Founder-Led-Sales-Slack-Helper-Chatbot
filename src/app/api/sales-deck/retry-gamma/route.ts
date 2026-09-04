import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateAndExport } from "@/lib/gamma";

export const maxDuration = 180;

/**
 * Extract the tone recommendation from the brand analysis text.
 */
function extractToneFromBrandAnalysis(brandAnalysis: string): string {
  const toneMatch = brandAnalysis.match(
    /(?:Presentation Tone Recommendation|Tone Recommendation)[:\s]*\n+([\s\S]*?)(?:\n##|\n\n\n|$)/i
  );
  if (toneMatch?.[1]) {
    return toneMatch[1].trim().substring(0, 500);
  }
  return brandAnalysis.substring(0, 500);
}

/**
 * POST /api/sales-deck/retry-gamma
 *
 * Retry Gamma presentation generation for an existing SalesDeckVersion
 * that already has gammaInputContent but failed the initial Gamma call.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { versionId } = body;

    if (!versionId) {
      return NextResponse.json(
        { error: "versionId is required" },
        { status: 400 }
      );
    }

    // Load the version and ensure it belongs to the authenticated user
    const version = await prisma.salesDeckVersion.findFirst({
      where: {
        id: versionId,
        userId: user.id,
      },
    });

    if (!version) {
      return NextResponse.json(
        { error: "Sales deck version not found" },
        { status: 404 }
      );
    }

    // Verify the version has gammaInputContent and is a gamma deck
    if (!version.gammaInputContent) {
      console.warn(`[retry-gamma] Version ${versionId} has no gammaInputContent`);
      return NextResponse.json(
        { error: "This version does not have pre-processed Gamma content to retry." },
        { status: 400 }
      );
    }

    if (version.deckMode !== "gamma") {
      console.warn(`[retry-gamma] Version ${versionId} is mode="${version.deckMode}", not gamma`);
      return NextResponse.json(
        { error: "This version is not a Gamma deck." },
        { status: 400 }
      );
    }

    // Generate presentation via Gamma + export to PDF/PPTX
    const deckTitle = `Sales Deck: ${version.orgPersona}`;
    const tone = version.brandAnalysis
      ? extractToneFromBrandAnalysis(version.brandAnalysis)
      : "Professional, confident, and data-driven. Clean modern aesthetic with clear visual hierarchy.";

    console.log(`[retry-gamma] Starting Gamma pipeline for version ${versionId}: title="${deckTitle}", inputLength=${version.gammaInputContent.length}, hasBrandAnalysis=${!!version.brandAnalysis}, existingGammaUrl=${version.gammaUrl || "none"}`);

    let gammaResult;
    try {
      gammaResult = await generateAndExport({
        inputText: version.gammaInputContent,
        title: deckTitle,
        format: "presentation",
        numCards: 14,
        tone,
        theme: "professional",
      });
    } catch (gammaError) {
      console.error(`[retry-gamma] Gamma pipeline FAILED for version ${versionId}:`, gammaError instanceof Error ? gammaError.message : gammaError);
      console.error("[retry-gamma] Full error:", gammaError);
      return NextResponse.json(
        { error: "Failed to generate Gamma presentation. Please try again." },
        { status: 502 }
      );
    }

    // Update the version with the new Gamma URLs
    await prisma.salesDeckVersion.update({
      where: { id: version.id },
      data: {
        gammaUrl: gammaResult.gammaUrl,
        gammaPdfUrl: gammaResult.pdfUrl,
        gammaPptxUrl: gammaResult.pptxUrl,
      },
    });

    console.log(`[retry-gamma] SUCCESS for version ${versionId}: gammaUrl=${gammaResult.gammaUrl}, pdfUrl=${gammaResult.pdfUrl}, pptxUrl=${gammaResult.pptxUrl}`);

    return NextResponse.json({
      success: true,
      gammaUrl: gammaResult.gammaUrl,
      gammaPdfUrl: gammaResult.pdfUrl,
      gammaPptxUrl: gammaResult.pptxUrl,
    });
  } catch (error) {
    console.error("[retry-gamma] Error:", error);
    return NextResponse.json(
      { error: "Failed to retry Gamma presentation generation" },
      { status: 500 }
    );
  }
}
