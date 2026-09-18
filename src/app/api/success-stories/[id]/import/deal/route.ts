import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  listDealsWithCalls,
  listDealCallEntries,
  importDealCallEntries,
} from "@/lib/success-stories/import";

export const maxDuration = 60;

/**
 * Deal call import for a success-story collection.
 *   GET               — deals that have call entries (the picker list)
 *   GET ?dealId=<id>  — that deal's call entries with imported flags
 *   POST              — { dealId, entryIds: string[] } → append as sources
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    const dealId = request.nextUrl.searchParams.get("dealId");
    if (dealId) {
      const entries = await listDealCallEntries(user.id, id, dealId);
      if (!entries) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ entries });
    }
    const deals = await listDealsWithCalls(user.id);
    return NextResponse.json({ deals });
  } catch (err) {
    console.error("[success-stories] deal list failed:", err);
    return NextResponse.json({ error: "Failed to list deals" }, { status: 500 });
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
    const dealId = typeof body.dealId === "string" ? body.dealId : "";
    const entryIds = Array.isArray(body.entryIds)
      ? (body.entryIds as unknown[]).filter((e): e is string => typeof e === "string").slice(0, 40)
      : [];
    if (!dealId || entryIds.length === 0) {
      return NextResponse.json({ error: "dealId and entryIds are required" }, { status: 400 });
    }
    const result = await importDealCallEntries(user.id, id, dealId, entryIds);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[success-stories] deal import failed:", err);
    const detail = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
