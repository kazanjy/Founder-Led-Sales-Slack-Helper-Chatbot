import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveDefaultAgendaScript } from "@/lib/practice/agenda";

/**
 * POST /api/practice/agenda-script { script }
 *
 * "Save as my default" from the agenda drill: persists the founder's
 * edited script as the AGENDA_SCRIPT GTM variable — future agenda
 * sessions start from it, and agents can read it like any merge field.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const body = await request.json().catch(() => null);
    const script = typeof body?.script === "string" ? body.script.trim() : "";
    if (!script) {
      return NextResponse.json({ error: "script is required" }, { status: 400 });
    }
    await saveDefaultAgendaScript(user.id, script);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[practice agenda-script] save failed:", err);
    return NextResponse.json({ error: "Failed to save script" }, { status: 500 });
  }
}
