import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";

    const metrics = await prisma.coachingMetricDefinition.findMany({
      where: {
        userId: user.id,
        ...(includeArchived ? {} : { archived: false }),
      },
      orderBy: { order: "asc" },
    });

    return NextResponse.json({ metrics });
  } catch (error) {
    console.error("Error fetching metric definitions:", error);
    return NextResponse.json(
      { error: "Failed to fetch metric definitions" },
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
    const { name, definition, interval } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const maxOrder = await prisma.coachingMetricDefinition.aggregate({
      where: { userId: user.id },
      _max: { order: true },
    });

    const order = (maxOrder._max.order ?? -1) + 1;

    const metric = await prisma.coachingMetricDefinition.create({
      data: {
        userId: user.id,
        name: name.trim(),
        definition: definition?.trim() || null,
        interval: interval || null,
        order,
      },
    });

    return NextResponse.json({ metric });
  } catch (error) {
    console.error("Error creating metric definition:", error);
    return NextResponse.json(
      { error: "Failed to create metric definition" },
      { status: 500 }
    );
  }
}
