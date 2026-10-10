import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get a specific research brief
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const research = await prisma.preCallResearch.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!research) {
      return NextResponse.json({ error: "Research not found" }, { status: 404 });
    }

    return NextResponse.json({
      research: {
        id: research.id,
        companyName: research.companyName,
        contactName: research.contactName,
        contactTitle: research.contactTitle,
        contactEmail: research.contactEmail,
        contactLinkedIn: research.contactLinkedIn,
        calendarEvent: research.calendarEvent ?? null,
        freeformInput: research.freeformInput,
        content: research.content,
        searchContext: research.searchContext,
        sources: research.sources,
        source: research.source,
        createdAt: research.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching research:", error);
    return NextResponse.json(
      { error: "Failed to fetch research" },
      { status: 500 }
    );
  }
}
