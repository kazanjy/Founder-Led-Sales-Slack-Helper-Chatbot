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

    const version = await prisma.preCallPlanningVersion.findFirst({
      where: accountWhere,
      include: {
        firstCallChecklistVersion: {
          select: {
            id: true,
            createdAt: true,
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
        firstCallChecklistVersionId: version.firstCallChecklistVersionId,
        firstCallChecklistVersion: version.firstCallChecklistVersion,
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
    const { content } = await request.json();

    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    // Verify the version belongs to the user
    const existingVersion = await prisma.preCallPlanningVersion.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!existingVersion) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Update the version
    const updatedVersion = await prisma.preCallPlanningVersion.update({
      where: { id },
      data: { content },
    });

    // Also update the merge variable
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "PRE_CALL_PLANNING",
        },
      },
      update: {
        value: content,
      },
      create: {
        userId: user.id,
        mergeField: "PRE_CALL_PLANNING",
        name: "Pre-Call Planning Process",
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
