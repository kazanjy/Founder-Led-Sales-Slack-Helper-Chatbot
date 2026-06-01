import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { enrichDeal } from "@/lib/deals/enrich";
import { CLOSED_LOST_REASONS } from "@/lib/deals/constants";

const CLOSED_LOST_REASON_VALUES = new Set<string>(CLOSED_LOST_REASONS.map((r) => r.value));

// Bumped so post-response enrichment scheduled via after() has time
// to finish (PDL + recorder transcript fetches add up).
export const maxDuration = 300;

async function verifyAccess(id: string, userId: string) {
  const deal = await prisma.deal.findUnique({ where: { id } });
  if (!deal || deal.userId !== userId) return null;
  return deal;
}

// GET — deal detail with participants + entries
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const exists = await verifyAccess(id, user.id);
    if (!exists) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const deal = await prisma.deal.findUnique({
      where: { id },
      include: {
        participants: { orderBy: { createdAt: "asc" } },
        entries: { orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }] },
        project: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ deal });
  } catch (error) {
    console.error("Error fetching deal:", error);
    return NextResponse.json({ error: "Failed to fetch deal" }, { status: 500 });
  }
}

// PATCH — update deal (name, stage, status, notes, projectId, companyName, companyUrl)
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
    const exists = await verifyAccess(id, user.id);
    if (!exists) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.companyName !== undefined) updateData.companyName = body.companyName.trim();
    if (body.companyUrl !== undefined) updateData.companyUrl = body.companyUrl?.trim() || null;
    if (body.stage !== undefined) updateData.stage = body.stage;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null;
    if (body.projectId !== undefined) updateData.projectId = body.projectId || null;
    if (body.projectedCloseDate !== undefined) {
      updateData.projectedCloseDate = body.projectedCloseDate
        ? new Date(body.projectedCloseDate)
        : null;
    }
    if (body.closeDate !== undefined) {
      updateData.closeDate = body.closeDate ? new Date(body.closeDate) : null;
    }
    if (body.closedLostReason !== undefined) {
      const v = body.closedLostReason?.trim();
      if (!v) {
        updateData.closedLostReason = null;
      } else if (CLOSED_LOST_REASON_VALUES.has(v)) {
        updateData.closedLostReason = v;
      } else {
        return NextResponse.json({ error: "Invalid closedLostReason" }, { status: 400 });
      }
    }

    // Auto-stamp closeDate when status flips into a terminal closed
    // state and the caller didn't pass one explicitly. Clear it if
    // the deal reopens.
    const nextStatus = body.status as string | undefined;
    if (nextStatus !== undefined && body.closeDate === undefined) {
      const becameClosed = nextStatus === "closed_won" || nextStatus === "closed_lost";
      const wasClosed = exists.status === "closed_won" || exists.status === "closed_lost";
      if (becameClosed && !wasClosed) updateData.closeDate = new Date();
      if (!becameClosed && wasClosed) updateData.closeDate = null;
    }

    const deal = await prisma.deal.update({ where: { id }, data: updateData });

    // Validation flip (potential → active): hydrate the deal with
    // calendar + recorder history + PDL participant enrichment.
    // Runs after the response so the UI doesn't block on the slow
    // network fan-out.
    if (
      body.status === "active" &&
      exists.status === "potential" &&
      deal.status === "active"
    ) {
      after(async () => {
        try {
          const summary = await enrichDeal(user.id, id);
          console.log(`[deals/${id}] post-validate enrichment:`, summary);
        } catch (err) {
          console.error(`[deals/${id}] post-validate enrichment failed:`, err);
        }
      });
    }

    return NextResponse.json({ deal });
  } catch (error) {
    console.error("Error updating deal:", error);
    return NextResponse.json({ error: "Failed to update deal" }, { status: 500 });
  }
}

// DELETE — delete deal (cascades to entries and participants)
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
    const exists = await verifyAccess(id, user.id);
    if (!exists) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    await prisma.deal.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting deal:", error);
    return NextResponse.json({ error: "Failed to delete deal" }, { status: 500 });
  }
}
