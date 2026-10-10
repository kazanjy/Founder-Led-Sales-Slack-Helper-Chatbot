/**
 * Seed SDR and CSM hiring profile question banks.
 *
 * Run with: npx tsx scripts/seed-role-hiring-profile-questions.ts
 *
 * DELIBERATELY ADDITIVE. The original seed-hiring-profile-questions.ts
 * opens with deleteMany({}), which was fine when there was exactly one
 * bank but would now wipe every role — and, because HiringProfileAnswer
 * cascades from the question, would destroy real founders' saved
 * answers along with it. This script upserts on (roleType, globalOrder)
 * and never touches the AE bank, so it is safe to re-run.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Question {
  category: string;
  question: string;
  helpText?: string;
}

/**
 * SDR bank.
 *
 * The SDR hire is a different decision from the AE hire and the
 * questions have to reflect that: an AE profile is mostly about deal
 * complexity and autonomy, whereas an SDR profile is about channel,
 * volume, message ownership and who is actually going to coach them.
 * The most common founder mistake here is hiring an SDR to fix a
 * message that doesn't work yet, so several questions push on that.
 */
const SDR_QUESTIONS: Question[] = [
  // Company Stage & Context
  {
    category: "Company Stage & Context",
    question: "Has the founder personally booked meetings with cold outbound in the last 90 days?",
    helpText:
      "The single best predictor of whether an SDR will succeed. If the founder can't book meetings with the current message, an SDR won't either — they'll just fail more expensively",
  },
  {
    category: "Company Stage & Context",
    question: "What's the current meeting-to-opportunity rate, and who is running those meetings?",
    helpText: "If meetings don't convert, more meetings isn't the fix",
  },
  {
    category: "Company Stage & Context",
    question: "Is the ICP locked, or is this hire partly to help figure out who buys?",
    helpText: "An SDR can test a hypothesis; they can't invent one",
  },
  {
    category: "Company Stage & Context",
    question: "What does success at 90 days look like — in meetings, opportunities, or pipeline dollars?",
    helpText: "Pick one primary number. Reps optimize for whatever you actually measure",
  },

  // Pipeline Generation & Channels
  {
    category: "Pipeline Generation & Channels",
    question: "Which channels are working today: cold call, email, LinkedIn, events, referrals?",
    helpText: "Rank them by meetings actually produced, not by effort spent",
  },
  {
    category: "Pipeline Generation & Channels",
    question: "Will this SDR be expected to cold call, and roughly how many dials a day?",
    helpText:
      "Be honest here — phone-averse candidates are common and it is much easier to screen for than to fix",
  },
  {
    category: "Pipeline Generation & Channels",
    question: "Is there a working sequence today, or does the SDR build it?",
    helpText: "Running a proven sequence and writing one from scratch are different jobs and different hires",
  },
  {
    category: "Pipeline Generation & Channels",
    question: "Who owns list building and data — the SDR, ops, or a vendor?",
    helpText: "An SDR spending half their week building lists books roughly half the meetings",
  },
  {
    category: "Pipeline Generation & Channels",
    question: "How much personalization is expected per touch?",
    helpText: "Deep research on 20 accounts a day is a different role from 150 semi-personalized touches",
  },

  // Target & Message
  {
    category: "Target & Message",
    question: "Who exactly are they prospecting into — title, seniority, company size, industry?",
    helpText: "Specific enough that the SDR could build the list themselves from it",
  },
  {
    category: "Target & Message",
    question: "How technical is the buyer, and how technical does the SDR need to sound?",
    helpText: "Selling to platform engineers has a much higher credibility floor than selling to office managers",
  },
  {
    category: "Target & Message",
    question: "What objection kills the most conversations at the top of the funnel?",
    helpText: "Whatever it is, the SDR will hear it fifty times a week — screen for how they handle it",
  },
  {
    category: "Target & Message",
    question: "Can the SDR change the messaging, or do they run what's given to them?",
    helpText: "Autonomy here changes both the seniority you need and the interview questions",
  },

  // Activity & Metrics
  {
    category: "Activity & Metrics",
    question: "What are the daily/weekly activity expectations, and are they enforced?",
    helpText: "An unenforced number is a wish. Say what actually gets inspected",
  },
  {
    category: "Activity & Metrics",
    question: "How is the SDR compensated — base, variable, and on what trigger?",
    helpText: "Meetings booked, meetings held, or opportunities accepted. Each produces different behaviour",
  },
  {
    category: "Activity & Metrics",
    question: "What happens to a meeting that gets booked and then no-shows?",
    helpText: "Whether it counts determines how carefully the SDR qualifies before booking",
  },

  // Role Scope & Ramp
  {
    category: "Role Scope & Ramp",
    question: "Is this a pure SDR seat, or SDR-to-AE with a defined promotion path?",
    helpText: "The best early SDRs almost always want the path. Vague answers here lose candidates",
  },
  {
    category: "Role Scope & Ramp",
    question: "How long until you expect them to be at full activity? At full quota?",
    helpText: "Separate the two — ramping activity is weeks, ramping conversion is months",
  },
  {
    category: "Role Scope & Ramp",
    question: "Will they sit on discovery calls, or hand off at the meeting?",
    helpText: "Attending calls is how an SDR learns the buyer, and how you find out if they can become an AE",
  },
  {
    category: "Role Scope & Ramp",
    question: "Is this the first SDR, or joining an existing team?",
    helpText: "A first SDR has no peer to learn from and needs far more self-direction",
  },

  // Coaching & Management
  {
    category: "Coaching & Management",
    question: "Who coaches this person, and how many hours a week can they genuinely give?",
    helpText: "SDRs are the most coaching-dependent seat in sales. Be realistic rather than aspirational",
  },
  {
    category: "Coaching & Management",
    question: "Who listens to their calls, and how often?",
    helpText: "Call review is the mechanism. If nobody has time for it, hire more experience instead",
  },
  {
    category: "Coaching & Management",
    question: "What tooling exists — CRM, sequencer, dialer, data, call recording?",
    helpText: "Missing tooling shifts weeks of setup onto the new hire",
  },

  // Candidate Bar
  {
    category: "Candidate Bar",
    question: "Would you hire someone with no SDR experience but obvious hunger and coachability?",
    helpText:
      "Phonathon, Cutco/Vector, door-to-door, competitive athletics and hospitality all predict well for this seat",
  },
  {
    category: "Candidate Bar",
    question: "What would make you pass on an otherwise strong candidate?",
    helpText: "Name the disqualifiers explicitly so the screen is consistent across candidates",
  },
];

