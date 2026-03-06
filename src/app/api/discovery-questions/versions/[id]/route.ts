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

    if (version.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Parse the stored JSON content
    let content;
    try {
      content = JSON.parse(version.content);
    } catch {
      content = { categories: [] };
    }

    return NextResponse.json({
      version: {
        id: version.id,
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

    // Validate content structure
    if (!body.content || !body.content.categories) {
      return NextResponse.json(
        { error: "Invalid content structure" },
        { status: 400 }
      );
    }

    // Update the version
    const updated = await prisma.discoveryQuestionsVersion.update({
      where: { id },
      data: {
        content: JSON.stringify(body.content),
      },
    });

    // Check if this is the latest version and update merge variable
    const latest = await prisma.discoveryQuestionsVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (latest?.id === id) {
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
