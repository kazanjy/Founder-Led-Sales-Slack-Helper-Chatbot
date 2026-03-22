import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/public/answers — List published answers (paginated, filterable)
 * No auth required — fully public.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);
    const search = searchParams.get("search") || "";
    const source = searchParams.get("source") || "";

    const where: Record<string, unknown> = { status: "published" };

    if (search) {
      where.question = { contains: search, mode: "insensitive" };
    }

    if (source === "twitter" || source === "ask-mikey") {
      where.source = source;
    }

    const [answers, total] = await Promise.all([
      prisma.publicAnswer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          question: true,
          slug: true,
          preview: true,
          source: true,
          viewCount: true,
          createdAt: true,
        },
      }),
      prisma.publicAnswer.count({ where }),
    ]);

    return NextResponse.json({
      answers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Public answers list error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
