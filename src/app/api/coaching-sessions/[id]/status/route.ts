import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const VALID_TRANSITIONS: Record<string, string[]> = {
  new: ["in_progress", "locked"],
  in_progress: ["locked"],
};

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

    const session = await prisma.coachingSession.findUnique({
      where: { id },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    if (session.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const { status } = body;

    const allowedTransitions = VALID_TRANSITIONS[session.sessionStatus] || [];
    if (!allowedTransitions.includes(status)) {
      return NextResponse.json(
        {
          error: `Invalid status transition from "${session.sessionStatus}" to "${status}"`,
        },
        { status: 400 }
      );
    }

    const updated = await prisma.coachingSession.update({
      where: { id },
      data: { sessionStatus: status },
    });

    return NextResponse.json({
      session: {
        id: updated.id,
        sessionStatus: updated.sessionStatus,
      },
    });
  } catch (error) {
    console.error("Error updating session status:", error);
    return NextResponse.json(
      { error: "Failed to update session status" },
      { status: 500 }
    );
  }
}
