import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const assessmentId = searchParams.get("id");

    // If specific assessment ID requested, return full details
    if (assessmentId) {
      const assessment = await prisma.salesMetricsAssessment.findFirst({
        where: { id: assessmentId, userId: user.id },
        include: {
          conversation: {
            select: { id: true, title: true },
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
              question: { globalOrder: "asc" },
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
        source: string;
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
          source: answer.source,
        });
      }

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
          csvFileName: assessment.csvFileName,
          calculatedMetrics: assessment.calculatedMetrics ? JSON.parse(assessment.calculatedMetrics) : null,
          analysisReport: assessment.analysisReport,
          categories: sortedCategories,
        },
      });
    }

    // Otherwise return list of all assessments
    const assessments = await prisma.salesMetricsAssessment.findMany({
      where: { userId: user.id },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        title: true,
        completedAt: true,
        conversationId: true,
        csvFileName: true,
        _count: {
          select: { answers: true },
        },
      },
    });

    return NextResponse.json({
      assessments: assessments.map((a) => ({
        id: a.id,
        title: a.title,
        completedAt: a.completedAt,
        conversationId: a.conversationId,
        csvFileName: a.csvFileName,
        answerCount: a._count.answers,
      })),
    });
  } catch (error) {
    console.error("Error fetching sales metrics history:", error);
    return NextResponse.json(
      { error: "Failed to fetch assessment history" },
      { status: 500 }
    );
  }
}
