import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canEditOwnedBy } from "@/lib/coaching/access";

/**
 * Accept what someone actually pastes.
 *
 * People paste "looker.company.com/dashboards/12" without a scheme, so
 * bare hosts get https rather than being rejected. Only http and https
 * are allowed through: this value ends up in an href, and javascript:
 * or data: would make a stored link a script-execution vector for
 * anyone else on the account who clicks it.
 *
 * Returns the cleaned URL, null to clear it, or false for "not a link".
 */
function normalizeReferenceUrl(raw: unknown): string | null | false {
  if (raw === null) return null;
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return parsed.toString();
}

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

    const metric = await prisma.coachingMetricDefinition.findUnique({
      where: { id },
    });

    if (!metric) {
      return NextResponse.json(
        { error: "Metric not found" },
        { status: 404 }
      );
    }

    const allowed = await canEditOwnedBy(user.id, metric.userId);
    if (!allowed) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const { name, definition, format, interval, order, archived, referenceUrl, referenceLabel } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (definition !== undefined) updateData.definition = definition;
    if (format !== undefined) updateData.format = format;
    if (interval !== undefined) updateData.interval = interval;
    if (order !== undefined) updateData.order = order;
    if (archived !== undefined) updateData.archived = archived;
    if (referenceLabel !== undefined) updateData.referenceLabel = referenceLabel || null;
    if (referenceUrl !== undefined) {
      const normalized = normalizeReferenceUrl(referenceUrl);
      if (normalized === false) {
        return NextResponse.json(
          { error: "That doesn't look like a link. Paste the full URL to the report." },
          { status: 400 }
        );
      }
      updateData.referenceUrl = normalized;
    }

    const updated = await prisma.coachingMetricDefinition.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ metric: updated });
  } catch (error) {
    console.error("Error updating metric definition:", error);
    return NextResponse.json(
      { error: "Failed to update metric definition" },
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

    const metric = await prisma.coachingMetricDefinition.findUnique({
      where: { id },
    });

    if (!metric) {
      return NextResponse.json(
        { error: "Metric not found" },
        { status: 404 }
      );
    }

    const allowed = await canEditOwnedBy(user.id, metric.userId);
    if (!allowed) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await prisma.coachingMetricDefinition.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting metric definition:", error);
    return NextResponse.json(
      { error: "Failed to delete metric definition" },
      { status: 500 }
    );
  }
}
