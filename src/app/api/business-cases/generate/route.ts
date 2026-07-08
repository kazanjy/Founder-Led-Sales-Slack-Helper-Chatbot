import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isBusinessCaseType } from "@/lib/business-cases/constants";
import { generateInstance, TranscriptInput } from "@/lib/business-cases/generate";

/**
 * POST /api/business-cases/generate
 *
 * The single generation endpoint all four entry points funnel into:
 *   deal page button / applet deal picker → { type, dealId }
 *   applet paste                          → { type, extraText }
 *   applet call importer                  → { type, transcripts: [...] }
 * Combinations compose (deal + extra transcripts works). Body:
 *   { type, dealId?, transcripts?: [{title?, date?, content}], extraText?, title? }
 */

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const body = await request.json().catch(() => null);
    if (!body || !isBusinessCaseType(body.type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const transcripts: TranscriptInput[] = Array.isArray(body.transcripts)
      ? body.transcripts
          .filter(
            (t: unknown): t is Record<string, unknown> =>
              !!t && typeof t === "object" && typeof (t as Record<string, unknown>).content === "string"
          )
          .map((t: Record<string, unknown>) => ({
            title: typeof t.title === "string" ? t.title : undefined,
            date: typeof t.date === "string" ? t.date : undefined,
            content: t.content as string,
          }))
      : [];

    const { instance, timelineEntryId } = await generateInstance({
      userId: user.id,
      type: body.type,
      dealId: typeof body.dealId === "string" ? body.dealId : null,
      transcripts,
      extraText: typeof body.extraText === "string" ? body.extraText : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
    });

    return NextResponse.json({ instance, timelineEntryId });
  } catch (err) {
    console.error("[business-cases generate] failed:", err);
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
