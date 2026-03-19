import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

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

    const version = await prisma.iCPVersion.findUnique({
      where: { id },
      include: {
        salesNarrativeVersion: {
          select: {
            id: true,
            narrative: true,
            createdAt: true,
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

    let content;
    try {
      content = JSON.parse(version.content);
    } catch {
      content = { segments: [] };
    }

    return NextResponse.json({
      currentUserId: user.id,
      version: {
        id: version.id,
        title: version.title,
        content,
        salesNarrativeVersionId: version.salesNarrativeVersionId,
        salesNarrative: version.salesNarrativeVersion,
        createdAt: version.createdAt,
        userId: version.userId,
        user: version.user,
      },
    });
  } catch (error) {
    console.error("Error fetching ICP version:", error);
    return NextResponse.json(
      { error: "Failed to fetch version" },
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

    const existing = await prisma.iCPVersion.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (existing.userId !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (body.content && !body.content.segments) {
      return NextResponse.json(
        { error: "Invalid content structure" },
        { status: 400 }
      );
    }

    const updateData: { content?: string; title?: string } = {};
    if (body.content) updateData.content = JSON.stringify(body.content);
    if (body.title !== undefined) updateData.title = body.title;

    const updated = await prisma.iCPVersion.update({
      where: { id },
      data: updateData,
    });

    // Check if this is the latest version and update merge variable
    const latest = await prisma.iCPVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (latest?.id === id && body.content) {
      const formattedContent = formatICPForMerge(body.content);
      await prisma.gtmVariable.upsert({
        where: {
          userId_mergeField: {
            userId: user.id,
            mergeField: "ICP",
          },
        },
        update: {
          value: formattedContent,
        },
        create: {
          userId: user.id,
          mergeField: "ICP",
          name: "Ideal Customer Profile",
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
    console.error("Error updating ICP version:", error);
    return NextResponse.json(
      { error: "Failed to update version" },
      { status: 500 }
    );
  }
}

function formatICPForMerge(data: {
  segments: Array<{
    name: string;
    description: string;
    firmographic: {
      companySize: string;
      industry: string;
      revenue: string;
      geography: string;
      stage: string;
    };
    technographic: {
      currentTools: string[];
      techMaturity: string;
      integrationNeeds: string;
    };
    timingTriggers: string[];
    painPoints: string[];
    buyingPersonas: Array<{
      title: string;
      role: string;
      motivation: string;
      painPoints: string[];
      objections: string[];
      emotionalDriver: string;
    }>;
  }>;
}): string {
  let output = "";

  for (const segment of data.segments) {
    output += `## ${segment.name}\n\n`;
    output += `${segment.description}\n\n`;
    output += `**Firmographic:** ${segment.firmographic.industry} | ${segment.firmographic.companySize} | ${segment.firmographic.revenue} | ${segment.firmographic.stage}\n`;
    output += `**Technographic:** ${segment.technographic.techMaturity} | Tools: ${segment.technographic.currentTools.join(", ")}\n`;
    output += `**Timing Triggers:** ${segment.timingTriggers.join("; ")}\n`;
    output += `**Pain Points:** ${segment.painPoints.join("; ")}\n\n`;
    output += `### Buying Personas\n\n`;

    for (const persona of segment.buyingPersonas) {
      output += `- **${persona.title}** (${persona.role}): ${persona.motivation}\n`;
    }
    output += "\n";
  }

  return output.trim();
}
