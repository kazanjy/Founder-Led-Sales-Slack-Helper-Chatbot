import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

/**
 * GET /api/admin/public-mikey/answers — Paginated list for admin table
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);
    const status = searchParams.get("status") || "";
    const source = searchParams.get("source") || "";
    const search = searchParams.get("search") || "";
    const sort = searchParams.get("sort") || "createdAt";
    const order = searchParams.get("order") === "asc" ? "asc" : "desc";

    const where: Record<string, unknown> = {};

    if (status) where.status = status;
    if (source) where.source = source;
    if (search) {
      where.question = { contains: search, mode: "insensitive" };
    }

    const orderBy: Record<string, string> = {};
    if (sort === "viewCount" || sort === "createdAt" || sort === "status") {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = "desc";
    }

    const [answers, total] = await Promise.all([
      prisma.publicAnswer.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          question: true,
          slug: true,
          preview: true,
          source: true,
          status: true,
          viewCount: true,
          twitterHandle: true,
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
    console.error("Admin public-mikey answers error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
