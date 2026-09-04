import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * "Next Session Topics" — the founder's running scratchpad at the top
 * of the Goals & Tasks applet (markdown, saves on click-out). When a
 * new coaching session is created, the current value gets seeded into
 * the session notes as a "## Topics to Cover" section. Stored as a
 * GtmVariable singleton (same pattern as RECAP_TONE_GUIDANCE) — no
 * migration needed.
 */

const MERGE_FIELD = "NEXT_SESSION_TOPICS";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const variable = await prisma.gtmVariable.findFirst({
      where: { userId: user.id, mergeField: MERGE_FIELD },
      select: { value: true },
    });
    return NextResponse.json({ value: variable?.value || "" });
  } catch (error) {
    console.error("[next-session-topics] GET error:", error);
    return NextResponse.json({ value: "" });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { value } = await request.json();
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: { userId: user.id, mergeField: MERGE_FIELD },
      },
      update: { value: value || "" },
      create: {
        userId: user.id,
        mergeField: MERGE_FIELD,
        name: "Next Session Topics",
        value: value || "",
        isDefault: false,
        sortOrder: 999,
      },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[next-session-topics] POST error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