/**
 * CSM bank.
 *
 * A CSM hire is often miscast at the outset — the same title covers
 * support, onboarding, adoption and a quota-carrying renewal/expansion
 * seat, and those are four different people. Several questions exist
 * purely to force that decision before anyone writes a job description.
 */
const CSM_QUESTIONS: Question[] = [
  // Company Stage & Context
  {
    category: "Company Stage & Context",
    question: "How many customers are there today, and how many will there be in 12 months?",
    helpText: "Sets the account load, which drives whether this is a high-touch or scaled seat",
  },
  {
    category: "Company Stage & Context",
    question: "What's current gross and net retention, and do you trust the numbers?",
    helpText: "If you can't measure churn yet, the first job of this hire may be to instrument it",
  },
  {
    category: "Company Stage & Context",
    question: "Who does customer success today, and what breaks when they stop?",
    helpText: "Usually the founder. Naming what breaks defines the job better than any title does",
  },
  {
    category: "Company Stage & Context",
    question: "What does success at 6 months look like — retention, adoption, expansion, or NPS?",
    helpText: "Pick the primary one. A CSM measured on everything is measured on nothing",
  },

  // What This Seat Actually Is
  {
    category: "What This Seat Actually Is",
    question:
      "Is this a quota-carrying seat? Does it own renewals, expansion, both, or neither?",
    helpText:
      "The most important question in this profile. A CSM who owns a number and one who doesn't are different hires from different candidate pools",
  },
  {
    category: "What This Seat Actually Is",
    question: "What percentage of the week is reactive support versus proactive account work?",
    helpText: "Be honest. Candidates who wanted strategy and got a ticket queue leave inside a year",
  },
  {
    category: "What This Seat Actually Is",
    question: "Who owns onboarding and implementation — this person, or someone else?",
    helpText: "Implementation is a distinct skill set and often a distinct hire",
  },
  {
    category: "What This Seat Actually Is",
    question: "Does this person handle escalations and bugs, or route them?",
    helpText: "Determines how technical they need to be and how much of their week is unplanned",
  },

  // Customer Base & Segments
  {
    category: "Customer Base & Segments",
    question: "What's the ACV range, and how many accounts will one CSM carry?",
    helpText: "20 accounts at $100k and 300 at $6k are unrelated jobs",
  },
  {
    category: "Customer Base & Segments",
    question: "Who is the day-to-day user, and who holds the budget?",
    helpText: "When these differ, the CSM's real job is keeping the budget holder aware of value",
  },
  {
    category: "Customer Base & Segments",
    question: "How sophisticated are your customers about this problem?",
    helpText: "Teaching a category is a different job from optimizing within a known one",
  },
  {
    category: "Customer Base & Segments",
    question: "Which customer segment churns most, and do you know why?",
    helpText: "The answer usually describes the hire's first quarter",
  },

  // Onboarding & Adoption
  {
    category: "Onboarding & Adoption",
    question: "What does onboarding look like today, and how long does time-to-value take?",
    helpText: "Documented and repeatable, or reinvented per customer?",
  },
  {
    category: "Onboarding & Adoption",
    question: "What does a healthy account look like in product usage terms?",
    helpText: "If nobody can answer this, the CSM cannot spot risk before the renewal call",
  },
  {
    category: "Onboarding & Adoption",
    question: "How technical is implementation — SDK, API, integrations, data migration?",
    helpText: "Sets the technical floor and whether they need an SE beside them",
  },
  {
    category: "Onboarding & Adoption",
    question: "Will this person build the playbooks and materials, or run existing ones?",
    helpText: "Building from nothing at an early stage is a builder profile, not an operator profile",
  },

  // Retention & Expansion
  {
    category: "Retention & Expansion",
    question: "How are renewals handled today — auto-renew, formal process, or ad hoc?",
    helpText: "Determines how much commercial muscle the hire needs",
  },
  {
    category: "Retention & Expansion",
    question: "Where does expansion revenue come from — seats, usage, new teams, upsell tiers?",
    helpText: "Expansion motions differ enough that the right candidate differs too",
  },
  {
    category: "Retention & Expansion",
    question: "Is this person expected to run a commercial conversation, including price?",
    helpText: "Many strong CSMs have never negotiated. Screen for it if you need it",
  },
  {
    category: "Retention & Expansion",
    question: "Who do they hand a churn risk to, and how early?",
    helpText: "Escalation paths that only exist in someone's head don't get used",
  },

  // Role Scope & Ramp
  {
    category: "Role Scope & Ramp",
    question: "Is this the first CS hire, or joining an existing function?",
    helpText: "A first CSM inherits every unwritten process the founder has been carrying",
  },
  {
    category: "Role Scope & Ramp",
    question: "What tooling exists — CRM, support desk, product analytics, health scoring?",
    helpText: "Absent tooling means the first quarter is instrumentation, not customers",
  },
  {
    category: "Role Scope & Ramp",
    question: "How much of the role is cross-functional — product feedback, roadmap, marketing?",
    helpText: "Early CS is often the loudest voice of the customer inside the company",
  },

  // Candidate Bar
  {
    category: "Candidate Bar",
    question: "Would you take a strong support or implementation background over CSM-titled experience?",
    helpText: "Title matters far less than whether they've done the work this seat actually contains",
  },
  {
    category: "Candidate Bar",
    question: "What would make you pass on an otherwise strong candidate?",
    helpText: "Name the disqualifiers explicitly so the screen is consistent across candidates",
  },
];

const BANKS: Array<{ roleType: string; questions: Question[] }> = [
  { roleType: "SDR", questions: SDR_QUESTIONS },
  { roleType: "CSM", questions: CSM_QUESTIONS },
];

async function main() {
  for (const { roleType, questions } of BANKS) {
    console.log(`Seeding ${roleType} hiring profile questions (${questions.length})...`);
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const globalOrder = i + 1;
      await prisma.hiringProfileQuestion.upsert({
        where: { roleType_globalOrder: { roleType, globalOrder } },
        update: {
          category: q.category,
          question: q.question,
          helpText: q.helpText || null,
          enabled: true,
        },
        create: {
          roleType,
          globalOrder,
          category: q.category,
          question: q.question,
          helpText: q.helpText || null,
          enabled: true,
        },
      });
    }
    console.log(`  ${roleType}: ${questions.length} questions.`);
  }
  const counts = await prisma.hiringProfileQuestion.groupBy({
    by: ["roleType"],
    _count: true,
  });
  console.log("Question banks:", counts.map((c) => `${c.roleType}=${c._count}`).join(" "));
}

main()
  .catch((e) => {
    console.error("Error seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
