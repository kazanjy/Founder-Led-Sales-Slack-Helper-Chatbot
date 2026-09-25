import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import type { ProofPoint, SourceCall } from "@/lib/success-stories/generate";

/**
 * One success-story collection.
 *   GET    — full detail (sources, proof points, generated assets)
 *   PATCH  — { title?, customerName?, themeFocus?, sources?, proofPoints? }
 *            sources: full replacement array (add/edit/remove calls);
 *            proofPoints: full replacement — used for include/exclude
 *            toggles and claim edits, never invents new points server-side
 *   DELETE — remove the collection (assets cascade)
 */

async function owned(collectionId: string, userId: string) {
  return prisma.successStoryCollection.findFirst({
    where: { id: collectionId, userId },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    const collection = await prisma.successStoryCollection.findFirst({
      where: { id, userId: user.id },
      include: { assets: { orderBy: { createdAt: "desc" }, take: 100 } },
    });
    if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ collection });
  } catch (err) {
    console.error("[success-stories] GET one failed:", err);
    return NextResponse.json({ error: "Failed to load collection" }, { status: 500 });
  }
}

function sanitizeSources(raw: unknown): SourceCall[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SourceCall[] = [];
  for (const s of raw.slice(0, 40)) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const content = typeof r.content === "string" ? r.content : "";
    if (!content.trim()) continue;
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : crypto.randomUUID(),
      title:
        typeof r.title === "string" && r.title.trim() ? r.title.trim() : "Untitled call",
      date:
        typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
      origin: r.origin === "recorder" || r.origin === "deal" ? r.origin : "paste",
      // Import dedupe keys — must survive client round-trips (a source
      // removal PATCHes the whole array back).
      ...(typeof r.providerCallId === "string" && r.providerCallId
        ? { providerCallId: r.providerCallId }
        : {}),
      ...(typeof r.entryId === "string" && r.entryId ? { entryId: r.entryId } : {}),
      content,
    });
  }
  return out;
}

function sanitizeProofPoints(raw: unknown, prior: ProofPoint[]): ProofPoint[] | null {
  if (!Array.isArray(raw)) return null;
  // The client may toggle `included` and edit `claim`; everything else
  // (quotes especially) stays server-derived from the prior extraction.
  const priorById = new Map(prior.map((p) => [p.id, p]));
  const out: ProofPoint[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const base = typeof r.id === "string" ? priorById.get(r.id) : undefined;
    if (!base) continue;
    out.push({
      ...base,
      claim: typeof r.claim === "string" && r.claim.trim() ? r.claim.trim() : base.claim,
      included: r.included !== false,
    });
  }
  return out;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    const collection = await owned(id, user.id);
    if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
    if (typeof body.customerName === "string")
      data.customerName = body.customerName.trim() || null;
    if (typeof body.themeFocus === "string") data.themeFocus = body.themeFocus.trim() || null;
    if (body.sources !== undefined) {
      const sources = sanitizeSources(body.sources);
      if (!sources) return NextResponse.json({ error: "invalid sources" }, { status: 400 });
      data.sources = sources;
    }
    if (body.proofPoints !== undefined) {
      const prior = (collection.proofPoints as unknown as ProofPoint[] | null) || [];
      const proofPoints = sanitizeProofPoints(body.proofPoints, prior);
      if (!proofPoints)
        return NextResponse.json({ error: "invalid proofPoints" }, { status: 400 });
      data.proofPoints = proofPoints;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    const updated = await prisma.successStoryCollection.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: data as any,
    });
    return NextResponse.json({ collection: updated });
  } catch (err) {
    console.error("[success-stories] PATCH failed:", err);
    return NextResponse.json({ error: "Failed to update collection" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    if (!(await owned(id, user.id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.successStoryCollection.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[success-stories] DELETE failed:", err);
    return NextResponse.json({ error: "Failed to delete collection" }, { status: 500 });
  }
}
