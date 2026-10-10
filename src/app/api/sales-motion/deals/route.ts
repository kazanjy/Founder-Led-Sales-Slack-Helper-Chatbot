import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { collectionId, dealOrder } = body;

    if (!collectionId) {
      return NextResponse.json(
        { error: "collectionId is required" },
        { status: 400 }
      );
    }

    // Verify the collection belongs to the user
    const collection = await prisma.salesMotionCollection.findUnique({
      where: { id: collectionId },
    });

    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    if (collection.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // If no dealOrder provided, put it at the end
    let order = dealOrder;
    if (order === undefined || order === null) {
      const lastDeal = await prisma.salesMotionDeal.findFirst({
        where: { collectionId },
        orderBy: { dealOrder: "desc" },
      });
      order = lastDeal ? lastDeal.dealOrder + 1 : 0;
    }

    const deal = await prisma.salesMotionDeal.create({
      data: {
        collectionId,
        dealOrder: order,
      },
    });

    return NextResponse.json({ deal });
  } catch (error) {
    console.error("Error creating sales motion deal:", error);
    return NextResponse.json(
      { error: "Failed to create deal" },
      { status: 500 }
    );
  }
}
