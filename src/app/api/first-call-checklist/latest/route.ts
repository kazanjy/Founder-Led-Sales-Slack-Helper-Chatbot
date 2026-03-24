import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest first call checklist version
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.firstCallChecklistVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        discoveryQuestionsVersion: {
          select: {
            id: true,
            createdAt: true,
            salesNarrativeVersion: {
              select: {
                id: true,
                createdAt: true,
              },
            },
          },
        },
        user: {
          select: { name: true, email: true, slackUserName: true },
        },
      },
    });

    if (!latestVersion) {
      // Check if user has discovery questions to generate from
      const hasDiscoveryQuestions = await prisma.discoveryQuestionsVersion.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      return NextResponse.json({
        currentUserId: user.id,
        hasFirstCallChecklist: false,
        version: null,
        hasDiscoveryQuestions: !!hasDiscoveryQuestions,
      });
    }

    return NextResponse.json({
      currentUserId: user.id,
      hasFirstCallChecklist: true,
      version: {
        id: latestVersion.id,
        title: latestVersion.title,
        content: latestVersion.content,
        userId: latestVersion.userId,
        discoveryQuestionsVersionId: latestVersion.discoveryQuestionsVersionId,
        discoveryQuestionsVersion: latestVersion.discoveryQuestionsVersion,
        createdAt: latestVersion.createdAt,
        updatedAt: latestVersion.updatedAt,
        user: latestVersion.user,
      },
    });
  } catch (error) {
    console.error("Error fetching latest first call checklist:", error);
    return NextResponse.json(
      { error: "Failed to fetch first call checklist" },
      { status: 500 }
    );
  }
}
