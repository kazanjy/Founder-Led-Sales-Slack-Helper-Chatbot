import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get a specific sales narrative version with its answers snapshot
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

    const version = await prisma.salesNarrativeVersion.findUnique({
      where: { id },
      include: {
        answers: {
          include: {
            question: {
              select: {
                id: true,
                category: true,
                globalOrder: true,
                question: true,
              },
            },
          },
          orderBy: {
            question: {
              globalOrder: "asc",
            },
          },
        },
        user: {
          select: { name: true, email: true, slackUserName: true },
        },
      },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Allow account-wide read access
    if (version.userId !== user.id) {
      if (!user.accountId) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
      const versionOwner = await prisma.user.findUnique({
        where: { id: version.userId },
        select: { accountId: true },
      });
      if (versionOwner?.accountId !== user.accountId) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    }

    // Group answers by category
    const categoryOrder = ["Problem", "Solution", "Proof", "Business"];
    const answersByCategory: Record<string, Array<{
      questionId: string;
      globalOrder: number;
      question: string;
      answer: string;
    }>> = {};

    for (const category of categoryOrder) {
      answersByCategory[category] = [];
    }

    for (const answer of version.answers) {
      const category = answer.question.category;
      if (answersByCategory[category]) {
        answersByCategory[category].push({
          questionId: answer.question.id,
          globalOrder: answer.question.globalOrder,
          question: answer.question.question,
          answer: answer.answer,
        });
      }
    }

    return NextResponse.json({
      currentUserId: user.id,
      version: {
        id: version.id,
        title: version.title,
        narrative: version.narrative,
        description1000w: version.description1000w,
        description100w: version.description100w,
        description50w: version.description50w,
        description25w: version.description25w,
        sourceUrls: version.sourceUrls,
        sourcePdfNames: version.sourcePdfNames,
        createdAt: version.createdAt,
        userId: version.userId,
        user: version.user,
      },
      answersByCategory,
    });
  } catch (error) {
    console.error("Error fetching sales narrative version:", error);
    return NextResponse.json(
      { error: "Failed to fetch version" },
      { status: 500 }
    );
  }
}

// PATCH - Update a sales narrative version (for manual edits)
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
    const { title, narrative, description1000w, description100w, description50w, description25w } = body;

    // Find the version
    const version = await prisma.salesNarrativeVersion.findUnique({
      where: { id },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Verify ownership
    if (version.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Build update object with only provided fields
    const updateData: {
      title?: string;
      narrative?: string;
      description1000w?: string | null;
      description100w?: string;
      description50w?: string;
      description25w?: string;
    } = {};

    if (title !== undefined) updateData.title = title;
    if (narrative !== undefined) updateData.narrative = narrative;
    if (description1000w !== undefined) updateData.description1000w = description1000w;
    if (description100w !== undefined) updateData.description100w = description100w;
    if (description50w !== undefined) updateData.description50w = description50w;
    if (description25w !== undefined) updateData.description25w = description25w;

    // Update the version
    const updatedVersion = await prisma.salesNarrativeVersion.update({
      where: { id },
      data: updateData,
    });

    // Check if this is the latest version for this user
    const latestVersion = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    // If this is the latest version, also update merge variables
    if (latestVersion && latestVersion.id === id) {
      const mergeVariables = [
        { mergeField: "SALES_NARRATIVE", name: "Sales Narrative", value: updatedVersion.narrative },
        { mergeField: "VALUE_PROP_1000W", name: "Value Proposition (1000 words)", value: updatedVersion.description1000w || "" },
        { mergeField: "VALUE_PROP_100W", name: "Value Proposition (100 words)", value: updatedVersion.description100w },
        { mergeField: "VALUE_PROP_50W", name: "Value Proposition (50 words)", value: updatedVersion.description50w },
        { mergeField: "VALUE_PROP_25W", name: "Value Proposition (25 words)", value: updatedVersion.description25w },
      ];

      for (const mv of mergeVariables) {
        await prisma.gtmVariable.upsert({
          where: {
            userId_mergeField: {
              userId: user.id,
              mergeField: mv.mergeField,
            },
          },
          update: { value: mv.value },
          create: {
            userId: user.id,
            mergeField: mv.mergeField,
            name: mv.name,
            value: mv.value,
            isDefault: false,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      version: {
        id: updatedVersion.id,
        title: updatedVersion.title,
        narrative: updatedVersion.narrative,
        description1000w: updatedVersion.description1000w,
        description100w: updatedVersion.description100w,
        description50w: updatedVersion.description50w,
        description25w: updatedVersion.description25w,
        sourceUrls: updatedVersion.sourceUrls,
        sourcePdfNames: updatedVersion.sourcePdfNames,
        createdAt: updatedVersion.createdAt,
      },
    });
  } catch (error) {
    console.error("Error updating sales narrative version:", error);
    return NextResponse.json(
      { error: "Failed to update version" },
      { status: 500 }
    );
  }
}
