import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/public/answers/[slug] — Single answer by slug
 * No auth required — fully public.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params;

    const answer = await prisma.publicAnswer.findUnique({
      where: { slug, status: "published" },
    });

    if (!answer) {
      return NextResponse.json(
        { error: "Answer not found" },
        { status: 404 }
      );
    }

    // Increment view count (fire-and-forget)
    prisma.publicAnswer
      .update({
        where: { id: answer.id },
        data: { viewCount: { increment: 1 } },
      })
      .catch(() => {});

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("Public answer detail error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
