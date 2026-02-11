import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Fetch user's assessment history
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const assessmentId = searchParams.get("id");

    // If specific assessment ID requested, return that assessment with answers
    if (assessmentId) {
      const assessment = await prisma.maturityAssessment.findFirst({
        where: {
          id: assessmentId,
          userId: user.id,
        },
        include: {
          conversation: {
            select: {
              id: true,
              title: true,
            },
          },
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

      if (!assessment) {
        return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
      }

      // Group answers by category
      const categories: Record<string, Array<{
        questionId: string;
        globalOrder: number;
        question: string;
        answer: string;
      }>> = {};

      for (const answer of assessment.answers) {
        const category = answer.question.category;
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push({
          questionId: answer.question.id,
          globalOrder: answer.question.globalOrder,
          question: answer.question.question,
          answer: answer.answer,
        });
      }

      // Sort categories by their first question's globalOrder
      const sortedCategories = Object.entries(categories)
        .sort((a, b) => {
          const aFirst = a[1][0]?.globalOrder || 0;
          const bFirst = b[1][0]?.globalOrder || 0;
          return aFirst - bFirst;
        })
        .map(([name, questions]) => ({ name, questions }));

      return NextResponse.json({
        assessment: {
          id: assessment.id,
          title: assessment.title,
          completedAt: assessment.completedAt,
          conversationId: assessment.conversation?.id,
          conversationTitle: assessment.conversation?.title,
          categories: sortedCategories,
        },
      });
    }

    // Otherwise, return list of all assessments (without answers for efficiency)
    const assessments = await prisma.maturityAssessment.findMany({
      where: { userId: user.id },
      orderBy: { completedAt: "desc" },
      include: {
        conversation: {
          select: {
            id: true,
            title: true,
          },
        },
        _count: {
          select: {
            answers: true,
          },
        },
      },
    });

    // Also check for in-progress assessment (answers without a completed assessment)
    const totalQuestions = await prisma.maturityQuestion.count();

    // Count unique questions answered (not total answer rows, which can have duplicates)
    const inProgressQuestions = await prisma.maturityAnswer.groupBy({
      by: ["questionId"],
      where: {
        userId: user.id,
        assessmentId: null, // Not yet submitted
      },
    });

    // Get the most recent answer time for display
    const mostRecentAnswer = await prisma.maturityAnswer.findFirst({
      where: {
        userId: user.id,
        assessmentId: null,
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    // Build response with in-progress status
    const result: {
      id: string;
      title: string | null;
      completedAt: Date | null;
      conversationId: string | null;
      answerCount: number;
      status: "completed" | "in_progress";
    }[] = [];

    // Add in-progress if there are unsaved answers
    if (inProgressQuestions.length > 0) {
      result.push({
        id: "in-progress",
        title: "Assessment in Progress",
        completedAt: mostRecentAnswer?.createdAt || null,
        conversationId: null,
        answerCount: inProgressQuestions.length, // Count unique questions, not total answer rows
        status: "in_progress",
      });
    }

    // Add completed assessments
    assessments.forEach((a) => {
      result.push({
        id: a.id,
        title: a.title,
        completedAt: a.completedAt,
        conversationId: a.conversation?.id || null,
        answerCount: a._count.answers,
        status: "completed",
      });
    });

    return NextResponse.json({
      assessments: result,
      totalQuestions,
    });
  } catch (error) {
    console.error("Error fetching assessment history:", error);
    return NextResponse.json(
      { error: "Failed to fetch assessment history" },
      { status: 500 }
    );
  }
}
