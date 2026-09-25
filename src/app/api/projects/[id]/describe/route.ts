import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

// POST — AI-generate a description from conversation titles/previews
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const project = await prisma.project.findFirst({
      where: { id, userId: user.id },
      include: {
        conversations: {
          where: { archived: false },
          orderBy: { lastMessageAt: "desc" },
          take: 20,
          select: {
            title: true,
            firstMessagePreview: true,
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.conversations.length === 0) {
      return NextResponse.json({ error: "No conversations in this project to describe" }, { status: 400 });
    }

    const chatSummary = project.conversations
      .map((c) => {
        let line = c.title || "Untitled";
        if (c.firstMessagePreview) line += ` — ${c.firstMessagePreview}`;
        return line;
      })
      .join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        {
          role: "system",
          content: "Write a concise 1-2 sentence description of what this project folder is about, based on the conversation titles below. Be specific and practical. Do not use quotes or markdown.",
        },
        {
          role: "user",
          content: `Project name: "${project.name}"\n\nConversations in this project:\n${chatSummary}`,
        },
      ],
      max_tokens: 150,
    });

    const description = response.choices[0]?.message?.content?.trim() || "";

    // Save the description
    await prisma.project.update({
      where: { id },
      data: { description },
    });

    return NextResponse.json({ description });
  } catch (error) {
    console.error("Error generating project description:", error);
    return NextResponse.json({ error: "Failed to generate description" }, { status: 500 });
  }
}
