/**
 * Migration script to add the "Sales terminology quiz" prompt to all existing users
 *
 * Run with: npx ts-node scripts/add-terminology-quiz-prompt.ts
 * Or: npx tsx scripts/add-terminology-quiz-prompt.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NEW_PROMPT = {
  defaultPromptId: "default-16",
  emoji: "🔤",
  title: "Can you quiz me on sales terminology?",
  prompt: "Can you quiz me on sales terminology? Give me questions one at a time and let me answer before moving to the next one. Cover common sales terms, acronyms, and concepts.",
};

async function main() {
  console.log("Starting migration: Adding sales terminology quiz prompt to existing users...\n");

  // Get all unique userIds that have saved prompts
  const usersWithPrompts = await prisma.savedPrompt.findMany({
    select: { userId: true },
    distinct: ["userId"],
  });

  console.log(`Found ${usersWithPrompts.length} users with saved prompts\n`);

  let added = 0;
  let skipped = 0;

  for (const { userId } of usersWithPrompts) {
    // Check if user already has this prompt
    const existing = await prisma.savedPrompt.findFirst({
      where: {
        userId,
        defaultPromptId: NEW_PROMPT.defaultPromptId,
      },
    });

    if (existing) {
      console.log(`User ${userId}: Already has prompt, skipping`);
      skipped++;
      continue;
    }

    // Get the highest sortOrder for this user
    const maxSortOrder = await prisma.savedPrompt.aggregate({
      where: { userId },
      _max: { sortOrder: true },
    });

    const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

    // Add the new prompt
    await prisma.savedPrompt.create({
      data: {
        userId,
        emoji: NEW_PROMPT.emoji,
        title: NEW_PROMPT.title,
        prompt: NEW_PROMPT.prompt,
        defaultPromptId: NEW_PROMPT.defaultPromptId,
        sortOrder: nextSortOrder,
      },
    });

    console.log(`User ${userId}: Added prompt at sortOrder ${nextSortOrder}`);
    added++;
  }

  console.log(`\nMigration complete!`);
  console.log(`  Added: ${added}`);
  console.log(`  Skipped (already had it): ${skipped}`);
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
