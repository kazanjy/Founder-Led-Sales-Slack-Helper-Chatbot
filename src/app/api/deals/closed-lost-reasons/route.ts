import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { CLOSED_LOST_REASONS } from "@/lib/deals/constants";

/**
 * GET  — list the account's custom closed-lost reasons (active only).
 * POST — add a new custom reason (label only — slug is derived).
 *
 * The frontend merges these with the built-in CLOSED_LOST_REASONS
 * constant to render the full picker. Built-ins are immutable; only
 * rows stored here can be edited / archived.
 */

const BUILTIN_VALUES = new Set<string>(CLOSED_LOST_REASONS.map((r) => r.value));

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.accountId) {
    return NextResponse.json({ reasons: [] });
  }

  const reasons = await prisma.customClosedLostReason.findMany({
    where: { accountId: user.accountId, archived: false },
    orderBy: { order: "asc" },
  });

  return NextResponse.json({ reasons });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.accountId) {
    return NextResponse.json({ error: "no_account" }, { status: 400 });
  }

  const body = (await request.json()) as { label?: string };
  const label = (body.label || "").trim();
  if (!label) {
    return NextResponse.json({ error: "label required" }, { status: 400 });
  }

  let value = slugify(label);
  if (!value) value = `reason_${Date.now()}`;
  // De-conflict against built-in + existing custom slugs (including
  // archived rows so we don't accidentally collide with a tombstone).
  let candidate = value;
  let suffix = 2;
  while (
    BUILTIN_VALUES.has(candidate) ||
    (await prisma.customClosedLostReason.findUnique({
      where: { accountId_value: { accountId: user.accountId, value: candidate } },
    }))
  ) {
    candidate = `${value}_${suffix++}`;
    if (suffix > 50) break;
  }

  const last = await prisma.customClosedLostReason.findFirst({
    where: { accountId: user.accountId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const order = (last?.order ?? -1) + 1;

  const reason = await prisma.customClosedLostReason.create({
    data: {
      accountId: user.accountId,
      value: candidate,
      label,
      order,
    },
  });

  return NextResponse.json({ reason });
}
