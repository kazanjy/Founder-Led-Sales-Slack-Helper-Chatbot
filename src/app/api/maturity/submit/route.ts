import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// POST - Submit the completed assessment and create AI recommendations conversation
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get all questions with user's latest answers
    const questions = await prisma.maturityQuestion.findMany({
      orderBy: { globalOrder: "asc" },
    });

    // Get user's latest answer for each question
    const latestAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "createdAt"
      FROM "maturity_answers"
      WHERE "userId" = ${user.id}
      ORDER BY "questionId", "createdAt" DESC
    `;

    const answerMap = new Map<string, string>(
      latestAnswers.map((a: { questionId: string; answer: string }) => [a.questionId, a.answer])
    );

    // Check if at least some questions are answered
    const answeredCount = latestAnswers.length;
    if (answeredCount === 0) {
      return NextResponse.json(
        { error: "No answers found. Please answer at least some questions before submitting." },
        { status: 400 }
      );
    }

    // Define question type for clarity
    type QuestionType = typeof questions[0];

    // Build the assessment summary for the AI
    const categories = Array.from(new Set(questions.map((q: QuestionType) => q.category))) as string[];
    let assessmentSummary = "# GTM Maturity Assessment Results\n\n";

    for (const category of categories) {
      assessmentSummary += `## ${category}\n\n`;
      const categoryQuestions = questions.filter((q: QuestionType) => q.category === category);

      for (const q of categoryQuestions) {
        const answer = answerMap.get(q.id);
        assessmentSummary += `**Q${q.globalOrder}: ${q.question}**\n`;
        if (answer) {
          assessmentSummary += `${answer}\n\n`;
        } else {
          assessmentSummary += `_Not answered_\n\n`;
        }
      }
    }

    // Create a new conversation for the AI recommendations
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        source: "WEB",
        title: "GTM Maturity Assessment - Recommendations",
        firstMessagePreview: "Based on your GTM maturity assessment...",
        messageCount: 1,
      },
    });

    // Create the initial user message with the assessment
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        userId: user.id,
        role: "USER",
        content: `I've completed the GTM Maturity Assessment. Please analyze my responses and provide personalized recommendations for improving my go-to-market strategy. Here are my responses:\n\n${assessmentSummary}`,
      },
    });

    // Create the maturity assessment record
    const assessment = await prisma.maturityAssessment.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
      },
    });

    return NextResponse.json({
      success: true,
      assessment: {
        id: assessment.id,
        completedAt: assessment.completedAt,
      },
      conversation: {
        id: conversation.id,
        title: conversation.title,
      },
      summary: {
        totalQuestions: questions.length,
        answeredCount,
        categories: categories.map((cat) => ({
          name: cat,
          totalQuestions: questions.filter((q: QuestionType) => q.category === cat).length,
          answeredCount: questions.filter(
            (q: QuestionType) => q.category === cat && answerMap.has(q.id)
          ).length,
        })),
      },
    });
  } catch (error) {
    console.error("Error submitting assessment:", error);
    return NextResponse.json(
      { error: "Failed to submit assessment" },
      { status: 500 }
    );
  }
}
