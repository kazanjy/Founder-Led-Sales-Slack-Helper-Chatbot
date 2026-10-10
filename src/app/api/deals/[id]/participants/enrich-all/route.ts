import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { enrichByEmail } from "@/lib/search/pdl";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const deal = await prisma.deal.findUnique({ where: { id } });
    if (!deal || deal.userId !== user.id) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const participants = await prisma.dealParticipant.findMany({
      where: {
        dealId: id,
        email: { not: null },
        title: null,
      },
    });

    if (participants.length === 0) {
      return NextResponse.json({ enriched: 0 });
    }

    let enrichedCount = 0;
    for (const p of participants) {
      if (!p.email) continue;
      try {
        const result = await enrichByEmail(p.email);
        if (result) {
          const updates: Record<string, string | Date> = {};
          if (result.fullName && p.name.includes("@")) updates.name = result.fullName;
          if (result.title) updates.title = result.title;
          if (result.company) updates.company = result.company;
          if (result.linkedinUrl) updates.linkedinUrl = result.linkedinUrl;
          updates.pdlData = JSON.stringify(result);
          updates.pdlEnrichedAt = new Date();

          if (Object.keys(updates).length > 0) {
            await prisma.dealParticipant.update({
              where: { id: p.id },
              data: updates,
            });
            enrichedCount++;
          }
        }
      } catch {
        // Skip failures, continue with rest
      }
    }

    return NextResponse.json({ enriched: enrichedCount, total: participants.length });
  } catch (error) {
    console.error("Error batch enriching participants:", error);
    return NextResponse.json({ error: "Enrichment failed" }, { status: 500 });
  }
}
