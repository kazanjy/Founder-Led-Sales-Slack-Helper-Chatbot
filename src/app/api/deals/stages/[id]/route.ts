import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * PATCH  — rename / recolor / reorder a custom stage.
 * DELETE — archive (soft) the stage. We don't hard-delete because
 *          Deal.stage rows might still reference the slug.
 */

const ALLOWED_COLORS = new Set([
  "bg-gray-100 text-gray-700",
  "bg-blue-100 text-blue-700",
  "bg-indigo-100 text-indigo-700",
  "bg-purple-100 text-purple-700",
  "bg-pink-100 text-pink-700",
  "bg-rose-100 text-rose-700",
  "bg-red-100 text-red-700",
  "bg-amber-100 text-amber-700",
  "bg-orange-100 text-orange-700",
  "bg-yellow-100 text-yellow-700",
  "bg-lime-100 text-lime-700",
  "bg-green-100 text-green-700",
  "bg-emerald-100 text-emerald-700",
  "bg-teal-100 text-teal-700",
  "bg-cyan-100 text-cyan-700",
  "bg-sky-100 text-sky-700",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;

  const existing = await prisma.customDealStage.findUnique({ where: { id } });
  if (!existing || existing.accountId !== user.accountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    label?: string;
    color?: string;
    order?: number;
    insertAfter?: string | null;
  };
  const updateData: Record<string, unknown> = {};
  if (typeof body.label === "string" && body.label.trim()) {
    updateData.label = body.label.trim();
  }
  if (typeof body.color === "string") {
    if (!ALLOWED_COLORS.has(body.color)) {
      return NextResponse.json({ error: "invalid color" }, { status: 400 });
    }
    updateData.color = body.color;
  }
  if (typeof body.order === "number") {
    updateData.order = body.order;
  }
  if (body.insertAfter !== undefined) {
    updateData.insertAfter = body.insertAfter || null;
  }

  const stage = await prisma.customDealStage.update({
    where: { id },
    data: updateData,
  });
  return NextResponse.json({ stage });
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

  const existing = await prisma.customDealStage.findUnique({ where: { id } });
  if (!existing || existing.accountId !== user.accountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Soft-delete: existing deals still point at this slug, hiding
  // the row from the picker is enough.
  await prisma.customDealStage.update({
    where: { id },
    data: { archived: true },
  });
  return NextResponse.json({ ok: true });
}
