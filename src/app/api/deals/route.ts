import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET — list user's deals (newest first)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const deals = await prisma.deal.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { entries: true, participants: true },
        },
      },
    });

    return NextResponse.json({ deals });
  } catch (error) {
    console.error("Error fetching deals:", error);
    return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
  }
}

// POST — create a new deal
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { name, companyName, companyUrl, stage, status, notes, projectId } = body;

    if (!name?.trim() || !companyName?.trim()) {
      return NextResponse.json({ error: "name and companyName are required" }, { status: 400 });
    }

    const deal = await prisma.deal.create({
      data: {
        userId: user.id,
        name: name.trim(),
        companyName: companyName.trim(),
        companyUrl: companyUrl?.trim() || null,
        stage: stage || "prospecting",
        status: status || "active",
        notes: notes?.trim() || null,
        projectId: projectId || null,
      },
    });

    return NextResponse.json({ deal });
  } catch (error) {
    console.error("Error creating deal:", error);
    return NextResponse.json({ error: "Failed to create deal" }, { status: 500 });
  }
}
