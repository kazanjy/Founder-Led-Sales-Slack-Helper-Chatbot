import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - List all next goals with tasks
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const goals = await prisma.coachingNextGoal.findMany({
      where: { userId: user.id },
      orderBy: { order: "asc" },
      include: {
        tasks: { orderBy: { order: "asc" } },
      },
    });

    return NextResponse.json({ goals });
  } catch (error) {
    console.error("Error fetching next goals:", error);
    return NextResponse.json({ error: "Failed to fetch next goals" }, { status: 500 });
  }
}

// POST - Create a new next goal
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { title, description } = await request.json();
    if (!title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const maxOrder = await prisma.coachingNextGoal.aggregate({
      where: { userId: user.id },
      _max: { order: true },
    });

    const goal = await prisma.coachingNextGoal.create({
      data: {
        userId: user.id,
        title: title.trim(),
        description: description?.trim() || null,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    console.error("Error creating next goal:", error);
    return NextResponse.json({ error: "Failed to create next goal" }, { status: 500 });
  }
}
