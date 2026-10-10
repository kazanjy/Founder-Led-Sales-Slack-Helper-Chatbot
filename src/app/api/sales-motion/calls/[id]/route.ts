import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { summary, transcript, recordingUrl, name, callType, callOrder } = body;

    // Verify the call's deal's collection belongs to the user
    const call = await prisma.salesMotionCall.findUnique({
      where: { id },
      include: {
        deal: {
          include: { collection: { select: { userId: true } } },
        },
      },
    });

    if (!call) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    if (call.deal.collection.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const updateData: {
      summary?: string;
      transcript?: string;
      recordingUrl?: string;
      name?: string;
      callType?: string;
      callOrder?: number;
    } = {};
    if (summary !== undefined) updateData.summary = summary;
    if (transcript !== undefined) updateData.transcript = transcript;
    if (recordingUrl !== undefined) updateData.recordingUrl = recordingUrl;
    if (name !== undefined) updateData.name = name;
    if (callType !== undefined) updateData.callType = callType;
    if (callOrder !== undefined) updateData.callOrder = callOrder;

    const updated = await prisma.salesMotionCall.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true, call: updated });
  } catch (error) {
    console.error("Error updating sales motion call:", error);
    return NextResponse.json(
      { error: "Failed to update call" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const call = await prisma.salesMotionCall.findUnique({
      where: { id },
      include: {
        deal: {
          include: { collection: { select: { userId: true } } },
        },
      },
    });

    if (!call) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    if (call.deal.collection.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await prisma.salesMotionCall.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting sales motion call:", error);
    return NextResponse.json(
      { error: "Failed to delete call" },
      { status: 500 }
    );
  }
}
