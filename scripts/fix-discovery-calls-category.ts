/**
 * Migration script to fix the category of the "discovery calls" question
 *
 * This question should be in "Sales Motion" but may be in "Leads" in older databases.
 * This script updates the category without deleting any answers.
 *
 * Run with: npx ts-node scripts/fix-discovery-calls-category.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Fixing 'discovery calls' question category...\n");

  // Find the question by its text
  const question = await prisma.maturityQuestion.findFirst({
    where: {
      question: {
        contains: "Can you paste in some discovery call",
      },
    },
  });

  if (!question) {
    console.log("Question not found in database.");
    return;
  }

  console.log(`Found question:`);
  console.log(`  ID: ${question.id}`);
  console.log(`  Current category: ${question.category}`);
  console.log(`  Current order: ${question.globalOrder}`);
  console.log(`  Text: ${question.question.substring(0, 60)}...`);

  if (question.category === "Sales Motion") {
    console.log("\nQuestion is already in 'Sales Motion' category. No changes needed.");
    return;
  }

  // Update the category
  await prisma.maturityQuestion.update({
    where: { id: question.id },
    data: { category: "Sales Motion" },
  });

  console.log(`\nUpdated category from '${question.category}' to 'Sales Motion'`);

  // Show the new state
  const categories = await prisma.maturityQuestion.groupBy({
    by: ["category"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  console.log("\nUpdated category counts:");
  for (const cat of categories) {
    console.log(`  ${cat.category}: ${cat._count.id} questions`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
