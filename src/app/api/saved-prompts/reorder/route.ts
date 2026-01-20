import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/saved-prompts/reorder - Reorder prompts after drag-and-drop
 * Body: { promptIds: string[] } - Array of prompt IDs in new order
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { promptIds } = body;

  if (!Array.isArray(promptIds)) {
    return NextResponse.json({ error: "promptIds must be an array" }, { status: 400 });
  }

  // Verify all prompts belong to the user
  const userPrompts = await prisma.savedPrompt.findMany({
    where: { userId: user.id },
    select: { id: true },
  });

  const userPromptIds = new Set(userPrompts.map(p => p.id));
  const allBelongToUser = promptIds.every(id => userPromptIds.has(id));

  if (!allBelongToUser) {
    return NextResponse.json({ error: "Invalid prompt IDs" }, { status: 400 });
  }

  // Update sort order for each prompt
  await prisma.$transaction(
    promptIds.map((id, index) =>
      prisma.savedPrompt.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );

  // Return updated prompts
  const prompts = await prisma.savedPrompt.findMany({
    where: { userId: user.id },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ prompts });
}
