import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * PATCH — toggle / partial-update a saved pattern (currently just
 * the `enabled` field).
 * DELETE — remove a saved pattern.
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
  const body = (await request.json()) as { enabled?: boolean };

  const existing = await prisma.recurringResearchPattern.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.recurringResearchPattern.update({
    where: { id },
    data: {
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    },
  });

  return NextResponse.json({ pattern: updated });
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

  const existing = await prisma.recurringResearchPattern.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.recurringResearchPattern.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
