import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  listRecorderCallsForCollection,
  importRecorderCalls,
} from "@/lib/success-stories/import";

export const maxDuration = 300;

/**
 * Recorder call import for a success-story collection.
 *   GET  — recent recorded calls (90 days) with already-imported flags;
 *          provider null = no recorder connected
 *   POST — { callIds: string[] } → pull transcripts, append as sources
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    const result = await listRecorderCallsForCollection(user.id, id);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[success-stories] recorder list failed:", err);
    const detail = err instanceof Error ? err.message : "Failed to list calls";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const callIds = Array.isArray(body.callIds)
      ? (body.callIds as unknown[]).filter((c): c is string => typeof c === "string").slice(0, 40)
      : [];
    if (callIds.length === 0) {
      return NextResponse.json({ error: "callIds is required" }, { status: 400 });
    }
    const result = await importRecorderCalls(user.id, id, callIds);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[success-stories] recorder import failed:", err);
    const detail = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
