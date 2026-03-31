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

    const metric = await prisma.metricDefinition.findUnique({
      where: { id },
    });

    if (!metric) {
      return NextResponse.json(
        { error: "Metric not found" },
        { status: 404 }
      );
    }

    if (metric.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const { name, definition, interval, order } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (definition !== undefined) updateData.definition = definition;
    if (interval !== undefined) updateData.interval = interval;
    if (order !== undefined) updateData.order = order;

    const updated = await prisma.metricDefinition.update({
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

    const metric = await prisma.metricDefinition.findUnique({
      where: { id },
    });

    if (!metric) {
      return NextResponse.json(
        { error: "Metric not found" },
        { status: 404 }
      );
    }

    if (metric.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await prisma.metricDefinition.delete({
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
