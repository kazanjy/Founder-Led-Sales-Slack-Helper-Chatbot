import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get the latest sales narrative version (for merge variables display)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const latestVersion = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        answers: {
          include: {
            question: {
              select: {
                id: true,
                category: true,
                globalOrder: true,
                question: true,
              },
            },
          },
          orderBy: {
            question: {
              globalOrder: "asc",
            },
          },
        },
      },
    });

    if (!latestVersion) {
      return NextResponse.json({
        hasNarrative: false,
        version: null,
        answersByCategory: null,
      });
    }

    // Group answers by category
    const categoryOrder = ["Product", "Problem", "Solution", "Proof", "Business"];
    const answersByCategory: Record<string, Array<{
      questionId: string;
      globalOrder: number;
      question: string;
      answer: string;
    }>> = {};

    for (const category of categoryOrder) {
      answersByCategory[category] = [];
    }

    for (const answer of latestVersion.answers) {
      const category = answer.question.category;
      if (answersByCategory[category]) {
        answersByCategory[category].push({
          questionId: answer.question.id,
          globalOrder: answer.question.globalOrder,
          question: answer.question.question,
          answer: answer.answer,
        });
      }
    }

    return NextResponse.json({
      hasNarrative: true,
      version: {
        id: latestVersion.id,
        title: latestVersion.title,
        narrative: latestVersion.narrative,
        description1000w: latestVersion.description1000w,
        description100w: latestVersion.description100w,
        description50w: latestVersion.description50w,
        description25w: latestVersion.description25w,
        sourceUrls: latestVersion.sourceUrls,
        sourcePdfNames: latestVersion.sourcePdfNames,
        createdAt: latestVersion.createdAt,
      },
      answersByCategory,
    });
  } catch (error) {
    console.error("Error fetching latest sales narrative:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest narrative" },
      { status: 500 }
    );
  }
}
