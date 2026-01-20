import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/saved-prompts/clone - Clone a prompt
 * Body: { promptId: string }
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { promptId } = body;

  if (!promptId) {
    return NextResponse.json({ error: "promptId is required" }, { status: 400 });
  }

  // Get the prompt to clone
  const original = await prisma.savedPrompt.findFirst({
    where: { id: promptId, userId: user.id },
  });

  if (!original) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  // Get the highest sort order
  const lastPrompt = await prisma.savedPrompt.findFirst({
    where: { userId: user.id },
    orderBy: { sortOrder: "desc" },
  });

  // Create the clone
  const cloned = await prisma.savedPrompt.create({
    data: {
      userId: user.id,
      emoji: original.emoji,
      title: `${original.title} (copy)`,
      prompt: original.prompt,
      // Don't copy defaultPromptId - clones are custom
      sortOrder: (lastPrompt?.sortOrder ?? -1) + 1,
    },
  });

  return NextResponse.json({ prompt: cloned });
}
