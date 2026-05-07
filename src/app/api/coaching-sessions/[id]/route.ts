import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateSessionTitle } from "@/lib/openai";

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
        goals: {
          orderBy: { order: "asc" },
          include: {
            tasks: { orderBy: { order: "asc" } },
          },
        },
        metricEntries: {
          include: {
            metricDefinition: true,
          },
          orderBy: { metricDefinition: { order: "asc" } },
        },
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
    const { title, sessionDate, notes, transcript, recordingUrl, lockPrior } = body;

    // Only the creator can update
    const existing = await prisma.coachingSession.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Only the session creator can edit" }, { status: 403 });
    }

    const session = await prisma.coachingSession.update({
      where: { id },
      data: {
        ...(title !== undefined && title.trim() && { title: title.trim() }),
        ...(sessionDate !== undefined && { sessionDate: new Date(sessionDate) }),
        ...(notes !== undefined && { notes: notes.trim() }),
        ...(transcript !== undefined && { transcript: transcript?.trim() || null }),
        ...(recordingUrl !== undefined && { recordingUrl: recordingUrl?.trim() || null }),
      },
    });

    // When the client explicitly promotes a draft into a real session
    // ("Create Session" click — autosave doesn't pass this flag), lock
    // every other still-open session for this user. Mirrors the POST
    // create flow's carry-forward logic for users who started from an
    // autosaved draft.
    if (lockPrior) {
      await prisma.coachingSession.updateMany({
        where: {
          userId: user.id,
          id: { not: id },
          sessionStatus: { in: ["new", "in_progress"] },
        },
        data: { sessionStatus: "locked" },
      });
    }

    // Auto-generate title if it's still a draft placeholder and real notes were provided
    const isRealSave = notes?.trim() && notes.trim() !== "(draft)" && notes.trim() !== "";
    if ((!session.title || session.title.startsWith("It appears")) && isRealSave) {
      const generatedTitle = await generateSessionTitle(notes.trim(), transcript?.trim());
      await prisma.coachingSession.update({
        where: { id },
        data: { title: generatedTitle },
      });
      return NextResponse.json({ session: { ...session, title: generatedTitle } });
    }

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

    // Only the creator can delete
    const existing = await prisma.coachingSession.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Only the session creator can delete" }, { status: 403 });
    }

    await prisma.coachingSession.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Coaching Sessions] Delete error:", error);
    return NextResponse.json({ error: "Failed to delete coaching session" }, { status: 500 });
  }
}
