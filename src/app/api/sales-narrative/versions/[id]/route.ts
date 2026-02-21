import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get a specific sales narrative version with its answers snapshot
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

    const version = await prisma.salesNarrativeVersion.findUnique({
      where: { id },
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

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Verify ownership
    if (version.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Group answers by category
    const categoryOrder = ["Problem", "Solution", "Proof", "Business"];
    const answersByCategory: Record<string, Array<{
      questionId: string;
      globalOrder: number;
      question: string;
      answer: string;
    }>> = {};

    for (const category of categoryOrder) {
      answersByCategory[category] = [];
    }

    for (const answer of version.answers) {
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
      version: {
        id: version.id,
        narrative: version.narrative,
        description100w: version.description100w,
        description50w: version.description50w,
        description25w: version.description25w,
        createdAt: version.createdAt,
      },
      answersByCategory,
    });
  } catch (error) {
    console.error("Error fetching sales narrative version:", error);
    return NextResponse.json(
      { error: "Failed to fetch version" },
      { status: 500 }
    );
  }
}
