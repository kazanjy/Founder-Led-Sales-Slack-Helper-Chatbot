import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { enrichByEmail } from "@/lib/search/pdl";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; pid: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id, pid } = await params;

    const deal = await prisma.deal.findUnique({ where: { id } });
    if (!deal || deal.userId !== user.id) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const participant = await prisma.dealParticipant.findUnique({ where: { id: pid } });
    if (!participant || participant.dealId !== id) {
      return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    }

    if (!participant.email) {
      return NextResponse.json({ error: "Participant has no email address" }, { status: 400 });
    }

    const enriched = await enrichByEmail(participant.email);
    if (!enriched) {
      return NextResponse.json({ error: "No data found for this email" }, { status: 404 });
    }

    const updated = await prisma.dealParticipant.update({
      where: { id: pid },
      data: {
        title: participant.title || enriched.title || null,
        company: participant.company || enriched.company || null,
        linkedinUrl: participant.linkedinUrl || enriched.linkedinUrl || null,
        name: enriched.fullName || participant.name,
        pdlData: JSON.stringify(enriched),
        pdlEnrichedAt: new Date(),
      },
    });

    return NextResponse.json({ participant: updated });
  } catch (error) {
    console.error("Error enriching participant:", error);
    return NextResponse.json({ error: "Enrichment failed" }, { status: 500 });
  }
}
