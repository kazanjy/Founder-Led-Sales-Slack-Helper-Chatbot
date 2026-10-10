import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { extractProofPoints } from "@/lib/success-stories/generate";

export const maxDuration = 300;

/**
 * POST /api/success-stories/[id]/extract — run (or re-run) proof point
 * extraction over the collection's sources. Re-extraction carries
 * forward prior include/exclude decisions (matched on quote).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    const result = await extractProofPoints(user.id, id);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[success-stories] extract failed:", err);
    const detail = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
