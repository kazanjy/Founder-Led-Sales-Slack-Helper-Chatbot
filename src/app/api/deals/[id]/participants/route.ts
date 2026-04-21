import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

async function verifyDeal(dealId: string, userId: string) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal || deal.userId !== userId) return null;
  return deal;
}

// POST — add a participant to a deal
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const deal = await verifyDeal(id, user.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, title, company, email, linkedinUrl, role, notes } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const participant = await prisma.dealParticipant.create({
      data: {
        dealId: id,
        name: name.trim(),
        title: title?.trim() || null,
        company: company?.trim() || null,
        email: email?.trim() || null,
        linkedinUrl: linkedinUrl?.trim() || null,
        role: role || "unknown",
        notes: notes?.trim() || null,
      },
    });

    return NextResponse.json({ participant });
  } catch (error) {
    console.error("Error adding participant:", error);
    return NextResponse.json({ error: "Failed to add participant" }, { status: 500 });
  }
}
