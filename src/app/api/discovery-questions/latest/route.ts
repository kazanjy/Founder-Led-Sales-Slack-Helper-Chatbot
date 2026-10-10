import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest discovery questions version
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let latestVersion = await prisma.discoveryQuestionsVersion.findFirst({
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
        user: {
          select: { id: true, name: true, email: true, slackUserName: true },
        },
      },
    });

    // Fall back to account teammate's latest
    if (!latestVersion && user.accountId) {
      latestVersion = await prisma.discoveryQuestionsVersion.findFirst({
        where: { user: { accountId: user.accountId } },
        orderBy: { createdAt: "desc" },
        include: {
          salesNarrativeVersion: { select: { id: true, narrative: true, createdAt: true } },
          user: { select: { id: true, name: true, email: true, slackUserName: true } },
        },
      });
    }

    if (!latestVersion) {
      // Check if user has a sales narrative to generate from
      const hasNarrative = await prisma.salesNarrativeVersion.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      return NextResponse.json({
        currentUserId: user.id,
        hasDiscoveryQuestions: false,
        version: null,
        hasSalesNarrative: !!hasNarrative,
      });
    }

    // Parse the stored JSON content
    let content;
    try {
      content = JSON.parse(latestVersion.content);
    } catch {
      content = { categories: [] };
    }

    return NextResponse.json({
      currentUserId: user.id,
      hasDiscoveryQuestions: true,
      version: {
        id: latestVersion.id,
        userId: latestVersion.userId,
        title: latestVersion.title,
        content,
        salesNarrativeVersionId: latestVersion.salesNarrativeVersionId,
        salesNarrative: latestVersion.salesNarrativeVersion,
        createdAt: latestVersion.createdAt,
        user: latestVersion.user,
      },
    });
  } catch (error) {
    console.error("Error fetching latest discovery questions:", error);
    return NextResponse.json(
      { error: "Failed to fetch discovery questions" },
      { status: 500 }
    );
  }
}
