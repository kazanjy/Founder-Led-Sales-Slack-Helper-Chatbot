import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get all discovery questions versions (history)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const whereClause = user.accountId
      ? { user: { accountId: user.accountId } }
      : { userId: user.id };

    const versions = await prisma.discoveryQuestionsVersion.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      include: {
        salesNarrativeVersion: {
          select: {
            id: true,
            createdAt: true,
          },
        },
        user: {
          select: { name: true, email: true, slackUserName: true },
        },
      },
    });

    // Parse content and add question count
    const formattedVersions = versions.map((v) => {
      let content;
      let questionCount = 0;

      try {
        content = JSON.parse(v.content);
        if (content.categories) {
          questionCount = content.categories.reduce(
            (acc: number, cat: { questions: unknown[] }) => acc + (cat.questions?.length || 0),
            0
          );
        }
      } catch {
        content = { categories: [] };
      }

      return {
        id: v.id,
        title: v.title,
        questionCount,
        salesNarrativeVersionId: v.salesNarrativeVersionId,
        salesNarrativeCreatedAt: v.salesNarrativeVersion?.createdAt ?? null,
        createdAt: v.createdAt,
        userId: v.userId,
        user: v.user,
      };
    });

    return NextResponse.json({
      versions: formattedVersions,
      currentUserId: user.id,
    });
  } catch (error) {
    console.error("Error fetching discovery questions versions:", error);
    return NextResponse.json(
      { error: "Failed to fetch versions" },
      { status: 500 }
    );
  }
}
