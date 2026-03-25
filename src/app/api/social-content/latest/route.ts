import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.socialContentVersion.findFirst({
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
        hasSocialContent: false,
        version: null,
        hasSalesNarrative: !!hasNarrative,
      });
    }

    return NextResponse.json({
      hasSocialContent: true,
      version: {
        id: latestVersion.id,
        title: latestVersion.title,
        content: latestVersion.content,
        platform: latestVersion.platform,
        tone: latestVersion.tone,
        postCount: latestVersion.postCount,
        topicSource: latestVersion.topicSource,
        topicInput: latestVersion.topicInput,
        goldStandardExamples: latestVersion.goldStandardExamples ? JSON.parse(latestVersion.goldStandardExamples) : [],
        salesNarrativeVersionId: latestVersion.salesNarrativeVersionId,
        salesNarrativeVersion: latestVersion.salesNarrativeVersion,
        firstCallChecklistVersionId: latestVersion.firstCallChecklistVersionId,
        conversationId: latestVersion.conversationId,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching latest social content:", error);
    return NextResponse.json(
      { error: "Failed to fetch social content" },
      { status: 500 }
    );
  }
}
