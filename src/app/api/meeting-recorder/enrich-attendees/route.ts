import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enrichAttendeesByEmail } from "@/lib/search/pdl";

// POST — enrich attendees by email via PDL
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { attendees } = (await request.json()) as {
      attendees: Array<{ name: string; email?: string }>;
    };

    if (!Array.isArray(attendees) || attendees.length === 0) {
      return NextResponse.json({ attendees: [] });
    }

    const enriched = await enrichAttendeesByEmail(attendees);
    return NextResponse.json({ attendees: enriched });
  } catch (error) {
    console.error("Error enriching attendees:", error);
    return NextResponse.json({ error: "Failed to enrich attendees" }, { status: 500 });
  }
}
