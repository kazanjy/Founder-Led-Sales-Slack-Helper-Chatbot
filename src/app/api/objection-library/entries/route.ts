import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - List all entries for current user, with optional filters
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const persona = searchParams.get("persona");
    const search = searchParams.get("search");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { userId: user.id };

    if (category && category !== "ALL") {
      where.category = category;
    }

    if (persona) {
      where.OR = [
        { orgPersona: { contains: persona, mode: "insensitive" } },
        { humanPersona: { contains: persona, mode: "insensitive" } },
      ];
    }

    if (search) {
      const searchFilter = [
        { objection: { contains: search, mode: "insensitive" as const } },
        { handle: { contains: search, mode: "insensitive" as const } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchFilter }];
        delete where.OR;
      } else {
        where.OR = searchFilter;
      }
    }

    const entries = await prisma.objectionEntry.findMany({
      where,
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Error fetching objection entries:", error);
    return NextResponse.json(
      { error: "Failed to fetch objection entries" },
      { status: 500 }
    );
  }
}

// POST - Create a new manual entry
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { objection, category, handle, orgPersona, humanPersona, notes } = await request.json();

    if (!objection || !category || !handle || !orgPersona || !humanPersona) {
      return NextResponse.json(
        { error: "Missing required fields: objection, category, handle, orgPersona, humanPersona" },
        { status: 400 }
      );
    }

    const validCategories = [
      "NEED", "PRIORITY", "ROI", "PRODUCT", "COMPETITION",
      "ADOPTION", "BUDGET", "TRUST", "AUTHORITY",
    ];
    if (!validCategories.includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const entry = await prisma.objectionEntry.create({
      data: {
        userId: user.id,
        objection,
        category,
        handle,
        orgPersona,
        humanPersona,
        notes: notes || null,
        source: "manual",
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error creating objection entry:", error);
    return NextResponse.json(
      { error: "Failed to create objection entry" },
      { status: 500 }
    );
  }
}
