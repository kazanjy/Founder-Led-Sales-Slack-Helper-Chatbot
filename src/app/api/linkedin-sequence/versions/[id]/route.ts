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

    const version = await prisma.linkedInSequenceVersion.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        salesNarrativeVersion: {
          select: {
            id: true,
            createdAt: true,
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
        content: version.content,
        orgPersona: version.orgPersona,
        humanPersona: version.humanPersona,
        specialNotes: version.specialNotes,
        salesNarrativeVersionId: version.salesNarrativeVersionId,
        salesNarrativeVersion: version.salesNarrativeVersion,
        firstCallChecklistVersionId: version.firstCallChecklistVersionId,
        conversationId: version.conversationId,
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

    const existingVersion = await prisma.linkedInSequenceVersion.findFirst({
      where: { id, userId: user.id },
    });

    if (!existingVersion) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const updatedVersion = await prisma.linkedInSequenceVersion.update({
      where: { id },
      data: { content },
    });

    // Update merge variable
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "LINKEDIN_SEQUENCE",
        },
      },
      update: { value: content },
      create: {
        userId: user.id,
        mergeField: "LINKEDIN_SEQUENCE",
        name: "LinkedIn Sequence",
        value: content,
        isDefault: false,
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: updatedVersion.id,
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
