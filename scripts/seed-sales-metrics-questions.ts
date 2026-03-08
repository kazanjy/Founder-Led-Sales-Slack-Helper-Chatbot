/**
 * Seed script for Sales Metrics Analyzer Questions
 *
 * Run with: npx ts-node scripts/seed-sales-metrics-questions.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Question {
  category: string;
  question: string;
  helpText: string;
}

const questions: Question[] = [
  // Pipeline Activity (2 questions)
  {
    category: "Pipeline Activity",
    question: "How many first meetings do you have in a month?",
    helpText: "Total new prospect first meetings per month",
  },
  {
    category: "Pipeline Activity",
    question: "How many total customer meetings do you have in a week?",
    helpText: "All meetings: discovery, follow-up, demos, QBRs, etc.",
  },

  // Conversion Rates (7 questions)
  {
    category: "Conversion Rates",
    question: "What is your overall win rate?",
    helpText: 'Percentage of opportunities that close-won (e.g., "25%")',
  },
  {
    category: "Conversion Rates",
    question: "How many wins come from first meetings?",
    helpText: "Of all your wins, how many originated from a first meeting you ran?",
  },
  {
    category: "Conversion Rates",
    question: "Out of 10 first meetings, how many become qualified opportunities?",
    helpText: "Qualified = meets your qualification criteria (BANT, MEDDIC, etc.)",
  },
  {
    category: "Conversion Rates",
    question: "Out of 10 first meetings, how many result in a second meeting?",
    helpText: "Second meeting = prospect agreed to continue the conversation",
  },
  {
    category: "Conversion Rates",
    question: "Out of 10 first meetings, how many result in a POC?",
    helpText: "POC = proof of concept, pilot, or trial",
  },
  {
    category: "Conversion Rates",
    question: "What is your win rate from POCs?",
    helpText: "Of deals that go to POC, what % close-won?",
  },
  {
    category: "Conversion Rates",
    question: "What is your win rate from proposals?",
    helpText: "Of deals where you sent a proposal, what % close-won?",
  },

  // Deal Metrics (3 questions)
  {
    category: "Deal Metrics",
    question: "How many meetings does it take to close a deal on average?",
    helpText: "Total meetings from first meeting to close",
  },
  {
    category: "Deal Metrics",
    question: "What is your average selling price (ASP)?",
    helpText: "Average deal size in dollars",
  },
  {
    category: "Deal Metrics",
    question: "What is your average sales cycle length?",
    helpText: "Days from first meeting to close",
  },

  // Revenue Retention (3 questions)
  {
    category: "Revenue Retention",
    question: "What is your renewal rate?",
    helpText: "Percentage of customers that renew",
  },
  {
    category: "Revenue Retention",
    question: "What is your Gross Revenue Retention (GRR)?",
    helpText: "Revenue retained excluding expansion (e.g., \"92%\")",
  },
  {
    category: "Revenue Retention",
    question: "What is your Net Revenue Retention (NRR)?",
    helpText: "Revenue retained including expansion (e.g., \"110%\")",
  },

  // Lead Generation (2 questions)
  {
    category: "Lead Generation",
    question: "How many inbound demo requests do you get per month?",
    helpText: "Inbound = prospects that come to you (demo requests, form fills, etc.)",
  },
  {
    category: "Lead Generation",
    question: "How many outbound discovery/demo meetings do you set per month?",
    helpText: "Outbound = meetings you or your SDRs book proactively",
  },
];

async function main() {
  console.log("Seeding sales metrics questions...");

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const globalOrder = i + 1;

    await prisma.salesMetricsQuestion.upsert({
      where: { globalOrder },
      update: {
        category: q.category,
        question: q.question,
        helpText: q.helpText,
      },
      create: {
        globalOrder,
        category: q.category,
        question: q.question,
        helpText: q.helpText,
      },
    });

    console.log(`  ✓ Q${globalOrder}: ${q.question.substring(0, 60)}...`);
  }

  console.log(`\nDone! Seeded ${questions.length} sales metrics questions.`);
}

main()
  .catch((e) => {
    console.error("Error seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
