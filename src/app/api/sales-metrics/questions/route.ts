import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get all enabled questions ordered by globalOrder
    const questions = await prisma.salesMetricsQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
      select: {
        id: true,
        category: true,
        globalOrder: true,
        question: true,
        helpText: true,
      },
    });

    // Get user's latest answer for each question
    const latestAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; source: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "source", "createdAt"
      FROM "sales_metrics_answers"
      WHERE "userId" = ${user.id}
      ORDER BY "questionId", "createdAt" DESC
    `;

    // Create a map of questionId to latest answer
    const answerMap = new Map<string, { answer: string; source: string; answeredAt: Date }>(
      latestAnswers.map((a) => [
        a.questionId,
        { answer: a.answer, source: a.source, answeredAt: a.createdAt }
      ])
    );

    // Combine questions with answers
    const questionsWithAnswers = questions.map((q) => ({
      ...q,
      latestAnswer: answerMap.get(q.id) || null,
    }));

    // Group by category
    const categories = Array.from(new Set(questions.map((q) => q.category))) as string[];
    const grouped = categories.map((category) => ({
      category,
      questions: questionsWithAnswers.filter((q) => q.category === category),
    }));

    return NextResponse.json({
      questions: questionsWithAnswers,
      grouped,
      totalQuestions: questions.length,
    });
  } catch (error) {
    console.error("Error fetching sales metrics questions:", error);
    return NextResponse.json(
      { error: "Failed to fetch questions" },
      { status: 500 }
    );
  }
}
