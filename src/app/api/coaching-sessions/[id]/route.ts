import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { countsTowardMetrics, isSessionKind } from "@/lib/coaching/session-kind";
import { getCurrentUser } from "@/lib/auth";
import { generateSessionTitle } from "@/lib/openai";
import { canEditOwnedBy } from "@/lib/coaching/access";

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
    const { title, sessionDate, notes, transcript, recordingUrl, lockPrior, sessionKind } = body;

    // Account members can edit each other's sessions.
    const existing = await prisma.coachingSession.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const allowed = await canEditOwnedBy(user.id, existing.userId);
    if (!allowed) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const session = await prisma.coachingSession.update({
      where: { id },
      data: {
        ...(title !== undefined && title.trim() && { title: title.trim() }),
        ...(sessionDate !== undefined && { sessionDate: new Date(sessionDate) }),
        ...(notes !== undefined && { notes: notes.trim() }),
        ...(transcript !== undefined && { transcript: transcript?.trim() || null }),
        ...(recordingUrl !== undefined && { recordingUrl: recordingUrl?.trim() || null }),
        ...(isSessionKind(sessionKind) && { sessionKind }),
      },
    });

    // Switching an existing session to ad-hoc: drop the metric entries
    // it was seeded with at creation. The metric QUERIES already skip
    // ad-hoc sessions, so this isn't needed for correctness — but
    // leaving untouched zero rows behind means flipping back to
    // standard would silently resurrect them, and the session detail
    // view would still render a metrics widget for a session that
    // doesn't measure anything. Only untouched rows are removed;
    // anything with a real value entered is preserved, because
    // destroying data the founder typed to satisfy a toggle is worse
    // than a stale row.
    if (isSessionKind(sessionKind) && !countsTowardMetrics(sessionKind)) {
      await prisma.coachingMetricEntry.deleteMany({
        where: { sessionId: id, currentValue: 0 },
      });
    }

    // Switching back to standard: seed the entries creation would have
    // made. Without this the session returns to the metrics cadence
    // with an empty panel and no way to fill it, since entries are only
    // ever created at session creation.
    if (isSessionKind(sessionKind) && countsTowardMetrics(sessionKind)) {
      const [allMetrics, existingEntries] = await Promise.all([
        prisma.coachingMetricDefinition.findMany({
          where: { userId: existing.userId, archived: false, kind: "metric" },
          select: { id: true },
        }),
        prisma.coachingMetricEntry.findMany({
          where: { sessionId: id },
          select: { metricDefinitionId: true },
        }),
      ]);
      const have = new Set(existingEntries.map((e) => e.metricDefinitionId));
      const missing = allMetrics.filter((m) => !have.has(m.id));
      if (missing.length > 0) {
        await prisma.coachingMetricEntry.createMany({
          data: missing.map((m) => ({
            userId: existing.userId,
            metricDefinitionId: m.id,
            sessionId: id,
            currentValue: 0,
            addedSinceLastSession: 0,
          })),
        });
      }
    }

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

    // Account members can delete each other's sessions.
    const existing = await prisma.coachingSession.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const allowed = await canEditOwnedBy(user.id, existing.userId);
    if (!allowed) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await prisma.coachingSession.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Coaching Sessions] Delete error:", error);
    return NextResponse.json({ error: "Failed to delete coaching session" }, { status: 500 });
  }
}
