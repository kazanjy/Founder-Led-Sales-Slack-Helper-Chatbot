import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - List all next goals with tasks
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const targetUserId = request.nextUrl.searchParams.get("userId");

    // Allow viewing another user's next goals if they're in the same account
    let userId = user.id;
    if (targetUserId && targetUserId !== user.id && user.accountId) {
      const targetUser = await prisma.user.findFirst({
        where: { id: targetUserId, accountId: user.accountId },
        select: { id: true },
      });
      if (targetUser) userId = targetUser.id;
    }

    const goals = await prisma.coachingNextGoal.findMany({
      where: { userId },
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
