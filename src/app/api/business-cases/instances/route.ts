import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isBusinessCaseType } from "@/lib/business-cases/constants";

/**
 * GET /api/business-cases/instances?type=discovery_summary&dealId=…
 * List the caller's instances, optionally filtered by type and/or
 * deal. Content is included (instances are markdown docs, not huge),
 * with deal name joined for grouping in the applet list.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const type = params.get("type");
    const dealId = params.get("dealId");

    const where: { userId: string; type?: string; dealId?: string } = { userId: user.id };
    if (type) {
      if (!isBusinessCaseType(type)) {
        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
      }
      where.type = type;
    }
    if (dealId) where.dealId = dealId;

    const instances = await prisma.businessCaseInstance.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        deal: { select: { id: true, name: true, companyName: true } },
      },
    });
    return NextResponse.json({ instances });
  } catch (err) {
    console.error("[business-cases instances] GET failed:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to load instances", detail: detail.slice(0, 300) },
      { status: 500 }
    );
  }
}
