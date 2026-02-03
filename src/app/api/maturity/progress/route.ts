import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get total enabled question count
    const totalQuestions = await prisma.maturityQuestion.count({
      where: { enabled: true },
    });

    // Get IDs of enabled questions
    const enabledQuestions = await prisma.maturityQuestion.findMany({
      where: { enabled: true },
      select: { id: true },
    });
    const enabledQuestionIds = enabledQuestions.map(q => q.id);

    // Get count of enabled questions the user has answered (at least once)
    const answeredQuestions = await prisma.maturityAnswer.groupBy({
      by: ["questionId"],
      where: {
        userId: user.id,
        questionId: { in: enabledQuestionIds },
      },
    });

    const answeredCount = answeredQuestions.length;

    // Get the most recent assessment if any
    const latestAssessment = await prisma.maturityAssessment.findFirst({
      where: { userId: user.id },
      orderBy: { completedAt: "desc" },
      include: {
        conversation: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    // Get the first unanswered enabled question (for resume)
    const answeredQuestionIds = answeredQuestions.map((a: { questionId: string }) => a.questionId);
    const nextQuestion = await prisma.maturityQuestion.findFirst({
      where: {
        enabled: true,
        id: { notIn: answeredQuestionIds.length > 0 ? answeredQuestionIds : ["none"] },
      },
      orderBy: { globalOrder: "asc" },
      select: {
        id: true,
        globalOrder: true,
        category: true,
      },
    });

    // Determine status
    let status: "not_started" | "in_progress" | "completed";
    if (answeredCount === 0) {
      status = "not_started";
    } else if (answeredCount >= totalQuestions) {
      status = "completed";
    } else {
      status = "in_progress";
    }

    return NextResponse.json({
      status,
      totalQuestions,
      answeredCount,
      progressPercent: totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0,
      nextQuestion,
      latestAssessment: latestAssessment
        ? {
            id: latestAssessment.id,
            completedAt: latestAssessment.completedAt,
            conversationId: latestAssessment.conversationId,
            conversationTitle: latestAssessment.conversation?.title,
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching maturity progress:", error);
    return NextResponse.json(
      { error: "Failed to fetch progress" },
      { status: 500 }
    );
  }
}
