import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_SLOTS } from "@/lib/sales-asset-library/seed-data";

// Ensure the 14 default slots exist for the given account
async function ensureDefaults(accountId: string) {
  const existing = await prisma.salesAsset.findMany({
    where: { accountId, isDefault: true },
    select: { slotKey: true },
  });
  const existingKeys = new Set(existing.map((e) => e.slotKey));

  const toCreate = DEFAULT_SLOTS
    .map((slot, idx) => ({ ...slot, order: idx }))
    .filter((slot) => !existingKeys.has(slot.slotKey));

  if (toCreate.length === 0) return;

  await prisma.salesAsset.createMany({
    data: toCreate.map((slot) => ({
      accountId,
      name: slot.name,
      description: slot.description || null,
      category: slot.category,
      isDefault: true,
      slotKey: slot.slotKey,
      order: slot.order,
    })),
    skipDuplicates: true,
  });
}

// GET — list all assets for the user's account (auto-seed defaults)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!user.accountId) {
      return NextResponse.json({ error: "No account" }, { status: 400 });
    }

    await ensureDefaults(user.accountId);

    const assets = await prisma.salesAsset.findMany({
      where: { accountId: user.accountId },
      orderBy: [{ category: "asc" }, { order: "asc" }, { createdAt: "asc" }],
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            createdByUser: { select: { name: true, email: true, slackUserName: true } },
          },
        },
        _count: {
          select: { versions: true },
        },
      },
    });

    return NextResponse.json({ assets });
  } catch (error) {
    console.error("Error fetching sales assets:", error);
    return NextResponse.json({ error: "Failed to fetch assets" }, { status: 500 });
  }
}

// POST — create a custom asset
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!user.accountId) {
      return NextResponse.json({ error: "No account" }, { status: 400 });
    }

    const { name, description, category } = (await request.json()) as {
      name: string;
      description?: string;
      category?: string;
    };

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const maxOrder = await prisma.salesAsset.aggregate({
      where: { accountId: user.accountId, category: category || "custom" },
      _max: { order: true },
    });

    const asset = await prisma.salesAsset.create({
      data: {
        accountId: user.accountId,
        name: name.trim(),
        description: description?.trim() || null,
        category: category || "custom",
        isDefault: false,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    return NextResponse.json({ asset });
  } catch (error) {
    console.error("Error creating sales asset:", error);
    return NextResponse.json({ error: "Failed to create asset" }, { status: 500 });
  }
}
