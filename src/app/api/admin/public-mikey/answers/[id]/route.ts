import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/db";

/**
 * GET /api/admin/public-mikey/answers/[id] — Full answer detail
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const answer = await prisma.publicAnswer.findUnique({
      where: { id: params.id },
    });

    if (!answer) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("Admin public-mikey answer detail error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/public-mikey/answers/[id] — Update answer fields
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const allowedFields = ["answer", "preview", "status", "slug"];
    const data: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        data[field] = body[field];
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const answer = await prisma.publicAnswer.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("Admin public-mikey answer update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/public-mikey/answers/[id] — Remove an answer
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hard = searchParams.get("hard") === "true";

    if (hard) {
      await prisma.publicAnswer.delete({ where: { id: params.id } });
    } else {
      await prisma.publicAnswer.update({
        where: { id: params.id },
        data: { status: "hidden" },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin public-mikey answer delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
