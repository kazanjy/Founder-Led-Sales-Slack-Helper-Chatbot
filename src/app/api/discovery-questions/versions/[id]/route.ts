import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Get a specific discovery questions version
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

    const version = await prisma.discoveryQuestionsVersion.findUnique({
      where: { id },
      include: {
        salesNarrativeVersion: {
          select: {
            id: true,
            narrative: true,
            createdAt: true,
          },
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

    // Parse the stored JSON content
    let content;
    try {
      content = JSON.parse(version.content);
    } catch {
      content = { categories: [] };
    }

    return NextResponse.json({
      currentUserId: user.id,
      version: {
        id: version.id,
        userId: version.userId,
        title: version.title,
        content,
        salesNarrativeVersionId: version.salesNarrativeVersionId,
        salesNarrative: version.salesNarrativeVersion,
        createdAt: version.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching discovery questions version:", error);
    return NextResponse.json(
      { error: "Failed to fetch version" },
      { status: 500 }
    );
  }
}

// PATCH - Update a discovery questions version
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

    // Verify ownership
    const existing = await prisma.discoveryQuestionsVersion.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (existing.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Validate content structure (content is optional if only updating title)
    if (body.content && !body.content.categories) {
      return NextResponse.json(
        { error: "Invalid content structure" },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: { content?: string; title?: string } = {};
    if (body.content) updateData.content = JSON.stringify(body.content);
    if (body.title !== undefined) updateData.title = body.title;

    // Update the version
    const updated = await prisma.discoveryQuestionsVersion.update({
      where: { id },
      data: updateData,
    });

    // Check if this is the latest version and update merge variable
    const latest = await prisma.discoveryQuestionsVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (latest?.id === id && body.content) {
      // Update the merge variable
      const formattedContent = formatDiscoveryQuestionsForMerge(body.content);
      await prisma.gtmVariable.upsert({
        where: {
          userId_mergeField: {
            userId: user.id,
            mergeField: "DISCOVERY_QUESTIONS",
          },
        },
        update: {
          value: formattedContent,
        },
        create: {
          userId: user.id,
          mergeField: "DISCOVERY_QUESTIONS",
          name: "Discovery Questions",
          value: formattedContent,
          isDefault: false,
        },
      });
    }

    return NextResponse.json({
      success: true,
      version: {
        id: updated.id,
        title: updated.title,
        content: body.content,
        createdAt: updated.createdAt,
      },
    });
  } catch (error) {
    console.error("Error updating discovery questions version:", error);
    return NextResponse.json(
      { error: "Failed to update version" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a specific discovery questions version
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

    const version = await prisma.discoveryQuestionsVersion.findUnique({
      where: { id },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (version.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Delete the version (cascading deletes will handle related records)
    await prisma.discoveryQuestionsVersion.delete({
      where: { id },
    });

    // If this was the latest version, update merge variables from the new latest (or clear them)
    const newLatest = await prisma.discoveryQuestionsVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    const mergeValue = newLatest
      ? formatDiscoveryQuestionsForMerge(JSON.parse(newLatest.content))
      : "";

    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "DISCOVERY_QUESTIONS",
        },
      },
      update: { value: mergeValue },
      create: {
        userId: user.id,
        mergeField: "DISCOVERY_QUESTIONS",
        name: "Discovery Questions",
        value: mergeValue,
        isDefault: false,
      },
    });

    return NextResponse.json({ success: true, hasRemaining: !!newLatest });
  } catch (error) {
    console.error("Error deleting discovery questions version:", error);
    return NextResponse.json(
      { error: "Failed to delete version" },
      { status: 500 }
    );
  }
}

// Format discovery questions for merge variable
function formatDiscoveryQuestionsForMerge(data: {
  categories: Array<{
    name: string;
    description: string;
    questions: Array<{
      primary: string;
      followUps: string[];
    }>;
  }>;
}): string {
  let output = "";

  for (const category of data.categories) {
    output += `## ${category.name}\n\n`;

    for (let i = 0; i < category.questions.length; i++) {
      const q = category.questions[i];
      output += `${i + 1}. ${q.primary}\n`;

      if (q.followUps && q.followUps.length > 0) {
        for (const followUp of q.followUps) {
          output += `   - ${followUp}\n`;
        }
      }
      output += "\n";
    }
  }

  return output.trim();
}
