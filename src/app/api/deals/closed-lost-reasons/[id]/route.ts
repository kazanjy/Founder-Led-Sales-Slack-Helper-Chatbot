import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * PATCH  — rename / reorder a custom closed-lost reason.
 * DELETE — soft-archive. We don't hard-delete because existing
 *          Deal.closedLostReason rows might still reference the slug.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;

  const existing = await prisma.customClosedLostReason.findUnique({ where: { id } });
  if (!existing || existing.accountId !== user.accountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as { label?: string; order?: number };
  const updateData: Record<string, unknown> = {};
  if (typeof body.label === "string" && body.label.trim()) {
    updateData.label = body.label.trim();
  }
  if (typeof body.order === "number") {
    updateData.order = body.order;
  }

  const reason = await prisma.customClosedLostReason.update({
    where: { id },
    data: updateData,
  });
  return NextResponse.json({ reason });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;

  const existing = await prisma.customClosedLostReason.findUnique({ where: { id } });
  if (!existing || existing.accountId !== user.accountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.customClosedLostReason.update({
    where: { id },
    data: { archived: true },
  });
  return NextResponse.json({ ok: true });
}
