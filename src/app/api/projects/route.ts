import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET — list user's projects with conversation counts
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      orderBy: { order: "asc" },
      include: {
        _count: { select: { conversations: true } },
        conversations: {
          select: { lastMessageAt: true },
          orderBy: { lastMessageAt: "desc" },
          take: 1,
        },
      },
    });

    const result = projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      order: p.order,
      conversationCount: p._count.conversations,
      lastActivityAt: p.conversations[0]?.lastMessageAt?.toISOString() || p.createdAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    return NextResponse.json({ projects: result });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

// POST — create a new project
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    // Get max order for this user's projects
    const maxOrder = await prisma.project.aggregate({
      where: { userId: user.id },
      _max: { order: true },
    });

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: name.trim(),
        description: description?.trim() || null,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        order: project.order,
        conversationCount: 0,
        lastActivityAt: project.createdAt.toISOString(),
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error creating project:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
