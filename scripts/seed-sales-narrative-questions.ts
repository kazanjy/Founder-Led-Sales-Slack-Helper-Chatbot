/**
 * Seed script for Sales Narrative Questions
 *
 * Run with: npx ts-node scripts/seed-sales-narrative-questions.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Question {
  category: string;
  question: string;
  helpText?: string;
}

const questions: Question[] = [
  // Product/Service (1 question)
  {
    category: "Product",
    question: "What is the name of your product or service?",
    helpText: "The specific name customers will use to refer to your offering",
  },

  // Problem (4 questions)
  {
    category: "Problem",
    question: "What is the problem?",
    helpText: "Define the core business pain as crisply as possible",
  },
  {
    category: "Problem",
    question: "Who has the problem?",
    helpText:
      "Break out on a per-organizational persona (org type), and per human persona (human type) within those organizational personas.",
  },
  {
    category: "Problem",
    question: "What are the costs associated with the problem?",
    helpText: "Quantify the hard costs, opportunity costs, and soft costs of the status quo",
  },
  {
    category: "Problem",
    question:
      "How do people currently solve this problem, and how do those solutions fall down?",
    helpText:
      "Break out on a per-organizational persona, and per human persona within those organizational personas.",
  },

  // Solution (2 questions)
  {
    category: "Solution",
    question: "What has changed enabling a new solution?",
    helpText: "Identify the market, technology, or behavioral shift that makes a new approach possible",
  },
  {
    category: "Solution",
    question: "How does the new solution work?",
    helpText: "Explain the nuts and bolts in terms your prospect already understands",
  },

  // Proof (1 question)
  {
    category: "Proof",
    question: "How do you know it's better? (Quantitative, Qualitative)",
    helpText: "Present metrics, comparisons, and third-party validation that prove superiority",
  },

  // Business (1 question)
  {
    category: "Business",
    question: "What does it cost? How is it paid?",
    helpText: "Frame pricing against the ROI and cost of current alternatives",
  },
];

async function main() {
  console.log("Seeding Sales Narrative questions...");

  // Check if questions already exist
  const existingCount = await prisma.salesNarrativeQuestion.count();
  if (existingCount > 0) {
    console.log(
      `Found ${existingCount} existing questions. Clearing and re-seeding...`
    );
    await prisma.salesNarrativeAnswer.deleteMany({});
    await prisma.salesNarrativeQuestion.deleteMany({});
  }

  // Insert questions with globalOrder
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    await prisma.salesNarrativeQuestion.create({
      data: {
        category: q.category,
        globalOrder: i + 1,
        question: q.question,
        helpText: q.helpText || null,
      },
    });
  }

  console.log(`Seeded ${questions.length} sales narrative questions.`);

  // Print summary by category
  const categories = ["Product", "Problem", "Solution", "Proof", "Business"];

  for (const cat of categories) {
    const count = questions.filter((q) => q.category === cat).length;
    console.log(`  ${cat}: ${count} questions`);
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
