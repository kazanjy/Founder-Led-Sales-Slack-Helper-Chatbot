import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getDealSlackTone,
  setDealSlackTone,
  DEFAULT_DEAL_SLACK_TONE,
} from "@/lib/deals/tone-prefs";

/**
 * Slack communication tone for deal auto-actions.
 *   GET  — { tone, isCustom, defaultTone }
 *   POST — { tone } (empty string resets to the default voice)
 */

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const current = await getDealSlackTone(user.id);
    return NextResponse.json({ ...current, defaultTone: DEFAULT_DEAL_SLACK_TONE });
  } catch (err) {
    console.error("[tone-prefs] GET failed:", err);
    return NextResponse.json({ error: "Failed to load tone" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (typeof body.tone !== "string") {
      return NextResponse.json({ error: "tone must be a string" }, { status: 400 });
    }
    const saved = await setDealSlackTone(user.id, body.tone);
    return NextResponse.json({ ...saved, defaultTone: DEFAULT_DEAL_SLACK_TONE });
  } catch (err) {
    console.error("[tone-prefs] POST failed:", err);
    return NextResponse.json({ error: "Failed to save tone" }, { status: 500 });
  }
}
