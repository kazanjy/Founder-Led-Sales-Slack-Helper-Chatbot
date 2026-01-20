import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_PROMPTS } from "@/lib/default-prompts";

/**
 * GET /api/saved-prompts - List user's saved prompts
 * If user has none, initialize with defaults
 */
export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user's saved prompts
  let prompts = await prisma.savedPrompt.findMany({
    where: { userId: user.id },
    orderBy: { sortOrder: "asc" },
  });

  // If user has no saved prompts, initialize with defaults
  if (prompts.length === 0) {
    const defaultData = DEFAULT_PROMPTS.map((p, index) => ({
      userId: user.id,
      emoji: p.emoji,
      title: p.title,
      prompt: p.prompt,
      defaultPromptId: p.id,
      sortOrder: index,
    }));

    await prisma.savedPrompt.createMany({
      data: defaultData,
    });

    prompts = await prisma.savedPrompt.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });
  }

  return NextResponse.json({ prompts });
}

/**
 * POST /api/saved-prompts - Create a new saved prompt
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { emoji, title, prompt } = body;

  if (!title || !prompt) {
    return NextResponse.json({ error: "Title and prompt are required" }, { status: 400 });
  }

  // Get the highest sort order
  const lastPrompt = await prisma.savedPrompt.findFirst({
    where: { userId: user.id },
    orderBy: { sortOrder: "desc" },
  });

  const newPrompt = await prisma.savedPrompt.create({
    data: {
      userId: user.id,
      emoji: emoji || "💡",
      title,
      prompt,
      sortOrder: (lastPrompt?.sortOrder ?? -1) + 1,
    },
  });

  return NextResponse.json({ prompt: newPrompt });
}
