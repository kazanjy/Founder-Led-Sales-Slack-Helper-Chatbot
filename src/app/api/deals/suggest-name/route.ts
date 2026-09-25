import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { suggestDealNameFromCalls, type SuggestNameInput } from "@/lib/deals/suggest-name";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as {
      calls?: SuggestNameInput[];
      events?: Array<{
        title: string;
        date: string;
        description: string | null;
        attendees: Array<{ email: string; name: string | null }>;
      }>;
    };
    const calls = body.calls ?? [];
    // Calendar events feed the same suggester — Mikey just needs title /
    // date / attendees / a summary blob to reason about the opportunity.
    const eventsAsCalls: SuggestNameInput[] = (body.events ?? []).map((ev) => ({
      title: ev.title,
      date: ev.date,
      summary: ev.description || undefined,
      attendees: ev.attendees.map((a) => ({ name: a.name || a.email, email: a.email })),
    }));
    const merged = [...calls, ...eventsAsCalls];
    if (merged.length === 0) {
      return NextResponse.json({ error: "No calls or events provided" }, { status: 400 });
    }

    const result = await suggestDealNameFromCalls(merged);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error suggesting deal name:", error);
    return NextResponse.json({ companyName: "", dealName: "" });
  }
}
