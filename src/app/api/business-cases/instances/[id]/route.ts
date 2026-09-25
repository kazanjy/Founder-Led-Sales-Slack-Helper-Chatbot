import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { updateInstance } from "@/lib/business-cases/generate";

/**
 * GET    /api/business-cases/instances/[id] → single instance (+deal)
 * PUT    { title?, content? } — edit; syncs the mirrored deal timeline
 *        entry via updateInstance so the timeline never goes stale.
 * DELETE — remove the instance. The mirrored timeline entry (if any)
 *        is removed too: an artifact the founder deleted shouldn't
 *        keep feeding deal context.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { id } = await params;
    const instance = await prisma.businessCaseInstance.findFirst({
      where: { id, userId: user.id },
      include: { deal: { select: { id: true, name: true, companyName: true } } },
    });
    if (!instance) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ instance });
  } catch (err) {
    console.error("[business-cases instance] GET failed:", err);
    return NextResponse.json({ error: "Failed to load instance" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || (body.title === undefined && body.content === undefined)) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const instance = await updateInstance(user.id, id, {
      title: typeof body.title === "string" ? body.title : undefined,
      content: typeof body.content === "string" ? body.content : undefined,
    });
    if (!instance) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ instance });
  } catch (err) {
    console.error("[business-cases instance] PUT failed:", err);
    return NextResponse.json({ error: "Failed to update instance" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { id } = await params;
    const instance = await prisma.businessCaseInstance.findFirst({
      where: { id, userId: user.id },
      select: { id: true, dealId: true, type: true },
    });
    if (!instance) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Remove the mirrored timeline entry first (matched by
    // metadata.instanceId — metadata is a JSON string column).
    if (instance.dealId) {
      const entries = await prisma.dealTimelineEntry.findMany({
        where: { dealId: instance.dealId, type: instance.type },
        select: { id: true, metadata: true },
      });
      for (const e of entries) {
        try {
          const m = JSON.parse(e.metadata || "{}");
          if (m.instanceId === instance.id) {
            await prisma.dealTimelineEntry.delete({ where: { id: e.id } });
            break;
          }
        } catch {
          /* unparseable metadata — skip */
        }
      }
    }

    await prisma.businessCaseInstance.delete({ where: { id: instance.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[business-cases instance] DELETE failed:", err);
    return NextResponse.json({ error: "Failed to delete instance" }, { status: 500 });
  }
}
