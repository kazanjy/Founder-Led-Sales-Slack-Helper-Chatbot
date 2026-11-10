import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - List saved examples for a platform
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const platform = request.nextUrl.searchParams.get("platform") || "";

    const where: { userId: string; platform?: string } = { userId: user.id };
    if (platform) where.platform = platform;

    const examples = await prisma.socialContentExample.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        platform: true,
        content: true,
        label: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ examples });
  } catch (error) {
    console.error("Error fetching examples:", error);
    return NextResponse.json({ error: "Failed to fetch examples" }, { status: 500 });
  }
}

// POST - Save a new example
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { platform, content, label } = await request.json();

    if (!platform || !content?.trim()) {
      return NextResponse.json({ error: "Platform and content are required" }, { status: 400 });
    }

    const example = await prisma.socialContentExample.create({
      data: {
        userId: user.id,
        platform,
        content: content.trim(),
        label: label?.trim() || null,
      },
    });

    return NextResponse.json({ example });
  } catch (error) {
    console.error("Error saving example:", error);
    return NextResponse.json({ error: "Failed to save example" }, { status: 500 });
  }
}

// DELETE - Remove a saved example
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Example ID is required" }, { status: 400 });
    }

    const existing = await prisma.socialContentExample.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Example not found" }, { status: 404 });
    }

    await prisma.socialContentExample.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting example:", error);
    return NextResponse.json({ error: "Failed to delete example" }, { status: 500 });
  }
}
