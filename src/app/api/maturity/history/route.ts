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

    return NextResponse.json({
      assessments: assessments.map((a) => ({
        id: a.id,
        title: a.title,
        completedAt: a.completedAt,
        conversationId: a.conversation?.id,
        answerCount: a._count.answers,
      })),
    });
  } catch (error) {
    console.error("Error fetching assessment history:", error);
    return NextResponse.json(
      { error: "Failed to fetch assessment history" },
      { status: 500 }
    );
  }
}
