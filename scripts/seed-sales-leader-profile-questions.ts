/**
 * Seed script for Sales Leader Hiring Profile Questions
 *
 * Run with: npx ts-node scripts/seed-sales-leader-profile-questions.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Question {
  category: string;
  question: string;
  helpText?: string;
}

const questions: Question[] = [
  // Team Composition & Performance — Structure
  { category: "Team Composition & Performance", question: "How many AEs, BDRs, and other GTM roles exist today?", helpText: "Full headcount picture of the sales org" },
  { category: "Team Composition & Performance", question: "What's the AE:BDR ratio?", helpText: "Indicates how pipeline generation is distributed" },
  { category: "Team Composition & Performance", question: "Are roles clearly defined (SDR → AE → AM), or are they blended/full-cycle?", helpText: "Clarity of the current org structure" },
  { category: "Team Composition & Performance", question: "Who will this person directly manage vs influence?", helpText: "Scope of the leadership role" },
  // Team Composition & Performance — Performance
  { category: "Team Composition & Performance", question: "What % of AEs are hitting quota?", helpText: "Overall team health indicator" },
  { category: "Team Composition & Performance", question: "What does performance distribution look like (top / middle / bottom)?", helpText: "Shape of the bell curve" },
  { category: "Team Composition & Performance", question: "Are top reps succeeding because of skill or territory/luck?", helpText: "Determines if success is repeatable" },
  { category: "Team Composition & Performance", question: "What are the primary reasons reps miss quota today?", helpText: "Root cause of underperformance" },
  // Team Composition & Performance — Rep-level carryover
  { category: "Team Composition & Performance", question: "What's quota vs actual attainment by rep?", helpText: "Granular performance data" },
  { category: "Team Composition & Performance", question: "How consistent is performance across reps?", helpText: "Variance in outcomes" },
  { category: "Team Composition & Performance", question: "How long does it take a new AE to ramp to productivity?", helpText: "Current ramp time and onboarding effectiveness" },

  // Pipeline Generation & Ownership — System view
  { category: "Pipeline Generation & Ownership", question: "What % of pipeline is inbound vs outbound?", helpText: "Pipeline source mix" },
  { category: "Pipeline Generation & Ownership", question: "What's current pipeline coverage (pipeline / quota)?", helpText: "E.g., 3x coverage means $3 in pipe for every $1 of quota" },
  { category: "Pipeline Generation & Ownership", question: "How predictable is pipeline generation today?", helpText: "Steady vs feast-or-famine" },
  // Pipeline Generation & Ownership — Ownership
  { category: "Pipeline Generation & Ownership", question: "How much pipeline are AEs expected to self-source?", helpText: "0% (pure closer) to 100% (full-cycle hunter)" },
  { category: "Pipeline Generation & Ownership", question: "Is there a functioning SDR team? If so, how effective is it?", helpText: "SDR contribution to pipeline" },
  { category: "Pipeline Generation & Ownership", question: "What outbound channels are currently working (if any)?", helpText: "Email, LinkedIn, cold call, events, referrals, etc." },
  // Pipeline Generation & Ownership — Rep-level carryover
  { category: "Pipeline Generation & Ownership", question: "How much pipeline do top reps self-generate vs bottom reps?", helpText: "Correlation between self-sourcing and performance" },
  { category: "Pipeline Generation & Ownership", question: "Is inbound actually consistent, or episodic?", helpText: "Reliability of marketing-generated pipeline" },
  { category: "Pipeline Generation & Ownership", question: "Where does pipeline quality break down most often?", helpText: "Bad-fit leads, unqualified opps, etc." },

  // Funnel Health & Forecasting — Conversion
  { category: "Funnel Health & Forecasting", question: "What are stage-by-stage conversion rates?", helpText: "E.g., SQL → SAL → SQO → Closed Won" },
  { category: "Funnel Health & Forecasting", question: "Where do deals most commonly stall or die?", helpText: "Which stage is the biggest bottleneck" },
  { category: "Funnel Health & Forecasting", question: "Are stages clearly defined with exit criteria?", helpText: "Process maturity indicator" },
  // Funnel Health & Forecasting — Forecasting
  { category: "Funnel Health & Forecasting", question: "How accurate are current forecasts?", helpText: "Within 10%? 30%? Wildly off?" },
  { category: "Funnel Health & Forecasting", question: "Is forecasting data-driven or intuition-based?", helpText: "Weighted pipeline vs gut feel" },
  { category: "Funnel Health & Forecasting", question: "How early can we reliably predict misses?", helpText: "Leading indicator visibility" },
  // Funnel Health & Forecasting — Rep-level carryover
  { category: "Funnel Health & Forecasting", question: "What typically kills deals today? (no decision, budget, competition, etc.)", helpText: "Top loss reasons" },
  { category: "Funnel Health & Forecasting", question: "How variable are deal cycles (fastest → slowest)?", helpText: "Range and predictability of sales cycles" },
  { category: "Funnel Health & Forecasting", question: "How many stakeholders are typically involved?", helpText: "Single buyer vs multi-threaded consensus" },

  // Sales Process & Infrastructure — Process maturity
  { category: "Sales Process & Infrastructure", question: "Do we have a defined sales methodology (or not)?", helpText: "MEDDIC, Challenger, SPIN, custom, or none" },
  { category: "Sales Process & Infrastructure", question: "Is qualification consistent across reps?", helpText: "Do all reps qualify the same way?" },
  { category: "Sales Process & Infrastructure", question: "Is there a standardized sales motion, or is everyone winging it?", helpText: "Process adherence vs individual approaches" },
  // Sales Process & Infrastructure — Tools & hygiene
  { category: "Sales Process & Infrastructure", question: "How clean and reliable is CRM data?", helpText: "Data quality for decision-making" },
  { category: "Sales Process & Infrastructure", question: "Are reps consistently using CRM and following process?", helpText: "Tool adoption and compliance" },
  // Sales Process & Infrastructure — Enablement
  { category: "Sales Process & Infrastructure", question: "Is there onboarding for new reps?", helpText: "Structured vs ad hoc ramp process" },
  { category: "Sales Process & Infrastructure", question: "Do we have playbooks, or is knowledge tribal?", helpText: "Documentation vs institutional memory" },
  { category: "Sales Process & Infrastructure", question: "What does ramp look like today?", helpText: "Time to first deal, first quota attainment" },
  // Sales Process & Infrastructure — Rep-level carryover
  { category: "Sales Process & Infrastructure", question: "How often do reps change the pitch mid-cycle?", helpText: "Narrative stability vs constant iteration" },
  { category: "Sales Process & Infrastructure", question: "How much does each rep 'do their own thing' vs follow a system?", helpText: "Individual variance in approach" },

  // Hiring & Scaling Plan — Growth expectations
  { category: "Hiring & Scaling Plan", question: "How many reps do we plan to hire in the next 6-12 months?", helpText: "Scale of the hiring mandate" },
  { category: "Hiring & Scaling Plan", question: "Are we hiring ahead of demand or reacting to it?", helpText: "Proactive vs reactive growth" },
  // Hiring & Scaling Plan — Hiring clarity
  { category: "Hiring & Scaling Plan", question: "Do we know what a successful AE looks like here yet?", helpText: "Clarity of the ideal rep profile" },
  { category: "Hiring & Scaling Plan", question: "Do we have a defined hiring profile, or is it still evolving?", helpText: "Maturity of recruiting process" },
  // Hiring & Scaling Plan — Ownership
  { category: "Hiring & Scaling Plan", question: "Who is currently responsible for hiring?", helpText: "Founder, HR, recruiting agency, etc." },
  { category: "Hiring & Scaling Plan", question: "Will this leader own recruiting and building the team?", helpText: "Hiring as part of the mandate" },
  // Hiring & Scaling Plan — Rep-level carryover
  { category: "Hiring & Scaling Plan", question: "What backgrounds have worked best so far (if any)?", helpText: "Patterns in successful hires" },
  { category: "Hiring & Scaling Plan", question: "Where have previous hires failed—and why?", helpText: "Anti-patterns to avoid" },

  // GTM Strategy Alignment — ICP & segmentation
  { category: "GTM Strategy Alignment", question: "Is ICP clearly defined and validated?", helpText: "Locked in vs still experimenting" },
  { category: "GTM Strategy Alignment", question: "Are we focused on a specific segment or selling broadly?", helpText: "Targeted vs horizontal approach" },
  // GTM Strategy Alignment — Product & narrative
  { category: "GTM Strategy Alignment", question: "How well-defined is the problem we solve?", helpText: "Obvious pain vs requires education" },
  { category: "GTM Strategy Alignment", question: "Is this a known category or do we need to educate buyers?", helpText: "Existing budget vs creating new category" },
  { category: "GTM Strategy Alignment", question: "Are we selling ROI, features, or vision?", helpText: "Nature of the value proposition" },
  // GTM Strategy Alignment — Competitive
  { category: "GTM Strategy Alignment", question: "Who do we win against and lose to most often?", helpText: "Competitive landscape" },
  { category: "GTM Strategy Alignment", question: "Are we displacing incumbents or creating a new category?", helpText: "Market positioning" },
  // GTM Strategy Alignment — Rep-level carryover
  { category: "GTM Strategy Alignment", question: "Who is the primary buyer (title/function)?", helpText: "E.g., VP Sales, CRO, Head of Revenue Ops" },
  { category: "GTM Strategy Alignment", question: "Is budget pre-allocated or created during the sale?", helpText: "Budget dynamics" },
  { category: "GTM Strategy Alignment", question: "How educated are buyers before engaging with us?", helpText: "Buyer sophistication level" },

  // Founder Involvement & Role Clarity
  { category: "Founder Involvement & Role Clarity", question: "Is the founder still leading or closing deals?", helpText: "Current founder role in sales" },
  { category: "Founder Involvement & Role Clarity", question: "How involved is the founder in deal strategy?", helpText: "Tactical involvement level" },
  { category: "Founder Involvement & Role Clarity", question: "How involved is the founder in pricing decisions?", helpText: "Pricing authority" },
  { category: "Founder Involvement & Role Clarity", question: "How involved is the founder in forecasting?", helpText: "Forecasting ownership" },
  { category: "Founder Involvement & Role Clarity", question: "Is this leader replacing the founder in sales, or augmenting them?", helpText: "Replacing = they run the motion; augmenting = they add capacity" },
  { category: "Founder Involvement & Role Clarity", question: "Who owns final decision-making on GTM direction?", helpText: "Strategic authority" },
  { category: "Founder Involvement & Role Clarity", question: "Is this person expected to execute, or to define strategy?", helpText: "Critical alignment question — operator vs strategist" },

  // Leadership Mandate
  { category: "Leadership Mandate", question: "Why are we hiring this person right now? Rank: build from scratch, fix broken team, scale working system, improve forecasting, increase productivity, hire and build team.", helpText: "Primary mandate for the role" },
  { category: "Leadership Mandate", question: "What does success look like in 30 days?", helpText: "Immediate expectations" },
  { category: "Leadership Mandate", question: "What does success look like in 90 days?", helpText: "First quarter milestones" },
  { category: "Leadership Mandate", question: "What does success look like in 6 months?", helpText: "Half-year deliverables" },
  { category: "Leadership Mandate", question: "What does 'success' look like for an AE today?", helpText: "Current rep-level success criteria" },
  { category: "Leadership Mandate", question: "What are the biggest constraints preventing reps from hitting quota?", helpText: "Systemic blockers the leader must address" },

  // Coaching, Culture & Operating Environment
  { category: "Coaching, Culture & Operating Environment", question: "Do reps need development (skill gaps) or replacement (talent gaps)?", helpText: "Coach vs rebuild decision" },
  { category: "Coaching, Culture & Operating Environment", question: "Is the issue coaching, motivation, or hiring quality?", helpText: "Root cause of team performance" },
  { category: "Coaching, Culture & Operating Environment", question: "How much process vs chaos exists today?", helpText: "Operational maturity level" },
  { category: "Coaching, Culture & Operating Environment", question: "How often do things change (weekly, monthly, quarterly)?", helpText: "Rate of change and stability" },
  { category: "Coaching, Culture & Operating Environment", question: "Is the org data-driven or intuition-driven?", helpText: "Decision-making culture" },
  { category: "Coaching, Culture & Operating Environment", question: "Would a highly process-driven leader succeed here?", helpText: "Cultural fit indicator" },
  { category: "Coaching, Culture & Operating Environment", question: "Or do we need someone comfortable with ambiguity and iteration?", helpText: "Builder vs scaler mindset" },
  { category: "Coaching, Culture & Operating Environment", question: "Can reps succeed without structure today?", helpText: "Dependency on individual initiative" },
  { category: "Coaching, Culture & Operating Environment", question: "How much support do reps expect vs create themselves?", helpText: "Self-sufficiency level of the team" },
];

async function main() {
  console.log("Seeding sales leader profile questions...");
  await prisma.salesLeaderProfileQuestion.deleteMany({});

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    await prisma.salesLeaderProfileQuestion.create({
      data: {
        category: q.category,
        globalOrder: i + 1,
        question: q.question,
        helpText: q.helpText || null,
        enabled: true,
      },
    });
  }

  console.log(`Seeded ${questions.length} sales leader profile questions.`);
}

main()
  .catch((e) => {
    console.error("Error seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
