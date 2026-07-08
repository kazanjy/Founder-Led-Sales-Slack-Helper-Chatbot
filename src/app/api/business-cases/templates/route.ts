import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isBusinessCaseType } from "@/lib/business-cases/constants";
import {
  getLatestTemplate,
  generateTemplate,
  saveTemplate,
} from "@/lib/business-cases/generate";

/**
 * GET  /api/business-cases/templates?type=discovery_summary
 *   → { template } — the latest version of that type (null if none)
 *
 * POST /api/business-cases/templates
 *   { type, action: "generate" }          → generate from playbook assets
 *   { type, action: "save", content }     → persist a hand-edited version
 * Both create a NEW version row (newest = current); history is kept.
 */

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const type = new URL(request.url).searchParams.get("type");
    if (!isBusinessCaseType(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    const template = await getLatestTemplate(user.id, type);
    return NextResponse.json({ template });
  } catch (err) {
    console.error("[business-cases templates] GET failed:", err);
    return NextResponse.json({ error: "Failed to load template" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const body = await request.json().catch(() => null);
    const type = body?.type;
    if (!isBusinessCaseType(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    if (body.action === "save") {
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content) {
        return NextResponse.json({ error: "content is required" }, { status: 400 });
      }
      const template = await saveTemplate(user.id, type, content);
      return NextResponse.json({ template });
    }

    // Default action: generate from playbook assets.
    const template = await generateTemplate(user.id, type);
    return NextResponse.json({ template });
  } catch (err) {
    console.error("[business-cases templates] POST failed:", err);
    const message = err instanceof Error ? err.message : "Failed to create template";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
