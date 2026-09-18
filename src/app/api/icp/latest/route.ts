import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let latestVersion = await prisma.icpVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        salesNarrativeVersion: {
          select: { id: true, narrative: true, createdAt: true },
        },
        user: { select: { id: true, name: true, email: true, slackUserName: true } },
      },
    });

    // Fall back to account teammate's latest
    if (!latestVersion && user.accountId) {
      latestVersion = await prisma.icpVersion.findFirst({
        where: { user: { accountId: user.accountId } },
        orderBy: { createdAt: "desc" },
        include: {
          salesNarrativeVersion: { select: { id: true, narrative: true, createdAt: true } },
          user: { select: { id: true, name: true, email: true, slackUserName: true } },
        },
      });
    }

    if (!latestVersion) {
      // Check if user has a sales narrative for enablement
      const hasNarrative = await prisma.salesNarrativeVersion.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      return NextResponse.json({
        hasIcp: false,
        version: null,
        hasSalesNarrative: !!hasNarrative,
      });
    }

    let parsedContent;
    try {
      const raw = JSON.parse(latestVersion.content);
      parsedContent = {
        sections: Array.isArray(raw?.sections) ? raw.sections : [],
        searchCriteria: Array.isArray(raw?.searchCriteria) ? raw.searchCriteria : undefined,
      };
    } catch {
      parsedContent = { sections: [] };
    }

    return NextResponse.json({
      hasIcp: true,
      currentUserId: user.id,
      version: {
        id: latestVersion.id,
        title: latestVersion.title,
        content: parsedContent,
        salesNarrativeVersionId: latestVersion.salesNarrativeVersionId,
        salesNarrative: latestVersion.salesNarrativeVersion,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
        userId: latestVersion.userId,
      },
      hasSalesNarrative: true,
    });
  } catch (error) {
    console.error("Error fetching latest ICP:", error);
    return NextResponse.json(
      { error: "Failed to fetch ICP" },
      { status: 500 }
    );
  }
}
