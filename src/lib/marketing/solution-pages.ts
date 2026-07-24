import type { MarketingPage } from "./types";

/**
 * SOLUTIONS pages — one per use case / job-to-be-done. Problem-
 * centric: they start from the founder's pain in the founder's own
 * search language, then map it onto multiple features. These target
 * the higher-intent, earlier-funnel queries ("how to do founder led
 * sales", "sales for technical founders").
 */
export const SOLUTION_PAGES: MarketingPage[] = [
  {
    slug: "technical-founder-sales",
    seoTitle: "Sales for Technical Founders — Learn to Sell Your Product | Mikey",
    seoDescription:
      "You built the product; now you have to sell it. Mikey gives technical founders a playbook, a coach, practice reps, and a pipeline that runs itself.",
    h1: "Sales for Technical Founders",
    subhead: "You didn't become a founder to do sales. Do it anyway — with a system instead of vibes.",
    intro:
      "Nobody funded you for your discovery calls. But between seed and your first sales hire, the founder is the sales team — and winging it burns the exact prospects you can't afford to lose. Mikey turns founder-led selling from an anxiety into a process: a playbook generated from your own thinking, practice reps before real calls, a coach that reads your transcripts, and a pipeline that maintains itself.",
    sections: [
      {
        heading: "Stop improvising, start running a motion",
        body: "Mikey interviews you and produces the playbook you'd never sit down to write — narrative, ICP, discovery questions, deck — each derived from the last so it all argues one case.",
      },
      {
        heading: "Practice on robots, not prospects",
        body: "Roleplay discovery and full calls against AI buyers built from your real pipeline. Get graded, get better, then take the real meeting.",
      },
      {
        heading: "Let the pipeline run itself",
        body: "Deals auto-created from your calendar and recorder, analysis refreshed after every call, follow-ups drafted in your voice and sent from Slack with one tap. The admin work you were never going to do — done.",
      },
      {
        heading: "A coach who has read everything",
        body: "Weekly coaching grounded in Founding Sales, your maturity stage, and your actual calls — with goals and priorities that persist between sessions.",
      },
    ],
    faqs: [
      {
        q: "I have zero sales background. Where do I start?",
        a: "Take the GTM maturity assessment. It places you on a stage, and Mikey's coaching starts from there — usually with your narrative and your first structured discovery calls.",
      },
      {
        q: "How much time does this take per week?",
        a: "The point is that it takes less: briefs arrive before calls, recaps and follow-ups draft themselves, and the pipeline updates without data entry. Founders typically spend their saved hours on more calls.",
      },
    ],
    relatedFeatures: ["sales-coaching", "practice-roleplay", "sales-playbook", "deal-pipeline-autopilot"],
    relatedSolutions: ["learn-to-sell", "founder-led-sales-playbook"],
    ctaLine: "Take the assessment — see exactly where your sales motion stands.",
  },
  {
    slug: "founder-led-sales-playbook",
    seoTitle: "How to Do Founder-Led Sales — The Complete System | Mikey",
    seoDescription:
      "Founder-led sales, systematized: build the playbook, run the calls, work the pipeline, and capture the proof — based on Pete Kazanjy's Founding Sales.",
    h1: "The Founder-Led Sales System",
    subhead: "Everything between \"we have a product\" and \"we have a sales team\" — in one place, in one voice.",
    intro:
      "Founder-led sales isn't a phase to survive; it's where your company learns what it's actually selling. Mikey is the operating system for that period: the playbook artifacts, the call execution, the pipeline discipline, and the customer proof — all built on Pete Kazanjy's Founding Sales methodology, all generated from your own narrative.",
    sections: [
      {
        heading: "Build the playbook once, use it everywhere",
        body: "Narrative → ICP → discovery questions → deck → outreach. One chain, one voice — and every other part of Mikey (deal analysis, practice grading, pre-call briefs) reads from it.",
      },
      {
        heading: "Execute calls like you've done this before",
        body: "Briefs before every meeting, practice drills against realistic buyers, scorecards and recap emails after — the full call loop, automated.",
      },
      {
        heading: "Run the pipeline without a CRM habit",
        body: "Deals detect themselves from your calendar and recorder; analysis, tasks, and alerts keep them moving; the Execution Review catches what's drifting.",
      },
      {
        heading: "Bank the proof as you win",
        body: "Customer calls become quoted, metric-backed testimonials and case studies — the assets your next-stage marketing will beg for.",
      },
    ],
    faqs: [
      {
        q: "Is this based on the Founding Sales book?",
        a: "Yes — Mikey is built on Pete Kazanjy's Founding Sales methodology, with a GTM maturity model that keeps the guidance matched to your stage.",
      },
      {
        q: "What if I already have some playbook pieces?",
        a: "Bring them. Mikey's artifacts are editable and versioned — import what you have and let the chain keep everything downstream consistent.",
      },
    ],
    relatedFeatures: ["sales-playbook", "deal-pipeline-autopilot", "customer-proof", "sales-coaching"],
    relatedSolutions: ["technical-founder-sales", "first-sales-hire"],
    ctaLine: "Start with the narrative — the rest of the playbook follows.",
  },
  {
    slug: "learn-to-sell",
    seoTitle: "Learn to Sell as a Founder — Coaching + Practice | Mikey",
    seoDescription:
      "Learn sales by doing it well: AI coaching on your real calls, roleplay drills with grading, and a methodology that tells you what good looks like.",
    h1: "Learn to Sell — On the Job",
    subhead: "Coaching, reps, and film review. The way athletes learn, applied to founder selling.",
    intro:
      "You can't read your way into being good at sales, and you shouldn't learn on your twenty best prospects. Mikey gives you the training loop: practice drills that grade your discovery against a real rubric, call reviews that show you the film on your actual meetings, and a coach that turns both into this week's priorities.",
    sections: [
      {
        heading: "Reps before games",
        body: "Rapport, agenda-setting, discovery, and full-call drills against AI buyers who deflect and go shallow like real ones. Streaks and scores show you getting better.",
      },
      {
        heading: "Film review on real calls",
        body: "Every recording gets a scorecard — where you accepted a surface answer, where you talked too much, whether you left with a dated next step — with timestamped receipts.",
      },
      {
        heading: "A coach that closes the loop",
        body: "Sessions read your drills and your calls, set priorities, and check follow-through. What you practice is what you're graded on, which is what you're coached on.",
      },
    ],
    faqs: [
      {
        q: "How fast do founders actually improve?",
        a: "Discovery quality moves within a few drilled reps because the grading is specific: which question you skipped, which pain you didn't quantify. The scorecard makes the gap visible, and visible gaps close.",
      },
      {
        q: "What methodology is 'good' defined by?",
        a: "Founding Sales — the discovery structure, the call anatomy, and the founder-stage judgment calls come from Pete Kazanjy's methodology, applied to your playbook.",
      },
    ],
    relatedFeatures: ["practice-roleplay", "call-review", "sales-coaching"],
    relatedSolutions: ["technical-founder-sales", "founder-led-sales-playbook"],
    ctaLine: "Run one drill. See your actual score. Improve from there.",
  },
  {
    slug: "founder-crm-alternative",
    seoTitle: "CRM Alternative for Founders — Pipeline Without Data Entry | Mikey",
    seoDescription:
      "Skip the CRM you'll never update. Mikey builds pipeline from your calendar, call recorder, and Slack — with AI analysis and follow-ups instead of empty fields.",
    h1: "The Pipeline You'll Actually Keep Updated",
    subhead: "Because it updates itself. A CRM alternative built for how founders really sell.",
    intro:
      "Every founder buys a CRM, enters four deals, and never logs in again — because CRMs are databases that demand labor and give back reports. Mikey inverts it: your calendar, call recorder, and Slack already contain the truth of your pipeline, so Mikey reads them, builds the deals, and gives back judgment — analysis, health, drafted next moves.",
    sections: [
      {
        heading: "Zero-entry pipeline",
        body: "Deals auto-detected from meetings and recordings, evidence auto-attached, contacts auto-extracted from attendees and transcripts. Your job is one-tap confirmations, not fields.",
      },
      {
        heading: "Intelligence, not just storage",
        body: "Every deal carries a full-transcript AI analysis: current state, momentum, health, and the next best action with the message drafted. A CRM tells you the stage; Mikey tells you what to do.",
      },
      {
        heading: "Works where you work",
        body: "Alerts, briefs, and one-touch follow-ups in Slack. The pipeline view is there when you want it; the pipeline's voice comes to you when you don't.",
      },
    ],
    faqs: [
      {
        q: "What happens when we outgrow it and adopt a real CRM?",
        a: "That's the plan working. Mikey carries you through the founder-led period with clean deal history and a proven playbook; when a sales team arrives, you adopt a CRM for them and keep Mikey as the intelligence layer.",
      },
      {
        q: "Can I still enter things manually?",
        a: "Of course — paste emails, drop screenshots, add notes, create deals by hand. Manual entry is supported; it's just no longer required.",
      },
    ],
    relatedFeatures: ["deal-pipeline-autopilot", "slack-sales-assistant", "call-review"],
    relatedSolutions: ["win-more-deals", "sell-in-slack"],
    ctaLine: "Connect calendar + recorder. Watch your pipeline assemble itself.",
  },
  {
    slug: "win-more-deals",
    seoTitle: "Close More Deals as a Founder — AI Deal Execution | Mikey",
    seoDescription:
      "Deals die from dropped follow-ups and cold silences, not lost arguments. Mikey catches drift, drafts the save, and keeps every commitment moving.",
    h1: "Stop Losing Winnable Deals",
    subhead: "Most founder deals don't get beaten — they get dropped. Mikey is the anti-drop system.",
    intro:
      "Look at your last five dead deals. How many were lost on the merits, and how many just… trailed off? Founders lose winnable deals to unsent follow-ups, unprepared calls, and weeks of accidental silence. Mikey attacks exactly that: every commitment becomes a tracked task with the message pre-drafted, every call gets prep, and quiet deals get flagged with a proposed save.",
    sections: [
      {
        heading: "Commitments never fall through the cracks",
        body: "Task detection reads every call and thread for promises — yours and theirs — and schedules them with evidence quotes. When one's due, the follow-up arrives drafted in your voice, one tap from sent.",
      },
      {
        heading: "Silence gets caught early",
        body: "The Execution Review surfaces deals gone quiet and overdue commitments, then proposes the move — send this message, close it lost, or wait — with the reasoning shown. Honest triage beats a rotting pipeline.",
      },
      {
        heading: "Every call is a prepared call",
        body: "Briefs four hours ahead with objectives and landmines; scorecards and recap emails after. The at-bats you get, you convert.",
      },
    ],
    faqs: [
      {
        q: "How is this different from CRM reminders?",
        a: "A reminder says 'follow up with Acme.' Mikey hands you the follow-up already written from the deal history, in your voice, with a send button. The activation energy drops to one tap — which is why it actually happens.",
      },
      {
        q: "Will it tell me to give up on deals?",
        a: "When the evidence says so, yes — with the receipts. Carrying dead deals costs attention that live ones need. You always make the final call.",
      },
    ],
    relatedFeatures: ["deal-pipeline-autopilot", "pre-call-planning", "call-review", "slack-sales-assistant"],
    relatedSolutions: ["founder-crm-alternative", "technical-founder-sales"],
    ctaLine: "Run an Execution Review on your pipeline — see what's quietly dying.",
  },
  {
    slug: "sell-in-slack",
    seoTitle: "Selling Through Shared Slack Channels — Slack Sales for Founders | Mikey",
    seoDescription:
      "Your deals live in shared Slack channels. Mikey reads them as evidence, drafts responses in your voice, and turns channel activity into pipeline signal.",
    h1: "Selling in Shared Slack Channels",
    subhead: "Slack-first deals deserve Slack-first tooling — evidence, momentum, and follow-ups where the deal actually lives.",
    intro:
      "For a growing class of founder deals, the real selling happens in a shared Slack channel — the demo follow-ups, the pricing questions, the champion's nudges. Every other sales tool is blind to it. Mikey attaches those channels to their deals, reads them as you (no bot invites), and turns channel activity into the same evidence stream as calls and emails.",
    sections: [
      {
        heading: "Channels as first-class deal evidence",
        body: "Attach a shared channel to its deal and the conversation syncs to the timeline. Deal analysis reads it; momentum shifts in the channel show up in deal health.",
      },
      {
        heading: "Reply as you, with leverage",
        body: "Follow-ups draft in your saved Slack voice, grounded in the whole deal history, and send as you with one approving tap. Even lapsed channels get watched — a prospect resurfacing in a closed-lost channel is a re-engagement signal.",
      },
      {
        heading: "Your side of Slack, wired too",
        body: "Deal alerts, pre-call briefs, and proposed task executions arrive in your own channel — ask Mikey about any deal by name, right where you saw the alert.",
      },
    ],
    faqs: [
      {
        q: "Do prospects see Mikey in the channel?",
        a: "No bot joins your prospect channels. Mikey reads via your Slack identity's permissions, and anything sent is sent as you, after you approve the draft.",
      },
      {
        q: "What about Slack Connect channels?",
        a: "Fully supported — Connect channels are usually where the highest-intent deals live, and they attach like any other channel you're a member of.",
      },
    ],
    relatedFeatures: ["slack-sales-assistant", "deal-pipeline-autopilot"],
    relatedSolutions: ["founder-crm-alternative", "win-more-deals"],
    ctaLine: "Attach your first prospect channel — watch it become pipeline signal.",
  },
  {
    slug: "first-sales-hire",
    seoTitle: "Preparing for Your First Sales Hire — Readiness + Handoff | Mikey",
    seoDescription:
      "Don't hire a salesperson to discover your sales motion — hand them one. Playbook, proven pipeline history, hiring profiles, and readiness scoring.",
    h1: "Get Ready for Your First Sales Hire",
    subhead: "The first AE inherits whatever you built. Make it a playbook, not an oral tradition.",
    intro:
      "The most expensive way to write your sales playbook is to hire a salesperson and let them fail toward it. The founder-led period is where the motion gets proven — and Mikey makes sure it's captured: the narrative and discovery questions that work, the pipeline history that shows what a real deal looks like, the hiring profile for the role, and a readiness score that tells you when it's actually time.",
    sections: [
      {
        heading: "A playbook they can run on day one",
        body: "Your narrative, ICP, discovery questions, objection library, decks, and sequences — versioned, coherent, and proven on your own closed-won deals.",
      },
      {
        heading: "Know when you're ready to hire",
        body: "Sales readiness scoring reads your coaching progress, assessment, and pipeline evidence — repeatable wins, cycle patterns, stakeholder shapes — and tells you what's still founder-magic versus process.",
      },
      {
        heading: "Hire the right profile",
        body: "Generated hiring profiles and pre-hire assessments matched to your motion and stage — because a founder-led PLG motion and an enterprise motion need different first hires.",
      },
      {
        heading: "Handoff with receipts",
        body: "Every deal carries full history — calls, threads, analysis — so ramping a new rep means reading real deals, not deciphering your memory.",
      },
    ],
    faqs: [
      {
        q: "When is a founder actually ready to hire sales?",
        a: "The honest signal is repeatability: you can name your ICP, your discovery works in others' mouths, and your pipeline shows wins that didn't require founder heroics. Mikey's readiness scoring measures exactly that.",
      },
      {
        q: "Does Mikey help after the hire too?",
        a: "Yes — the playbook, practice drills, and deal intelligence work for the new rep, and the founder keeps the coaching and pipeline oversight.",
      },
    ],
    relatedFeatures: ["sales-playbook", "sales-coaching", "customer-proof", "deal-pipeline-autopilot"],
    relatedSolutions: ["founder-led-sales-playbook", "technical-founder-sales"],
    ctaLine: "Check your sales readiness score — see what a new hire would inherit today.",
  },
];

export function getSolutionPage(slug: string): MarketingPage | undefined {
  return SOLUTION_PAGES.find((p) => p.slug === slug);
}
