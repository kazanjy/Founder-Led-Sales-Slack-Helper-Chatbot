import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(_request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const stage = await prisma.salesMaturityStage.findUnique({
      where: { userId: user.id },
    });

    if (!stage) {
      return NextResponse.json({ stage: null });
    }

    return NextResponse.json({
      stage: {
        currentStage: stage.currentStage,
        updatedAt: stage.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching maturity stage:", error);
    return NextResponse.json(
      { error: "Failed to fetch maturity stage" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { currentStage } = body;

    const stage = await prisma.salesMaturityStage.upsert({
      where: { userId: user.id },
      update: { currentStage },
      create: { userId: user.id, currentStage },
    });

    return NextResponse.json({
      stage: {
        currentStage: stage.currentStage,
        updatedAt: stage.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error upserting maturity stage:", error);
    return NextResponse.json(
      { error: "Failed to update maturity stage" },
      { status: 500 }
    );
  }
}
