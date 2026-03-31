import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const where: { userId: string; status?: string } = { userId: user.id };
    if (status) {
      where.status = status;
    }

    const goals = await prisma.coachingGoal.findMany({
      where,
      orderBy: { order: "asc" },
      include: {
        tasks: {
          orderBy: { order: "asc" },
        },
      },
    });

    return NextResponse.json({ goals });
  } catch (error) {
    console.error("Error fetching coaching goals:", error);
    return NextResponse.json(
      { error: "Failed to fetch coaching goals" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { sessionId, title, description } = body;

    const maxOrder = await prisma.coachingGoal.aggregate({
      where: { userId: user.id },
      _max: { order: true },
    });

    const order = (maxOrder._max.order ?? -1) + 1;

    const goal = await prisma.coachingGoal.create({
      data: {
        userId: user.id,
        sessionId,
        title,
        description,
        order,
      },
      include: {
        tasks: true,
      },
    });

    return NextResponse.json({ goal });
  } catch (error) {
    console.error("Error creating coaching goal:", error);
    return NextResponse.json(
      { error: "Failed to create coaching goal" },
      { status: 500 }
    );
  }
}
