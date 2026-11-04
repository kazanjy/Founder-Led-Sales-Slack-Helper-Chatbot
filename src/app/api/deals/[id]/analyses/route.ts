import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET — list historical analyses for a deal (newest first)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const deal = await prisma.deal.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!deal || deal.userId !== user.id) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const analyses = await prisma.dealAnalysis.findMany({
      where: { dealId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        analysis: true,
        stage: true,
        entryCount: true,
        participantCount: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ analyses });
  } catch (error) {
    console.error("Error fetching deal analyses:", error);
    return NextResponse.json({ error: "Failed to fetch analyses" }, { status: 500 });
  }
}
