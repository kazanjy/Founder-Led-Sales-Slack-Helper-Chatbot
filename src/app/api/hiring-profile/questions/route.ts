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
    const questions = await prisma.hiringProfileQuestion.findMany({
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

    // Get user's latest answer for each question using raw SQL for DISTINCT ON
    const latestAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "createdAt"
      FROM "hiring_profile_answers"
      WHERE "userId" = ${user.id}
      ORDER BY "questionId", "createdAt" DESC
    `;

    // Create a map of questionId to latest answer
    const answerMap = new Map<string, { answer: string; answeredAt: Date }>(
      latestAnswers.map((a) => [
        a.questionId,
        { answer: a.answer, answeredAt: a.createdAt },
      ])
    );

    // Combine questions with answers
    const questionsWithAnswers = questions.map((q) => ({
      ...q,
      latestAnswer: answerMap.get(q.id) || null,
    }));

    // Group by category (preserve order based on questions)
    const seenCategories: string[] = [];
    for (const q of questionsWithAnswers) {
      if (!seenCategories.includes(q.category)) {
        seenCategories.push(q.category);
      }
    }

    const grouped = seenCategories.map((category) => ({
      category,
      questions: questionsWithAnswers.filter((q) => q.category === category),
    }));

    return NextResponse.json({
      questions: questionsWithAnswers,
      grouped,
      totalQuestions: questions.length,
    });
  } catch (error) {
    console.error("Error fetching hiring profile questions:", error);
    return NextResponse.json(
      { error: "Failed to fetch questions" },
      { status: 500 }
    );
  }
}
