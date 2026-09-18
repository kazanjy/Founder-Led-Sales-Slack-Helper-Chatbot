import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

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

    const version = await prisma.hiringProfileVersion.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true },
        },
      },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Check access — same account
    if (version.userId !== user.id) {
      const sameAccount = await prisma.user.findFirst({
        where: {
          id: version.userId,
          accountId: user.accountId || undefined,
        },
      });
      if (!sameAccount) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    }

    return NextResponse.json({
      currentUserId: user.id,
      version: {
        id: version.id,
        title: version.title,
        content: version.content,
        iterationHistory: version.iterationHistory,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
        userId: version.userId,
      },
    });
  } catch (error) {
    console.error("Error fetching hiring profile version:", error);
    return NextResponse.json(
      { error: "Failed to fetch hiring profile version" },
      { status: 500 }
    );
  }
}

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
    const body = await request.json();
    const { content, title } = body;

    const version = await prisma.hiringProfileVersion.findUnique({
      where: { id },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (version.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const updateData: { content?: string; title?: string } = {};
    if (content) updateData.content = content;
    if (title) updateData.title = title;

    const updated = await prisma.hiringProfileVersion.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      version: {
        id: updated.id,
        title: updated.title,
        content: updated.content,
        iterationHistory: updated.iterationHistory,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating hiring profile version:", error);
    return NextResponse.json(
      { error: "Failed to update hiring profile version" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a specific hiring profile version
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

    const version = await prisma.hiringProfileVersion.findUnique({
      where: { id },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (version.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await prisma.hiringProfileVersion.delete({
      where: { id },
    });

    // Check if there are remaining versions
    const newLatest = await prisma.hiringProfileVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, hasRemaining: !!newLatest });
  } catch (error) {
    console.error("Error deleting hiring profile version:", error);
    return NextResponse.json(
      { error: "Failed to delete version" },
      { status: 500 }
    );
  }
}
