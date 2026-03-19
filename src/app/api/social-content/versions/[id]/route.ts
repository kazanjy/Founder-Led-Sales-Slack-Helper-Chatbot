import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const version = await prisma.socialContentVersion.findFirst({
      where: { id, userId: user.id },
      include: {
        salesNarrativeVersion: {
          select: { id: true, createdAt: true },
        },
      },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    return NextResponse.json({
      version: {
        id: version.id,
        title: version.title,
        content: version.content,
        platform: version.platform,
        tone: version.tone,
        postCount: version.postCount,
        topicSource: version.topicSource,
        topicInput: version.topicInput,
        goldStandardExamples: version.goldStandardExamples ? JSON.parse(version.goldStandardExamples) : [],
        salesNarrativeVersionId: version.salesNarrativeVersionId,
        salesNarrativeVersion: version.salesNarrativeVersion,
        firstCallChecklistVersionId: version.firstCallChecklistVersionId,
        conversationId: version.conversationId,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching version:", error);
    return NextResponse.json({ error: "Failed to fetch version" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const { content } = await request.json();

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const existing = await prisma.socialContentVersion.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const updated = await prisma.socialContentVersion.update({
      where: { id },
      data: { content },
    });

    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: { userId: user.id, mergeField: "SOCIAL_CONTENT" },
      },
      update: { value: content },
      create: {
        userId: user.id,
        mergeField: "SOCIAL_CONTENT",
        name: "Social Content",
        value: content,
        isDefault: false,
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: updated.id,
        content: updated.content,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating version:", error);
    return NextResponse.json({ error: "Failed to update version" }, { status: 500 });
  }
}
