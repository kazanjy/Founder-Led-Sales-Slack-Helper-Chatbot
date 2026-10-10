import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

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
    const { answer, source } = body;

    if (!answer || typeof answer !== "string") {
      return NextResponse.json({ error: "Answer is required" }, { status: 400 });
    }

    // Verify question exists
    const question = await prisma.salesMetricsQuestion.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    // Create new answer (we keep history, so we always create new)
    const newAnswer = await prisma.salesMetricsAnswer.create({
      data: {
        userId: user.id,
        questionId,
        answer: answer.trim(),
        source: source || "manual",
      },
    });

    return NextResponse.json({
      success: true,
      answer: {
        id: newAnswer.id,
        answer: newAnswer.answer,
        source: newAnswer.source,
        createdAt: newAnswer.createdAt,
      },
    });
  } catch (error) {
    console.error("Error saving sales metrics answer:", error);
    return NextResponse.json(
      { error: "Failed to save answer" },
      { status: 500 }
    );
  }
}
