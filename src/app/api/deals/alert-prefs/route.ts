import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  DEAL_ALERT_KINDS,
  getDealAlertPrefs,
  setDealAlertPref,
  isValidAlertKind,
} from "@/lib/deals/alert-prefs";

/**
 * GET  /api/deals/alert-prefs — { kinds, prefs }
 * POST /api/deals/alert-prefs — { kind, enabled } → updated prefs.
 * Backs the /deals/alerts config page and its ?silence= deep link.
 */

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const prefs = await getDealAlertPrefs(user.id);
    return NextResponse.json({ kinds: DEAL_ALERT_KINDS, prefs });
  } catch (err) {
    console.error("[deal alert-prefs] GET failed:", err);
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { kind, enabled } = await request.json();
    if (typeof kind !== "string" || !isValidAlertKind(kind) || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "kind and enabled are required" }, { status: 400 });
    }
    const prefs = await setDealAlertPref(user.id, kind, enabled);
    return NextResponse.json({ ok: true, prefs });
  } catch (err) {
    console.error("[deal alert-prefs] POST failed:", err);
    return NextResponse.json({ error: "Failed to save preference" }, { status: 500 });
  }
}
