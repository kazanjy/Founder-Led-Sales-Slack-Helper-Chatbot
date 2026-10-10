import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Single entry by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const entry = await prisma.objectionEntry.findFirst({
      where: { id, userId: user.id },
    });

    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error fetching objection entry:", error);
    return NextResponse.json(
      { error: "Failed to fetch objection entry" },
      { status: 500 }
    );
  }
}

// PATCH - Update entry
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    // Verify ownership
    const existing = await prisma.objectionEntry.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const body = await request.json();
    const { objection, category, handle, notes, sortOrder, orgPersona, humanPersona } = body;

    if (category) {
      const validCategories = [
        "NEED", "PRIORITY", "ROI", "PRODUCT", "COMPETITION",
        "ADOPTION", "BUDGET", "TRUST", "AUTHORITY",
      ];
      if (!validCategories.includes(category)) {
        return NextResponse.json({ error: "Invalid category" }, { status: 400 });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {};
    if (objection !== undefined) data.objection = objection;
    if (category !== undefined) data.category = category;
    if (handle !== undefined) data.handle = handle;
    if (notes !== undefined) data.notes = notes || null;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (orgPersona !== undefined) data.orgPersona = orgPersona;
    if (humanPersona !== undefined) data.humanPersona = humanPersona;

    const entry = await prisma.objectionEntry.update({
      where: { id },
      data,
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error updating objection entry:", error);
    return NextResponse.json(
      { error: "Failed to update objection entry" },
      { status: 500 }
    );
  }
}

// DELETE - Remove entry
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    // Verify ownership
    const existing = await prisma.objectionEntry.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    await prisma.objectionEntry.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting objection entry:", error);
    return NextResponse.json(
      { error: "Failed to delete objection entry" },
      { status: 500 }
    );
  }
}
