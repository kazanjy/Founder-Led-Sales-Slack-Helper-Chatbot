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

    const versions = await prisma.discoveryQuestionsVersion.findMany({
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
        questionCount,
        salesNarrativeVersionId: v.salesNarrativeVersionId,
        salesNarrativeCreatedAt: v.salesNarrativeVersion.createdAt,
        createdAt: v.createdAt,
      };
    });

    return NextResponse.json({
      versions: formattedVersions,
    });
  } catch (error) {
    console.error("Error fetching discovery questions versions:", error);
    return NextResponse.json(
      { error: "Failed to fetch versions" },
      { status: 500 }
    );
  }
}
