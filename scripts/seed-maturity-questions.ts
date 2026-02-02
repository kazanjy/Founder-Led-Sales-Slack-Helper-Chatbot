/**
 * Seed script for GTM Maturity Assessment Questions
 *
 * Run with: npx ts-node scripts/seed-maturity-questions.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Question {
  category: string;
  question: string;
}

const questions: Question[] = [
  // Revenue Basics (7 questions)
  {
    category: "Revenue Basics",
    question: "Which executive is responsible for revenue?",
  },
  {
    category: "Revenue Basics",
    question: "Revenue Status - What is your current revenue status?",
  },
  {
    category: "Revenue Basics",
    question:
      'Number of "B2B" customers (e.g. not PLG, paying at least $500 / mo)',
  },
  {
    category: "Revenue Basics",
    question: "Amount of monthly recurring revenue",
  },
  {
    category: "Revenue Basics",
    question: "Amount of monthly recurring revenue you are adding per month",
  },
  {
    category: "Revenue Basics",
    question: "Amount of customers you are adding per month",
  },
  {
    category: "Revenue Basics",
    question: "Average monthly per customer revenue.",
  },

  // Value Prop (3 questions)
  {
    category: "Value Prop",
    question:
      "Do you have a crisp understanding of your value proposition to potential customers? Can you articulate that here?",
  },
  {
    category: "Value Prop",
    question:
      "What are the metrics that prove that value? How do you make their business better and what are the dollars and cents that prove that (save money, make money, reduce risk)?",
  },
  {
    category: "Value Prop",
    question:
      "What's pricing? How are you paid? (Up front? Recurringly? By usage?).",
  },

  // ICP (3 questions)
  {
    category: "ICP",
    question:
      'Do you have a crisp idea of who your ideal customer is? Like REALLY ideal - not "kinda nice" but "this is a fastball down the pipe, and it would be CRAZY if they didn\'t buy."',
  },
  {
    category: "ICP",
    question:
      "What are their characteristics? Titles of humans involved. Company characteristics. Complementary technologies used.",
  },
  {
    category: "ICP",
    question: 'What\'s an example of a "juicy" customer?',
  },

  // Leads (8 questions)
  {
    category: "Leads",
    question:
      "Where do leads come from (Inbound? Outbound? Both? Freemium? Demo request?) (are we tracking lead source in the CRM?)",
  },
  {
    category: "Leads",
    question: "Can you provide a link to where demos are requested?",
  },
  {
    category: "Leads",
    question: "Do you have a means of scalable generating them?",
  },
  {
    category: "Leads",
    question: "Are you doing any outbound LinkedIn automation yet?",
  },
  {
    category: "Leads",
    question: "Are you doing any outbound email automation yet?",
  },
  {
    category: "Leads",
    question: "Who engages leads as they come in?",
  },
  {
    category: "Leads",
    question: "How many of them do you think there are in the world?",
  },
  {
    category: "Leads",
    question: "What are your major Lead Sources in your CRM?",
  },

  // Sales Motion (14 questions - including 4 call recording slots)
  {
    category: "Sales Motion",
    question:
      "Can you paste in a discovery call / demo call recording here? (Recording 1) - A smattering of discos and some 'whole deal' calls (e.g., Disco with the prospect, then demo with the same prospect (second call), then further meetings)",
  },
  {
    category: "Sales Motion",
    question: "Can you paste in a discovery call / demo call recording here? (Recording 2)",
  },
  {
    category: "Sales Motion",
    question: "Can you paste in a discovery call / demo call recording here? (Recording 3)",
  },
  {
    category: "Sales Motion",
    question: "Can you paste in a discovery call / demo call recording here? (Recording 4)",
  },
  {
    category: "Sales Motion",
    question: "What are your key discovery questions?",
  },
  {
    category: "Sales Motion",
    question: "What is the presentation / demo process?",
  },
  {
    category: "Sales Motion",
    question:
      "Who executes the presentation / proposal process? How many of these people are there?",
  },
  {
    category: "Sales Motion",
    question:
      "What are the materials used in that presentation / proposal process? (Append them as hyperlinks - deck, business case, etc..)",
  },
  {
    category: "Sales Motion",
    question: "What's a typical sales process?",
  },
  {
    category: "Sales Motion",
    question:
      "Who are the typical humans involved in a sales process from the prospect's side? Are they the same or different from your user?",
  },
  {
    category: "Sales Motion",
    question: "What are typical deal sizes?",
  },
  {
    category: "Sales Motion",
    question:
      "What's a rough win rate? How many deals will you close out of 10 first meetings?",
  },
  {
    category: "Sales Motion",
    question:
      "What's your deal cycle (how long does it typically take to go from first meeting to closed won?)?",
  },
  {
    category: "Sales Motion",
    question:
      "When people don't buy, what are the common Closed Lost reasons? (Are we tracking closed lost reasons in the CRM?)",
  },

  // Sales Operations (4 questions)
  {
    category: "Sales Operations",
    question:
      "How do you track the progress of potential deals? (CRM? Spreadsheet?)",
  },
  {
    category: "Sales Operations",
    question: "How do you record sales calls?",
  },
  {
    category: "Sales Operations",
    question:
      "What sort of reporting and tracking do you have in place to monitor appointment setting, deal flow and pipeline, win/loss rates, loss reasons, etc. Can you spin up reports at will? (What's your Salesforce-acumen?)",
  },
  {
    category: "Sales Operations",
    question:
      "What's your \"sales stack\" currently? CRM. Lead databases. Sales engagement. Call recording. CPQ. Contracting.",
  },

  // Customer Success (3 questions)
  {
    category: "Customer Success",
    question:
      "How do you implement / start up / kick off new customers? How long does this take? Who is responsible for this implementation? How many of them are there?",
  },
  {
    category: "Customer Success",
    question:
      "Do you know what the metrics are that signify customer success with your solution? The metrics that prove they are capturing the value you promised them in exchange for their money? Do you monitor them? Do you share them back to customers? Who is responsible for this monitoring?",
  },
  {
    category: "Customer Success",
    question:
      "How do you handle the renewing of customers? How do you handle the expansion of revenue within a given customer? Who is responsible for this renewal / expansion process?",
  },

  // Organization / Sales Team (14 questions)
  {
    category: "Organization / Sales Team",
    question:
      "What is the formation of your revenue team (lead gen, sales, customer success, account management)?",
  },
  {
    category: "Organization / Sales Team",
    question:
      "What type of position players (AE, SDRs, AMs) do you have and how many of each?",
  },
  {
    category: "Organization / Sales Team",
    question:
      "How do you measure these players and what is your candid assessment of their current efficiency and contribution per each?",
  },
  {
    category: "Organization / Sales Team",
    question:
      'Can you describe your "operating rhythm"? What are the set of meetings that happen and their content to operationalize the sales team.',
  },
  {
    category: "Organization / Sales Team",
    question:
      "What sort of metrics harness do you have in place for measuring activity, pipeline generation, pipeline advancement, pipeline hygiene, and conversion / efficiency?",
  },
  {
    category: "Organization / Sales Team",
    question: "What's your coaching approaching for inspection / improvement?",
  },
  {
    category: "Organization / Sales Team",
    question: "What are your hiring goals?",
  },
  {
    category: "Organization / Sales Team",
    question:
      "What's your hiring workflow? How do you source, assess, and close candidates?",
  },
  {
    category: "Organization / Sales Team",
    question: "How do you do onboarding?",
  },
  {
    category: "Organization / Sales Team",
    question:
      "How would you describe your revenue goals for the next 12 months?",
  },
  {
    category: "Organization / Sales Team",
    question:
      'Do you feel that there is a predictable workflow of "lead generation" to "prospecting appointment / interaction" to "opportunity closed won or loss" to "implementation" to "renewal" right now, where you can add cogs (SDRs, AEs, AMs, CSMs) and it will scale?',
  },
  {
    category: "Organization / Sales Team",
    question:
      "If not, where is there softness? (There's likely issues in lots of places, there always is, but rank them.)",
  },
  {
    category: "Organization / Sales Team",
    question:
      "Do you have sense of the unit economics of a given customer acquisition? The cost of the initial lead / target. The cost to get it to opportunity. The win / loss rate crossed with average contract value. Including all marketing and human costs (cost of marketing and all sales rep players that touch a deal. Sdr / AE / etc.) All of which delivers to a customer acquisition cost to average contract value ratio.",
  },
  {
    category: "Organization / Sales Team",
    question:
      "If you were to list out what you think the biggest critical paths / constraints are in your current go to market, what do you think they are? List them out in a force rank, from most painful to least.",
  },
];

async function main() {
  console.log("Seeding maturity questions...");

  // Delete existing questions
  await prisma.maturityAnswer.deleteMany();
  await prisma.maturityAssessment.deleteMany();
  await prisma.maturityQuestion.deleteMany();

  console.log("Cleared existing maturity data.");

  // Insert questions with globalOrder
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    await prisma.maturityQuestion.create({
      data: {
        category: q.category,
        globalOrder: i + 1,
        question: q.question,
      },
    });
  }

  console.log(`Seeded ${questions.length} maturity questions.`);

  // Print summary by category
  const categories = [
    "Revenue Basics",
    "Value Prop",
    "ICP",
    "Leads",
    "Sales Motion",
    "Sales Operations",
    "Customer Success",
    "Organization / Sales Team",
  ];

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
