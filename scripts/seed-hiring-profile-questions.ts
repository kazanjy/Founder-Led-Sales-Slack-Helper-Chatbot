/**
 * Seed script for AE Hiring Profile Questions
 *
 * Run with: npx ts-node scripts/seed-hiring-profile-questions.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Question {
  category: string;
  question: string;
  helpText?: string;
}

const questions: Question[] = [
  // Company Stage & Context
  {
    category: "Company Stage & Context",
    question: "What's current ARR, and what was ARR 6-12 months ago?",
    helpText: "Helps calibrate the growth stage and urgency of the hire",
  },
  {
    category: "Company Stage & Context",
    question: "Are we pre-PMF, early PMF, or scaling?",
    helpText: "Pre-PMF hires need builders; scaling hires need runners",
  },
  {
    category: "Company Stage & Context",
    question: "What parts of the GTM motion are defined vs still being figured out?",
    helpText: "E.g., is the ICP locked in? Is pricing set? Is the sales process documented?",
  },
  {
    category: "Company Stage & Context",
    question: 'What does "success in 6 months" actually look like for this hire?',
    helpText: "Specific outcomes: closed deals, pipeline built, process documented, etc.",
  },

  // Sales Motion
  {
    category: "Sales Motion",
    question: "What's the typical deal size (range, not just average)?",
    helpText: "E.g., $5K-$50K ACV with a median around $15K",
  },
  {
    category: "Sales Motion",
    question: "What's the actual sales cycle range (fastest to slowest deals)?",
    helpText: "E.g., 2 weeks for SMB to 6 months for enterprise",
  },
  {
    category: "Sales Motion",
    question: "How variable are deals, or are they mostly uniform?",
    helpText: "Do most deals look similar, or is every deal different?",
  },
  {
    category: "Sales Motion",
    question: "How many stakeholders are involved in a typical deal?",
    helpText: "Single buyer vs multi-threaded consensus deals",
  },
  {
    category: "Sales Motion",
    question: "What usually kills deals today?",
    helpText: "Price, competition, inertia, wrong buyer, timing, etc.",
  },

  // Pipeline Generation
  {
    category: "Pipeline Generation",
    question: "What % of pipeline is inbound vs outbound today?",
    helpText: "Helps determine how much self-sourcing the AE needs to do",
  },
  {
    category: "Pipeline Generation",
    question: "How much pipeline will this AE be expected to self-generate?",
    helpText: "0% (pure closer) to 100% (full-cycle hunter)",
  },
  {
    category: "Pipeline Generation",
    question: "What outbound channels are currently working (if any)?",
    helpText: "Email, LinkedIn, cold call, events, referrals, partnerships, etc.",
  },
  {
    category: "Pipeline Generation",
    question: "Is there already an SDR function, or is this AE doing it themselves?",
    helpText: "Determines whether the AE needs prospecting skills",
  },
  {
    category: "Pipeline Generation",
    question: "How consistent is inbound (real pipeline vs occasional luck)?",
    helpText: "Steady flow of qualified leads vs sporadic interest",
  },

  // Product & Narrative Complexity
  {
    category: "Product & Narrative Complexity",
    question: "How well-defined is the problem we solve for customers?",
    helpText: "Obvious pain point vs something we have to educate the market on",
  },
  {
    category: "Product & Narrative Complexity",
    question: "How often do we change the pitch mid-cycle?",
    helpText: "Stable narrative vs constantly evolving value prop",
  },
  {
    category: "Product & Narrative Complexity",
    question: "Is this a known category or something we have to educate the market on?",
    helpText: "Existing budget line item vs creating a new category",
  },
  {
    category: "Product & Narrative Complexity",
    question: "Are we selling clear ROI, or more abstract value?",
    helpText: "Hard dollar savings vs strategic/intangible benefits",
  },
  {
    category: "Product & Narrative Complexity",
    question: "How much technical depth is required to sell effectively?",
    helpText: "Can a business seller do it, or do they need technical chops?",
  },

  // Buyer & Customer Profile
  {
    category: "Buyer & Customer Profile",
    question: "Who is the primary buyer (title + function)?",
    helpText: "E.g., VP Engineering, Head of HR, CFO",
  },
  {
    category: "Buyer & Customer Profile",
    question: "Who else typically gets involved in the deal?",
    helpText: "Champions, influencers, blockers, procurement, legal",
  },
  {
    category: "Buyer & Customer Profile",
    question: "Is there usually a single decision-maker or a consensus process?",
    helpText: "Solo sign-off vs committee/board approval",
  },
  {
    category: "Buyer & Customer Profile",
    question: "Is budget pre-allocated, or do we have to create it?",
    helpText: "Replacing existing spend vs getting new budget approved",
  },
  {
    category: "Buyer & Customer Profile",
    question: 'How clearly defined is our ICP vs "whoever will buy"?',
    helpText: "Tight targeting vs broad spray-and-pray",
  },

  // Role Scope & Expectations
  {
    category: "Role Scope & Expectations",
    question: "Is this a full-cycle role or closing-only?",
    helpText: "Full-cycle = prospect + close; closing-only = handed qualified opps",
  },
  {
    category: "Role Scope & Expectations",
    question: "Will this person be responsible for outbound prospecting?",
    helpText: "If yes, they need hunter DNA, not just closing ability",
  },
  {
    category: "Role Scope & Expectations",
    question: "How much are they expected to contribute to messaging, pricing, ICP definition, and sales process design?",
    helpText: "Early hires often help build the playbook, not just run it",
  },
  {
    category: "Role Scope & Expectations",
    question: "Will they own expansion/upsells, or just net-new?",
    helpText: "Determines whether account management skills matter",
  },

  // Founder Involvement
  {
    category: "Founder Involvement",
    question: "Am I (the founder) still on most sales calls?",
    helpText: "Determines how much domain knowledge transfer is needed",
  },
  {
    category: "Founder Involvement",
    question: "Am I the primary closer today?",
    helpText: "If yes, the AE is replacing you — high bar",
  },
  {
    category: "Founder Involvement",
    question: "How much will I stay involved after this hire?",
    helpText: "Fully hand off vs still on big deals vs always in the room",
  },
  {
    category: "Founder Involvement",
    question: "Is this person replacing me or augmenting me?",
    helpText: "Replacing = they run the motion; augmenting = they add capacity",
  },

  // Product Maturity
  {
    category: "Product Maturity",
    question: "Does the product consistently work in demos?",
    helpText: "Reliable demos vs 'let me show you the roadmap'",
  },
  {
    category: "Product Maturity",
    question: "How often do deals involve features that don't exist yet?",
    helpText: "Selling what's built vs selling the vision",
  },
  {
    category: "Product Maturity",
    question: "Is the onboarding/implementation process well-defined?",
    helpText: "Smooth handoff vs the AE needs to help with implementation",
  },
  {
    category: "Product Maturity",
    question: "How much post-sale support does the AE need to provide?",
    helpText: "Clean handoff to CS vs ongoing relationship management",
  },
];

async function main() {
  console.log("Seeding hiring profile questions...");

  // Scoped to AE. This used to be deleteMany({}), which was fine when
  // there was one bank but would now wipe the SDR and CSM banks too —
  // and HiringProfileAnswer cascades from the question, so it would
  // take real founders' saved answers with it. Other roles are seeded
  // additively by scripts/seed-role-hiring-profile-questions.ts.
  await prisma.hiringProfileQuestion.deleteMany({ where: { roleType: "AE" } });

  // Insert questions with auto-incrementing globalOrder
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    await prisma.hiringProfileQuestion.create({
      data: {
        roleType: "AE",
        category: q.category,
        globalOrder: i + 1,
        question: q.question,
        helpText: q.helpText || null,
        enabled: true,
      },
    });
  }

  console.log(`Seeded ${questions.length} hiring profile questions.`);
}

main()
  .catch((e) => {
    console.error("Error seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
