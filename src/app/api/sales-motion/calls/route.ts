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
    const { dealId, summary, transcript, recordingUrl, callOrder } = body;

    if (!dealId) {
      return NextResponse.json(
        { error: "dealId is required" },
        { status: 400 }
      );
    }

    // Verify the deal's collection belongs to the user
    const deal = await prisma.salesMotionDeal.findUnique({
      where: { id: dealId },
      include: { collection: { select: { userId: true } } },
    });

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    if (deal.collection.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // If no callOrder provided, put it at the end
    let order = callOrder;
    if (order === undefined || order === null) {
      const lastCall = await prisma.salesMotionCall.findFirst({
        where: { dealId },
        orderBy: { callOrder: "desc" },
      });
      order = lastCall ? lastCall.callOrder + 1 : 0;
    }

    const call = await prisma.salesMotionCall.create({
      data: {
        dealId,
        summary: summary || null,
        transcript: transcript || null,
        recordingUrl: recordingUrl || null,
        callOrder: order,
      },
    });

    return NextResponse.json({ call });
  } catch (error) {
    console.error("Error creating sales motion call:", error);
    return NextResponse.json(
      { error: "Failed to create call" },
      { status: 500 }
    );
  }
}
