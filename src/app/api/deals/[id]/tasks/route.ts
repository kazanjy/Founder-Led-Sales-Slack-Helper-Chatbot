import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * Deal tasks (future-dated, one-touch executable).
 *   GET  — open + recently-resolved tasks for the deal
 *   POST — { title, dueAt?, executeVia?, draftMessage?, rationale? }
 */

async function ownedDeal(dealId: string, userId: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, userId: true },
  });
  return deal && deal.userId === userId ? deal : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await params;
    if (!(await ownedDeal(id, user.id))) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    const tasks = await prisma.dealTask.findMany({
      where: { dealId: id },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 50,
    });
    return NextResponse.json({ tasks });
  } catch (err) {
    console.error("[deal tasks] GET failed:", err);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
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
    if (!(await ownedDeal(id, user.id))) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const dueAt = body.dueAt ? new Date(body.dueAt) : null;
    if (dueAt && isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: "invalid dueAt" }, { status: 400 });
    }
    const task = await prisma.dealTask.create({
      data: {
        userId: user.id,
        dealId: id,
        title,
        rationale: typeof body.rationale === "string" && body.rationale.trim() ? body.rationale.trim() : null,
        source: "user",
        status: "scheduled",
        dueAt,
        executeVia: body.executeVia === "slack_channel" ? "slack_channel" : null,
        draftMessage:
          typeof body.draftMessage === "string" && body.draftMessage.trim()
            ? body.draftMessage.trim()
            : null,
      },
    });
    return NextResponse.json({ task });
  } catch (err) {
    console.error("[deal tasks] POST failed:", err);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
