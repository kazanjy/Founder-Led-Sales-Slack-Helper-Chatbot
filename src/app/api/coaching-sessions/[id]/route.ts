import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Helper to build a where clause scoped to the user's account (or just the user)
function accountScope(user: { id: string; accountId: string | null }, id: string) {
  if (user.accountId) {
    return { id, user: { accountId: user.accountId } };
  }
  return { id, userId: user.id };
}

// GET - Fetch a single coaching session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const session = await prisma.coachingSession.findFirst({
      where: accountScope(user, id),
      include: {
        user: { select: { name: true, email: true, slackUserName: true } },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error("[Coaching Sessions] Get error:", error);
    return NextResponse.json({ error: "Failed to fetch coaching session" }, { status: 500 });
  }
}

// PUT - Update a coaching session
export async function PUT(
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
    const { title, sessionDate, notes, transcript, recordingUrl } = body;

    // Verify access (account-scoped)
    const existing = await prisma.coachingSession.findFirst({
      where: accountScope(user, id),
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const session = await prisma.coachingSession.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(sessionDate !== undefined && { sessionDate: new Date(sessionDate) }),
        ...(notes !== undefined && { notes: notes.trim() }),
        ...(transcript !== undefined && { transcript: transcript?.trim() || null }),
        ...(recordingUrl !== undefined && { recordingUrl: recordingUrl?.trim() || null }),
      },
    });

    return NextResponse.json({ session });
  } catch (error) {
    console.error("[Coaching Sessions] Update error:", error);
    return NextResponse.json({ error: "Failed to update coaching session" }, { status: 500 });
  }
}

// DELETE - Delete a coaching session
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    // Verify access (account-scoped)
    const existing = await prisma.coachingSession.findFirst({
      where: accountScope(user, id),
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await prisma.coachingSession.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Coaching Sessions] Delete error:", error);
    return NextResponse.json({ error: "Failed to delete coaching session" }, { status: 500 });
  }
}
