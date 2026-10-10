import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * Quotes & Success Stories collections.
 *   GET  — list the user's collections (rail view: title, customer,
 *          source/proof/asset counts, freshness)
 *   POST — { title, customerName?, themeFocus? } → new empty collection
 */

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const rows = await prisma.successStoryCollection.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { _count: { select: { assets: true } } },
    });
    const collections = rows.map((c) => {
      const sources = Array.isArray(c.sources) ? (c.sources as unknown[]) : [];
      const proofPoints = Array.isArray(c.proofPoints) ? (c.proofPoints as unknown[]) : [];
      return {
        id: c.id,
        title: c.title,
        customerName: c.customerName,
        themeFocus: c.themeFocus,
        sourceCount: sources.length,
        proofPointCount: proofPoints.length,
        assetCount: c._count.assets,
        proofPointsAt: c.proofPointsAt,
        updatedAt: c.updatedAt,
      };
    });
    return NextResponse.json({ collections });
  } catch (err) {
    console.error("[success-stories] GET failed:", err);
    return NextResponse.json({ error: "Failed to load collections" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const collection = await prisma.successStoryCollection.create({
      data: {
        userId: user.id,
        title,
        customerName:
          typeof body.customerName === "string" && body.customerName.trim()
            ? body.customerName.trim()
            : null,
        themeFocus:
          typeof body.themeFocus === "string" && body.themeFocus.trim()
            ? body.themeFocus.trim()
            : null,
        sources: [],
      },
    });
    return NextResponse.json({ collection });
  } catch (err) {
    console.error("[success-stories] POST failed:", err);
    return NextResponse.json({ error: "Failed to create collection" }, { status: 500 });
  }
}
