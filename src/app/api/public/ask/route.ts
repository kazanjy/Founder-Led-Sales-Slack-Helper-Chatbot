import { NextRequest, NextResponse } from "next/server";
import { createPublicAnswer } from "@/lib/public-answers/generate";

// Chatbase calls can take 10-30s
export const maxDuration = 120;

/**
 * POST /api/public/ask — Submit a question from the Ask Mikey page
 * No auth required — fully public.
 *
 * Body: { question: string }
 * Returns the created answer with its slug for redirect.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question } = body;

    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Question is required" },
        { status: 400 }
      );
    }

    const trimmed = question.trim();
    if (trimmed.length < 10) {
      return NextResponse.json(
        { error: "Question must be at least 10 characters" },
        { status: 400 }
      );
    }

    if (trimmed.length > 2000) {
      return NextResponse.json(
        { error: "Question must be under 2000 characters" },
        { status: 400 }
      );
    }

    const answer = await createPublicAnswer({
      question: trimmed,
      source: "ask-mikey",
    });

    return NextResponse.json({
      answer: {
        id: answer.id,
        slug: answer.slug,
        question: answer.question,
        preview: answer.preview,
      },
    });
  } catch (error) {
    console.error("Ask Mikey submission error:", error);
    return NextResponse.json(
      { error: "Failed to generate answer. Please try again." },
      { status: 500 }
    );
  }
}
