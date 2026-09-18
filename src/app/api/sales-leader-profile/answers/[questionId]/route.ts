import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get answer history for a specific question
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ questionId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { questionId } = await params;

    // Verify question exists
    const question = await prisma.salesLeaderProfileQuestion.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    // Get all answers for this question by this user (history)
    const answers = await prisma.salesLeaderProfileAnswer.findMany({
      where: {
        userId: user.id,
        questionId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        answer: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      question: {
        id: question.id,
        category: question.category,
        globalOrder: question.globalOrder,
        question: question.question,
        helpText: question.helpText,
      },
      answers,
      latestAnswer: answers[0] || null,
    });
  } catch (error) {
    console.error("Error fetching answer history:", error);
    return NextResponse.json(
      { error: "Failed to fetch answer history" },
      { status: 500 }
    );
  }
}

// POST - Save a new answer for a question
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ questionId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { questionId } = await params;
    const body = await request.json();
    const { answer } = body;

    if (!answer || typeof answer !== "string") {
      return NextResponse.json({ error: "Answer is required" }, { status: 400 });
    }

    // Verify question exists
    const question = await prisma.salesLeaderProfileQuestion.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    // Create new answer (append-only for history)
    const newAnswer = await prisma.salesLeaderProfileAnswer.create({
      data: {
        userId: user.id,
        questionId,
        answer: answer.trim(),
      },
    });

    // Get the next question
    const nextQuestion = await prisma.salesLeaderProfileQuestion.findFirst({
      where: {
        globalOrder: { gt: question.globalOrder },
        enabled: true,
      },
      orderBy: { globalOrder: "asc" },
      select: {
        id: true,
        globalOrder: true,
        category: true,
        question: true,
        helpText: true,
      },
    });

    return NextResponse.json({
      success: true,
      answer: {
        id: newAnswer.id,
        answer: newAnswer.answer,
        createdAt: newAnswer.createdAt,
      },
      nextQuestion,
    });
  } catch (error) {
    console.error("Error saving answer:", error);
    return NextResponse.json(
      { error: "Failed to save answer" },
      { status: 500 }
    );
  }
}
