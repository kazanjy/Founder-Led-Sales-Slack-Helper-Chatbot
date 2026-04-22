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

    const cleanEmail = email?.trim()?.toLowerCase() || null;
    const cleanName = name.trim();

    // Deduplicate: check for existing participant with the same email or name
    if (cleanEmail || cleanName) {
      const existing = await prisma.dealParticipant.findFirst({
        where: {
          dealId: id,
          OR: [
            ...(cleanEmail ? [{ email: { equals: cleanEmail, mode: "insensitive" as const } }] : []),
            { name: { equals: cleanName, mode: "insensitive" as const } },
          ],
        },
      });

      if (existing) {
        // Merge: fill in any empty fields from the new data
        const updates: Record<string, string> = {};
        if (!existing.title && title?.trim()) updates.title = title.trim();
        if (!existing.company && company?.trim()) updates.company = company.trim();
        if (!existing.email && cleanEmail) updates.email = cleanEmail;
        if (!existing.linkedinUrl && linkedinUrl?.trim()) updates.linkedinUrl = linkedinUrl.trim();
        // Prefer a real name over an email-as-name
        if (existing.name.includes("@") && !cleanName.includes("@")) updates.name = cleanName;

        if (Object.keys(updates).length > 0) {
          const updated = await prisma.dealParticipant.update({
            where: { id: existing.id },
            data: updates,
          });
          return NextResponse.json({ participant: updated, merged: true });
        }
        return NextResponse.json({ participant: existing, merged: true });
      }
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
