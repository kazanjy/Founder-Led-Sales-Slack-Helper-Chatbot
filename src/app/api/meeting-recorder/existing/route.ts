import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// POST — look up existing recaps and reviews by provider URLs
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { providerUrls } = (await request.json()) as { providerUrls: string[] };
    if (!Array.isArray(providerUrls) || providerUrls.length === 0) {
      return NextResponse.json({ matches: {} });
    }

    // Look up call recaps by recordingUrl
    const recaps = await prisma.callRecapVersion.findMany({
      where: { userId: user.id, recordingUrl: { in: providerUrls } },
      select: { id: true, recordingUrl: true, title: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    // Look up call reviews by sourceUrl
    const reviews = await prisma.callReviewVersion.findMany({
      where: { userId: user.id, sourceUrl: { in: providerUrls } },
      select: { id: true, sourceUrl: true, title: true, overallScore: true, maxScore: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    // Build a map: providerUrl -> { recap?, review? }
    const matches: Record<string, {
      recap?: { id: string; title: string; createdAt: string };
      review?: { id: string; title: string; overallScore: number | null; maxScore: number | null; createdAt: string };
    }> = {};

    for (const recap of recaps) {
      if (!matches[recap.recordingUrl]) matches[recap.recordingUrl] = {};
      // Only keep the latest
      if (!matches[recap.recordingUrl].recap) {
        matches[recap.recordingUrl].recap = {
          id: recap.id,
          title: recap.title,
          createdAt: recap.createdAt.toISOString(),
        };
      }
    }

    for (const review of reviews) {
      if (!review.sourceUrl) continue;
      if (!matches[review.sourceUrl]) matches[review.sourceUrl] = {};
      if (!matches[review.sourceUrl].review) {
        matches[review.sourceUrl].review = {
          id: review.id,
          title: review.title || "Call Review",
          overallScore: review.overallScore,
          maxScore: review.maxScore,
          createdAt: review.createdAt.toISOString(),
        };
      }
    }

    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Error looking up existing calls:", error);
    return NextResponse.json({ error: "Failed to look up existing calls" }, { status: 500 });
  }
}
