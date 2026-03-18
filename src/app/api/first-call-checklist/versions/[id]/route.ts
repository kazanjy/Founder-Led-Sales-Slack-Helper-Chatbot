import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get a specific version
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

    // Account-wide read access
    const accountWhere = user.accountId
      ? { id, user: { accountId: user.accountId } }
      : { id, userId: user.id };

    const version = await prisma.firstCallChecklistVersion.findFirst({
      where: accountWhere,
      include: {
        discoveryQuestionsVersion: {
          select: {
            id: true,
            createdAt: true,
            salesNarrativeVersion: {
              select: {
                id: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    return NextResponse.json({
      version: {
        id: version.id,
        title: version.title,
        content: version.content,
        discoveryQuestionsVersionId: version.discoveryQuestionsVersionId,
        discoveryQuestionsVersion: version.discoveryQuestionsVersion,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching version:", error);
    return NextResponse.json(
      { error: "Failed to fetch version" },
      { status: 500 }
    );
  }
}

// PATCH - Update a version's content
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

    // Content is required unless only updating title
    if (!content && title === undefined) {
      return NextResponse.json(
        { error: "Content or title is required" },
        { status: 400 }
      );
    }

    // Verify the version belongs to the user
    const existingVersion = await prisma.firstCallChecklistVersion.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!existingVersion) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Build update data
    const updateData: { content?: string; title?: string } = {};
    if (content) updateData.content = content;
    if (title !== undefined) updateData.title = title;

    // Update the version
    const updatedVersion = await prisma.firstCallChecklistVersion.update({
      where: { id },
      data: updateData,
    });

    // Also update the merge variable (only if content was changed)
    if (content) await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "FIRST_CALL_CHECKLIST",
        },
      },
      update: {
        value: content,
      },
      create: {
        userId: user.id,
        mergeField: "FIRST_CALL_CHECKLIST",
        name: "First Call Checklist",
        value: content,
        isDefault: false,
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: updatedVersion.id,
        title: updatedVersion.title,
        content: updatedVersion.content,
        createdAt: updatedVersion.createdAt,
        updatedAt: updatedVersion.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating version:", error);
    return NextResponse.json(
      { error: "Failed to update version" },
      { status: 500 }
    );
  }
}
