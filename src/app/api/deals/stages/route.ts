import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET  — list the account's custom deal stages.
 * POST — add a new custom stage (label + color).
 *
 * The frontend merges these with the built-in DEAL_STAGES constant
 * to render the full pipeline. Built-ins are immutable; only rows
 * stored here can be edited / archived.
 */

// Palette the UI exposes for new stages. Stored as a class-pair so
// the same string drives both the pill background and the text
// color in one go.
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

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.accountId) {
    return NextResponse.json({ stages: [], archivedBuiltinStages: [] });
  }

  const [stages, account] = await Promise.all([
    // Return ALL custom stages, including archived ones, so the client
    // can surface them in the "Archived" restore row. mergePipeline
    // already filters out archived rows from the active chip set.
    prisma.customDealStage.findMany({
      where: { accountId: user.accountId },
      orderBy: { order: "asc" },
    }),
    // Defensive read — if the archivedBuiltinStages column hasn't
    // been migrated yet, return an empty list so the pipeline still
    // renders without the feature.
    prisma.account.findUnique({
      where: { id: user.accountId },
      select: { archivedBuiltinStages: true },
    }).catch(() => null),
  ]);

  return NextResponse.json({
    stages,
    archivedBuiltinStages: account?.archivedBuiltinStages ?? [],
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.accountId) {
    return NextResponse.json({ error: "no_account" }, { status: 400 });
  }

  const body = (await request.json()) as { label?: string; color?: string; insertAfter?: string | null };
  const label = (body.label || "").trim();
  const color = (body.color || "bg-gray-100 text-gray-700").trim();
  const insertAfter = body.insertAfter || null;
  if (!label) {
    return NextResponse.json({ error: "label required" }, { status: 400 });
  }
  if (!ALLOWED_COLORS.has(color)) {
    return NextResponse.json({ error: "invalid color" }, { status: 400 });
  }

  let value = slugify(label);
  if (!value) value = `stage-${Date.now()}`;
  // De-conflict against existing values (built-in or custom).
  const BUILTIN_VALUES = new Set([
    "prospecting", "discovery", "demo", "proposal",
    "negotiation", "closing", "won", "lost",
  ]);
  let candidate = value;
  let suffix = 2;
  while (
    BUILTIN_VALUES.has(candidate) ||
    (await prisma.customDealStage.findUnique({
      where: { accountId_value: { accountId: user.accountId, value: candidate } },
    }))
  ) {
    candidate = `${value}-${suffix++}`;
    if (suffix > 50) break;
  }

  // Append at the end of the user's current ordering.
  const last = await prisma.customDealStage.findFirst({
    where: { accountId: user.accountId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const order = (last?.order ?? -1) + 1;

  const stage = await prisma.customDealStage.create({
    data: {
      accountId: user.accountId,
      value: candidate,
      label,
      color,
      order,
      insertAfter,
    },
  });

  return NextResponse.json({ stage });
}
