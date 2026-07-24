import type { MarketingPage } from "./types";

/**
 * Product FEATURE pages — one per major capability. Product-centric:
 * what it is, how it works, what you get. Target searches for the
 * tool ("AI sales pipeline", "sales roleplay practice").
 */
export const FEATURE_PAGES: MarketingPage[] = [
  {
    slug: "deal-pipeline-autopilot",
    emoji: "🤝",
    seoTitle: "AI Sales Pipeline for Founders — Deal Autopilot | Mikey",
    seoDescription:
      "Mikey builds and runs your pipeline for you: deals auto-created from your calendar and call recorder, AI deal analysis after every call, and Slack alerts when a deal needs you.",
    h1: "Deal Pipeline Autopilot",
    subhead: "A pipeline that builds and maintains itself — from your calendar, your call recorder, and your Slack.",
    intro:
      "Founders don't update CRMs. Mikey doesn't ask you to. It watches the places your selling already happens — calendar invites, recorded calls, shared Slack channels — and turns them into a living pipeline: deals auto-detected, evidence auto-attached, analysis auto-refreshed, and a Slack ping when something actually needs your hand.",
    sections: [
      {
        heading: "Deals create themselves",
        body: "New prospect meeting on your calendar? A call recording that doesn't match an existing deal? Mikey triages it, creates the deal, and posts a stub to your Slack so you can confirm or archive with one tap. Customer calls on closed-won accounts stay off the pipeline.",
      },
      {
        heading: "Every call updates the deal",
        body: "When a recording lands, Mikey attaches it to the right deal, re-runs the full deal analysis over every transcript in the history, and posts the updated read to Slack — health, momentum, and the next best action.",
        bullets: [
          "Full-transcript analysis — no summaries-of-summaries",
          "Deal health (🟢/🟡/🔴) with the evidence behind it",
          "Next best action with the actual message to send",
        ],
      },
      {
        heading: "Follow-ups become one-tap tasks",
        body: "Mikey reads the evidence for commitments — yours and theirs — and turns them into scheduled tasks with the follow-up message pre-drafted in your voice. When one comes due, the Slack ping carries the message and a one-touch send.",
      },
      {
        heading: "It tells you when a deal is drifting",
        body: "The Execution Review sweeps for overdue commitments and deals gone quiet, then proposes the move: send this message (drafted, editable), mark it closed-lost, or keep waiting — with the reasoning shown.",
      },
    ],
    steps: [
      "Connect Google Calendar, your call recorder (Fathom, Fireflies, Granola…), and Slack",
      "Mikey detects deals from meetings and recordings, and asks you to confirm",
      "Every new call, email, or Slack thread updates the deal analysis automatically",
      "You act from Slack: confirm deals, send drafted follow-ups, review what's drifting",
    ],
    faqs: [
      {
        q: "Do I have to enter deals manually?",
        a: "No. Deals are auto-detected from calendar invites and call recordings. You can also create one manually or drag evidence (a screenshot, an email) onto the pipeline, but the default motion is confirmation, not data entry.",
      },
      {
        q: "Does this replace my CRM?",
        a: "For a founder running early deals, yes — pipeline stages, deal history, contacts, tasks, and analysis live in Mikey. When you eventually adopt a CRM for a sales team, Mikey remains the intelligence layer on top of your calls and Slack.",
      },
      {
        q: "What does the deal analysis actually read?",
        a: "Everything on the deal's timeline: full call transcripts, emails, Slack messages from linked channels, meeting invites, and notes — plus your sales narrative, so the analysis is grounded in what you're actually selling.",
      },
    ],
    relatedFeatures: ["slack-sales-assistant", "pre-call-planning", "call-review"],
    relatedSolutions: ["founder-crm-alternative", "win-more-deals", "technical-founder-sales"],
    ctaLine: "Connect your calendar and recorder — your pipeline builds itself this week.",
  },
  {
    slug: "sales-coaching",
    emoji: "🎓",
    seoTitle: "AI Sales Coach for Founders | Mikey",
    seoDescription:
      "Weekly sales coaching built on Founding Sales: sessions with an AI coach that knows your deals, goals and tasks with priorities, and takeaway docs that write themselves.",
    h1: "AI Sales Coaching",
    subhead: "A standing coaching relationship — sessions, goals, priorities, and follow-through — powered by Pete Kazanjy's Founding Sales.",
    intro:
      "Most founders learn to sell by flailing. Mikey gives you the thing early-stage founders can't usually get: a coach who has read every one of your calls, remembers what you committed to last week, and runs a real cadence — session, takeaways, goals with priorities, and a check on what actually got done.",
    sections: [
      {
        heading: "Coaching sessions that know your business",
        body: "Every session starts with full context: your pipeline, your goals and open tasks, your GTM maturity stage, and what you discussed last time. No re-explaining your company to a chatbot.",
      },
      {
        heading: "Takeaways that write themselves",
        body: "When a session ends, Mikey synthesizes it into a scannable doc — what you discussed, the agreements and priorities until next session (ranked, bundled by initiative), and what's queued after. Decisions and commitments are extracted into tracked goals and tasks with verbatim-quote receipts.",
      },
      {
        heading: "Priorities, not just lists",
        body: "Goals and tasks carry P0/P1/P2 priorities that the coaching conversation itself maintains — new commitments get ranked, stale ones get deprioritized, and the next session opens with where you actually left off.",
      },
      {
        heading: "Grounded in a real methodology",
        body: "The coaching isn't generic sales advice. It's built on Founding Sales — Pete Kazanjy's playbook for founder-led selling — and tied to a GTM maturity model, so the advice matches your stage instead of assuming you have an SDR team.",
      },
    ],
    faqs: [
      {
        q: "How is this different from asking ChatGPT for sales advice?",
        a: "Context and continuity. Mikey's coach reads your actual deals, calls, goals, and history — and maintains state between sessions. The advice is specific (\"ask Parijat for a dated decision step\") rather than generic.",
      },
      {
        q: "What happens between sessions?",
        a: "Your goals and tasks stay live. Deal evidence retires tasks implicitly when the work visibly happened, and the next session opens against the same priority stack you left.",
      },
      {
        q: "Is this based on a real sales methodology?",
        a: "Yes — Founding Sales by Pete Kazanjy, the standard text on founder-led selling, plus a GTM maturity model that keeps recommendations stage-appropriate.",
      },
    ],
    relatedFeatures: ["practice-roleplay", "sales-playbook", "call-review"],
    relatedSolutions: ["learn-to-sell", "technical-founder-sales", "first-sales-hire"],
    ctaLine: "Take the GTM assessment and get your first coaching session today.",
  },
  {
    slug: "sales-playbook",
    emoji: "📖",
    seoTitle: "AI Sales Playbook Generator — Narrative, ICP, Discovery | Mikey",
    seoDescription:
      "Generate your complete founder sales playbook: sales narrative, ICP, discovery questions, objection handling, cold call scripts, and sales decks — each built from the last.",
    h1: "Sales Playbook Builder",
    subhead: "Narrative → ICP → discovery questions → deck → outreach. Each artifact generates from the last, so your whole playbook stays coherent.",
    intro:
      "The hard part of early sales isn't effort — it's that the narrative in your head never becomes reusable material. Mikey turns it into a complete, linked playbook: a sales narrative in the Founding Sales two-part structure, an ICP derived from it, discovery questions derived from that, and decks, scripts, and sequences derived from all of it.",
    sections: [
      {
        heading: "Start with the narrative",
        body: "Mikey interviews you about your company and produces a real sales narrative — the world-change story and your solution's place in it — that every other artifact inherits. Change the narrative, and downstream artifacts regenerate to match.",
      },
      {
        heading: "The full artifact chain",
        body: "One coherent voice across everything a founder needs to sell with:",
        bullets: [
          "Sales narrative and 100-word value prop",
          "ICP definition and sales motion analysis",
          "Discovery questions and first-call checklist",
          "Sales deck outlines and business cases",
          "Objection library and cold-call scripts",
          "Hiring profiles for your first sales roles",
        ],
      },
      {
        heading: "Living documents, not one-shot generations",
        body: "Artifacts are versioned. As your positioning sharpens on real calls, you regenerate downstream artifacts from the updated narrative instead of maintaining ten divergent docs.",
      },
    ],
    faqs: [
      {
        q: "What makes this better than prompting an LLM myself?",
        a: "The chain. Each artifact is generated from your actual narrative and the ones before it, using the Founding Sales structure — so your deck, your discovery questions, and your outreach all argue the same case instead of drifting apart.",
      },
      {
        q: "Can I edit the generated artifacts?",
        a: "Yes — everything is editable and versioned, and your edits carry into downstream generations.",
      },
      {
        q: "Where do the artifacts get used?",
        a: "Everywhere Mikey works: deal analysis reads your narrative, practice drills grade you against your discovery questions, pre-call plans cite your ICP, and outreach sequences write in your narrative's voice.",
      },
    ],
    relatedFeatures: ["outbound-content", "sales-coaching", "customer-proof"],
    relatedSolutions: ["founder-led-sales-playbook", "technical-founder-sales", "first-sales-hire"],
    ctaLine: "Answer a few questions — walk out with a complete, coherent playbook.",
  },
  {
    slug: "practice-roleplay",
    emoji: "🥊",
    seoTitle: "AI Sales Roleplay & Practice Drills for Founders | Mikey",
    seoDescription:
      "Practice discovery, rapport, agenda-setting, and full sales calls against AI buyer personas built from your real prospects — with grading and rep-over-rep improvement.",
    h1: "Sales Practice Drills",
    subhead: "Roleplay against AI buyers built from your real prospects — before the call that counts.",
    intro:
      "Nobody's first ten discovery calls are good. The question is whether you burn real prospects learning, or burn reps. Mikey runs practice drills — rapport, agenda-setting, discovery, and full calls — against buyer personas synthesized from your actual deals, then grades you against your own playbook.",
    sections: [
      {
        heading: "Drills for every part of the call",
        body: "Isolated reps on the skills that decide calls, plus a full-call capstone:",
        bullets: [
          "Rapport — the first two minutes, without being weird",
          "Agenda setting — taking control of the call politely",
          "Discovery — question depth, pain excavation, quantification",
          "Full call — everything at once, graded end to end",
        ],
      },
      {
        heading: "Personas from your real pipeline",
        body: "Practice against the CFO you're actually meeting Thursday. Live-Fire mode builds the persona from a real upcoming calendar event and its attendees, so the drill is rehearsal, not theater.",
      },
      {
        heading: "Graded against your playbook",
        body: "The report card scores you against your own discovery questions and narrative — not generic rubrics — and tracks streaks and improvement across attempts.",
      },
    ],
    faqs: [
      {
        q: "How realistic are the AI buyers?",
        a: "They're synthesized from your ICP and, in Live-Fire mode, from real attendee and company research. They interrupt, deflect, and go shallow unless you dig — because that's what real buyers do.",
      },
      {
        q: "When should I practice?",
        a: "Mikey's pre-call plans link the matching drill four hours before real meetings — enough runway to take a rep against the persona you're about to face.",
      },
    ],
    relatedFeatures: ["pre-call-planning", "sales-coaching", "call-review"],
    relatedSolutions: ["learn-to-sell", "technical-founder-sales"],
    ctaLine: "Run your first drill free — find out how your discovery actually scores.",
  },
  {
    slug: "pre-call-planning",
    emoji: "📋",
    seoTitle: "AI Pre-Call Research & Call Planning | Mikey",
    seoDescription:
      "Automatic pre-call briefs 4 hours before every prospect meeting: company research, deal history, objectives, and talking points — delivered to Slack.",
    h1: "Pre-Call Planning & Research",
    subhead: "A brief in your Slack four hours before every prospect call — objectives, history, landmines, and a practice link.",
    intro:
      "Walking into a call cold is a founder tax you stop paying. Mikey watches your calendar, and before every prospect meeting it assembles the brief: who you're meeting, what the deal history says, what you promised last time, what to push for this time — posted to Slack with the full prep threaded under it.",
    sections: [
      {
        heading: "Research that starts from your deal, not Google",
        body: "The brief is grounded in your actual relationship — every prior call transcript, email, and Slack thread on the deal — then layered with company and attendee research. It knows the difference between a first call and a fourth.",
      },
      {
        heading: "Objectives, not just facts",
        body: "Every brief proposes what this call needs to accomplish to advance the deal, the questions that get you there, and the objections likely to surface — mapped to your objection library.",
      },
      {
        heading: "Practice before it counts",
        body: "The brief links a Live-Fire practice drill built from the same meeting — same personas, same context — so you can rehearse the hard parts with runway to spare.",
      },
    ],
    steps: [
      "Connect Google Calendar and Slack",
      "Mikey detects prospect meetings and matches them to deals",
      "Four hours out: brief stub in Slack, full prep threaded under it",
      "Optional: take the linked practice drill before you dial in",
    ],
    faqs: [
      {
        q: "What if the meeting isn't attached to a deal yet?",
        a: "Mikey's triage detects likely deals from calendar invites and creates them (with your one-tap confirmation), so the brief machinery covers new opportunities too.",
      },
      {
        q: "Can I generate a brief on demand?",
        a: "Yes — every deal page has pre-call planning built in, and you can ask for a plan in chat or Slack at any time.",
      },
    ],
    relatedFeatures: ["practice-roleplay", "deal-pipeline-autopilot", "call-review"],
    relatedSolutions: ["win-more-deals", "technical-founder-sales"],
    ctaLine: "Never take another prospect call cold.",
  },
  {
    slug: "call-review",
    emoji: "📞",
    seoTitle: "AI Sales Call Review & Recap Emails | Mikey",
    seoDescription:
      "AI call coaching on your real recordings — scorecards on discovery quality and next-step discipline — plus recap emails drafted from the transcript.",
    h1: "Call Review & Recap",
    subhead: "Every recorded call becomes coaching — a scorecard on how you sold, and the recap email already drafted.",
    intro:
      "Your calls are the richest coaching data you own, and most founders never look at them twice. Mikey reviews recordings against a real rubric — discovery depth, talk ratio, next-step discipline — and turns the same transcript into the recap email you owe the prospect.",
    sections: [
      {
        heading: "A scorecard, not a summary",
        body: "The review grades the call the way a sales coach would: did you excavate pain or accept surface answers, did you quantify, did you leave with a dated next step — with timestamped receipts from the transcript.",
      },
      {
        heading: "Recap emails in minutes, not evenings",
        body: "From the same transcript, Mikey drafts the follow-up: what was discussed, what was agreed, next steps with owners — in your voice, ready to edit and send.",
      },
      {
        heading: "Feeds the rest of the system",
        body: "Reviewed calls flow into deal analysis, task detection reads the commitments you made on them, and coaching sessions cite them. One recording, four uses.",
      },
    ],
    faqs: [
      {
        q: "Which call recorders does Mikey work with?",
        a: "Fathom, Fireflies, Granola and more — connect once and recordings flow in automatically. You can also paste any transcript.",
      },
      {
        q: "Does the recap require a recording?",
        a: "No — paste notes or a partial transcript and Mikey drafts a best-effort recap from what you have.",
      },
    ],
    relatedFeatures: ["deal-pipeline-autopilot", "sales-coaching", "practice-roleplay"],
    relatedSolutions: ["learn-to-sell", "win-more-deals"],
    ctaLine: "Connect your recorder — your next call comes with a coach.",
  },
  {
    slug: "slack-sales-assistant",
    emoji: "💬",
    seoTitle: "Slack-Native AI Sales Assistant — Sell in Slack | Mikey",
    seoDescription:
      "Run founder-led sales where you already live: deal alerts, pre-call briefs, drafted follow-ups sent as you, and shared prospect channels synced to your pipeline.",
    h1: "Sell in Slack",
    subhead: "Your pipeline's nervous system runs through Slack — alerts in, evidence out, follow-ups sent as you.",
    intro:
      "Founder selling increasingly happens in shared Slack channels with prospects. Mikey is Slack-native in both directions: it posts the moments that matter (new deal detected, analysis updated, pre-call brief, follow-up due) to your channel, and it reads your shared prospect channels as deal evidence — without inviting a bot into every one.",
    sections: [
      {
        heading: "Shared channels become deal evidence",
        body: "Attach the shared channel to its deal and Mikey syncs the conversation onto the timeline — reading as you, so it sees every channel you're in. Prospect messages become momentum signals the deal analysis actually uses.",
      },
      {
        heading: "Follow-ups sent as you",
        body: "When a scheduled follow-up comes due, the Slack ping carries the message pre-drafted in your saved voice and a one-touch send — into the prospect channel, as you, with proof logged on the deal.",
      },
      {
        heading: "Ask Mikey anything, in-channel",
        body: "@-mention Mikey about any deal — \"what's the latest on Flock?\", \"summarize the last call\" — and the right agent answers with real pipeline data. Configurable per-alert-type, silenceable in one tap.",
      },
    ],
    faqs: [
      {
        q: "Does the bot need to be invited to every prospect channel?",
        a: "No. Connect your Slack identity once and Mikey reads channels as you — any public, private, or Slack Connect channel you're a member of.",
      },
      {
        q: "Can Mikey send messages as me?",
        a: "Yes, with your explicit per-message approval: you always see the draft (in Slack or in the preview overlay) before anything sends under your name.",
      },
    ],
    relatedFeatures: ["deal-pipeline-autopilot", "pre-call-planning"],
    relatedSolutions: ["sell-in-slack", "founder-crm-alternative"],
    ctaLine: "Install Mikey to Slack — your pipeline starts reporting to you.",
  },
  {
    slug: "outbound-content",
    emoji: "📣",
    seoTitle: "AI Outbound Sequences & Sales Content for Founders | Mikey",
    seoDescription:
      "Email sequences, LinkedIn outreach, social posts, and ad copy generated from your sales narrative — one coherent voice across every channel.",
    h1: "Outbound & Content Engine",
    subhead: "Sequences, social, and ads that argue the same case as your deck — because they're generated from the same narrative.",
    intro:
      "Founder outbound usually fails one of two ways: it never ships, or it ships sounding like a template. Mikey generates your outreach from your own sales narrative — cold email sequences, LinkedIn touches, social content, ad copy — so everything a prospect reads from you tells one coherent story.",
    sections: [
      {
        heading: "Sequences built on your narrative",
        body: "Cold email and LinkedIn sequences generated from your value prop and ICP — pain-led, specific, and in your voice, with gold-standard examples you approve shaping future output.",
      },
      {
        heading: "Social content that compounds",
        body: "Founder-voice LinkedIn posts and threads generated from your narrative's topics — the long-game air cover for your outbound.",
      },
      {
        heading: "One voice, every artifact",
        body: "Because it all derives from the same playbook, your outbound, your deck, and your discovery calls reinforce each other instead of contradicting each other.",
      },
    ],
    faqs: [
      {
        q: "Will it sound like AI slop?",
        a: "The generations are grounded in your narrative, your customer language, and examples you mark as gold-standard — and everything is editable before it ships.",
      },
      {
        q: "Does Mikey send the emails?",
        a: "Mikey generates and versions the sequences; you run them through your sending tool of choice. Slack follow-ups on active deals, though, can send directly as you.",
      },
    ],
    relatedFeatures: ["sales-playbook", "customer-proof"],
    relatedSolutions: ["founder-led-sales-playbook", "technical-founder-sales"],
    ctaLine: "Generate your first sequence from your narrative today.",
  },
  {
    slug: "customer-proof",
    emoji: "🌟",
    seoTitle: "AI Testimonials, Case Studies & Success Stories | Mikey",
    seoDescription:
      "Turn customer calls into proof: extract quoted, metric-backed proof points and publish testimonials, success stories, and case studies — attributed or blind.",
    h1: "Quotes & Success Stories",
    subhead: "Customer proof is buried in your call transcripts. Mikey mines it once and publishes it everywhere.",
    intro:
      "\"We cut close time from 9 days to 3\" — said on a QBR call, never used again. Mikey extracts proof points from customer calls (verbatim quotes, metrics, before→after arcs across calls), aligns them with your sales narrative, and projects them into six mediums: testimonials, success stories, and case studies, each in attributed and blind variants.",
    sections: [
      {
        heading: "Proof points, not paraphrases",
        body: "Every extracted claim carries a verbatim customer quote, the speaker, the metric, and which pillar of your narrative it proves. Multi-call sources become before→after arcs.",
      },
      {
        heading: "Six mediums from one extraction",
        body: "Attributed and blind variants of testimonials, success stories, and long-form case studies — blind versions strip identity but always keep the numbers.",
      },
      {
        heading: "Formats for every channel",
        body: "Web copy, LinkedIn posts, tweet threads, slide outlines — generated from the same proof points, in your voice, ready to copy.",
      },
    ],
    faqs: [
      {
        q: "What if I don't have logo rights yet?",
        a: "That's what blind variants are for — \"a Series B fintech's collections team\" keeps the proof publishable while the logo approval catches up. Metrics are always retained.",
      },
      {
        q: "Where do the source calls come from?",
        a: "Paste transcripts, import from your call recorder, or pull calls off a deal — collections accrete over time as more customer calls land.",
      },
    ],
    relatedFeatures: ["sales-playbook", "outbound-content", "call-review"],
    relatedSolutions: ["founder-led-sales-playbook", "win-more-deals"],
    ctaLine: "Paste one customer call — walk out with a publishable case study.",
  },
];

export function getFeaturePage(slug: string): MarketingPage | undefined {
  return FEATURE_PAGES.find((p) => p.slug === slug);
}
