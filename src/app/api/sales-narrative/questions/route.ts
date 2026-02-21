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
    const questions = await prisma.salesNarrativeQuestion.findMany({
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
      FROM "sales_narrative_answers"
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

    // Group by category (preserve order: Product, Problem, Solution, Proof, Business)
    const categoryOrder = ["Product", "Problem", "Solution", "Proof", "Business"];
    const grouped = categoryOrder
      .filter((cat) => questionsWithAnswers.some((q) => q.category === cat))
      .map((category) => ({
        category,
        questions: questionsWithAnswers.filter((q) => q.category === category),
      }));

    return NextResponse.json({
      questions: questionsWithAnswers,
      grouped,
      totalQuestions: questions.length,
    });
  } catch (error) {
    console.error("Error fetching sales narrative questions:", error);
    return NextResponse.json(
      { error: "Failed to fetch questions" },
      { status: 500 }
    );
  }
}
