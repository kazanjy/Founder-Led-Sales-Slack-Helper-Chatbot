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

    const version = await prisma.icpVersion.findUnique({
      where: { id },
      include: {
        salesNarrativeVersion: {
          select: { id: true, narrative: true, createdAt: true },
        },
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

    let parsedContent;
    try {
      parsedContent = JSON.parse(version.content);
    } catch {
      parsedContent = { sections: [] };
    }

    return NextResponse.json({
      version: {
        id: version.id,
        title: version.title,
        content: parsedContent,
        salesNarrativeVersionId: version.salesNarrativeVersionId,
        salesNarrative: version.salesNarrativeVersion,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
        userId: version.userId,
      },
    });
  } catch (error) {
    console.error("Error fetching ICP version:", error);
    return NextResponse.json(
      { error: "Failed to fetch ICP version" },
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

    const version = await prisma.icpVersion.findUnique({
      where: { id },
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (version.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Validate content structure
    if (content && (!content.sections || !Array.isArray(content.sections))) {
      return NextResponse.json({ error: "Invalid content structure" }, { status: 400 });
    }

    const updateData: { content?: string; title?: string } = {};
    if (content) updateData.content = JSON.stringify(content);
    if (title) updateData.title = title;

    const updated = await prisma.icpVersion.update({
      where: { id },
      data: updateData,
    });

    // If this is the latest version and content was updated, sync merge variable
    if (content) {
      const latestVersion = await prisma.icpVersion.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (latestVersion?.id === id) {
        const formattedContent = formatIcpForMerge(content);
        await prisma.gtmVariable.upsert({
          where: {
            userId_mergeField: {
              userId: user.id,
              mergeField: "ICP",
            },
          },
          update: { value: formattedContent },
          create: {
            userId: user.id,
            mergeField: "ICP",
            name: "Ideal Customer Profile",
            value: formattedContent,
            isDefault: false,
          },
        });
      }
    }

    let parsedContent;
    try {
      parsedContent = JSON.parse(updated.content);
    } catch {
      parsedContent = { sections: [] };
    }

    return NextResponse.json({
      success: true,
      version: {
        id: updated.id,
        title: updated.title,
        content: parsedContent,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating ICP version:", error);
    return NextResponse.json(
      { error: "Failed to update ICP version" },
      { status: 500 }
    );
  }
}

function formatIcpForMerge(data: {
  sections: Array<{
    name: string;
    description: string;
    items: string[];
  }>;
}): string {
  let output = "";
  for (const section of data.sections) {
    output += `## ${section.name}\n`;
    if (section.description) {
      output += `${section.description}\n`;
    }
    output += "\n";
    for (const item of section.items) {
      output += `- ${item}\n`;
    }
    output += "\n";
  }
  return output.trim();
}
