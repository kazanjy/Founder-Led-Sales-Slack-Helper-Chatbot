import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get summary of objection library for current user
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const entries = await prisma.objectionEntry.findMany({
      where: { userId: user.id },
      select: { id: true, category: true, createdAt: true },
    });

    if (entries.length === 0) {
      const hasNarrative = await prisma.salesNarrativeVersion.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      return NextResponse.json({
        hasObjectionLibrary: false,
        totalEntries: 0,
        entriesByCategory: {},
        lastBootstrapDate: null,
        hasSalesNarrative: !!hasNarrative,
      });
    }

    // Count by category
    const entriesByCategory: Record<string, number> = {};
    for (const entry of entries) {
      entriesByCategory[entry.category] = (entriesByCategory[entry.category] || 0) + 1;
    }

    // Get last bootstrap date
    const lastBootstrap = await prisma.objectionBootstrap.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    return NextResponse.json({
      hasObjectionLibrary: true,
      totalEntries: entries.length,
      entriesByCategory,
      lastBootstrapDate: lastBootstrap?.createdAt || null,
      hasSalesNarrative: true,
    });
  } catch (error) {
    console.error("Error fetching objection library summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch objection library summary" },
      { status: 500 }
    );
  }
}
