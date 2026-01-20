import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDefaultPrompt } from "@/lib/default-prompts";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/saved-prompts/[id] - Update a saved prompt
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { emoji, title, prompt } = body;

  // Verify ownership
  const existing = await prisma.savedPrompt.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  const updated = await prisma.savedPrompt.update({
    where: { id },
    data: {
      emoji: emoji ?? existing.emoji,
      title: title ?? existing.title,
      prompt: prompt ?? existing.prompt,
    },
  });

  return NextResponse.json({ prompt: updated });
}

/**
 * DELETE /api/saved-prompts/[id] - Delete a saved prompt
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const existing = await prisma.savedPrompt.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  await prisma.savedPrompt.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
}

/**
 * POST /api/saved-prompts/[id] - Special actions (reset to default)
 * Body: { action: "reset" }
 */
export async function POST(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { action } = body;

  if (action === "reset") {
    // Verify ownership and that it's a default prompt
    const existing = await prisma.savedPrompt.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    if (!existing.defaultPromptId) {
      return NextResponse.json({ error: "Cannot reset a custom prompt" }, { status: 400 });
    }

    const defaultPrompt = getDefaultPrompt(existing.defaultPromptId);
    if (!defaultPrompt) {
      return NextResponse.json({ error: "Default prompt not found" }, { status: 404 });
    }

    const updated = await prisma.savedPrompt.update({
      where: { id },
      data: {
        emoji: defaultPrompt.emoji,
        title: defaultPrompt.title,
        prompt: defaultPrompt.prompt,
      },
    });

    return NextResponse.json({ prompt: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
