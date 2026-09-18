import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get a specific call review version
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const version = await prisma.callReviewVersion.findUnique({
      where: { id },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (version.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    let scores;
    try {
      scores = JSON.parse(version.scores);
    } catch {
      scores = {};
    }

    return NextResponse.json({
      version: {
        id: version.id,
        callType: version.callType,
        title: version.title,
        transcript: version.transcript,
        sourceUrl: version.sourceUrl,
        scores,
        overallScore: version.overallScore,
        maxScore: version.maxScore,
        conversationId: version.conversationId,
        createdAt: version.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching call review version:", error);
    return NextResponse.json(
      { error: "Failed to fetch version" },
      { status: 500 },
    );
  }
}

// PATCH - Update scores (for user overrides)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.callReviewVersion.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (existing.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.scores !== undefined) updateData.scores = JSON.stringify(body.scores);
    if (body.overallScore !== undefined) updateData.overallScore = body.overallScore;
    if (body.title !== undefined) updateData.title = body.title;

    const updated = await prisma.callReviewVersion.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      version: {
        id: updated.id,
        overallScore: updated.overallScore,
        maxScore: updated.maxScore,
      },
    });
  } catch (error) {
    console.error("Error updating call review:", error);
    return NextResponse.json(
      { error: "Failed to update call review" },
      { status: 500 },
    );
  }
}
