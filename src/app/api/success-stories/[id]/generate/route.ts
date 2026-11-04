import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { generateSuccessAsset } from "@/lib/success-stories/generate";

export const maxDuration = 300;

/**
 * POST /api/success-stories/[id]/generate — { medium, format } →
 * project the INCLUDED proof points into one asset row.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const medium = typeof body.medium === "string" ? body.medium : "";
    const format = typeof body.format === "string" ? body.format : "web";
    if (!medium) return NextResponse.json({ error: "medium is required" }, { status: 400 });

    const result = await generateSuccessAsset(user.id, id, medium, format);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[success-stories] generate failed:", err);
    const detail = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
