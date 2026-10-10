/**
 * Hashtag command handling for Mikey Slack bot.
 * Commands are triggered by #hashtag patterns in messages.
 */

/**
 * The #instructions response message (Slack mrkdwn format)
 */
export const INSTRUCTIONS_MESSAGE = `👋🌊 *Hey there! I'm Mikey — your AI-powered Founder-Led Sales platform!* 🌊👋

So glad you're here! Let me give you the full rundown on how to get the most out of me. 🚀

━━━━━━━━━━━━━━━━━━━━━━

🧠 *What Am I Trained On?*

I'm trained on *Pete Kazanjy's entire body of work* on founder-led sales — 📘 *Founding Sales* (the book), 🎙️ podcasts & interviews, ✍️ essays, 🎓 the complete class curriculum, and 📋 templates + real-world examples. 1000s of pages of battle-tested B2B sales methodology and 15+ years of expertise. 🤯

And beyond the methodology, I know *YOUR* business: your sales narrative, ICP, discovery questions, live pipeline, coaching history, and collateral all feed my answers automatically.

━━━━━━━━━━━━━━━━━━━━━━

💬 *How to Talk to Me in Slack*

Just \`@Mikey\` me in any channel I've been added to, or *DM me directly*:

> \`@Mikey how do I handle pricing objections?\`
> \`@Mikey what's the latest on the Acme deal?\`
> \`@Mikey where did we leave off in coaching?\`

I route smartly: *mention a deal by name* and I answer with live pipeline data (timeline, participants, health, next meetings). Ask about *coaching* and I pull your real session history, goals, and tasks. Ask about *your business* and I load your full account context. 🧠

🧵 I always respond in a thread — \`@Mikey\` me again in the reply to keep going (I remember the conversation). And I read *images, PDFs, Word docs, and CSVs* you share — screenshots of email threads, proposals, CRM exports, all fair game. 📎

━━━━━━━━━━━━━━━━━━━━━━

🤖 *I Work Your Pipeline Automatically*

This is the big one — I don't just answer questions, I keep your deals moving:

📅 *Calendar watch* — every few minutes I scan your calendar; new meetings with prospects attach to the right deals automatically, and when I spot what looks like a *brand-new deal* forming, I create it and announce it here (with a "Not a deal" button if I got it wrong).
🎙️ *Call recorders* — connect Fathom, Granola, Fireflies, or Circleback and your recorded calls attach to deals on their own, transcripts and all.
🧠 *Auto-analysis* — deals re-analyze when new evidence lands: Mikey Health, risks, discovery gaps, and next steps stay current without you asking.

━━━━━━━━━━━━━━━━━━━━━━

🔥 *Common Use Cases*

📧 *Email Help* — "How should I reply to this prospect who went cold?" Forward screenshots and I'll craft the response.
🤝 *Deal Strategy* — "What's my next best move on Acme?" "Prep me for tomorrow's call." "Summarize the last call." All answered from the deal's real history.
🗓️ *Pre-Call Research* — \`#research Acme Corp, Jane Doe CTO, acme.com\` gets you a full research brief.
✍️ *Content Drafting* — Outbound sequences, LinkedIn messages, follow-ups, proposals.
❓ *Burning Questions* — "How do I build pipeline from scratch?" "When do I hire my first rep?"
📊 *Call Reviews* — Upload a transcript, get a scorecard with specific coaching.
📈 *Sales Metrics* — Paste pipeline numbers or a CSV for benchmarked analysis.
📝 *Log Activity* — "Just talked to their CFO, she wants a security review" — I'll add it to the deal timeline.

━━━━━━━━━━━━━━━━━━━━━━

🚀 *Built-In Apps & Tools*

Each with its own page on the web app:

*📋 Playbook (Your Foundation)*
📏 *GTM Maturity Assessment* · 💎 *Sales Narrative* · 🎯 *Ideal Customer Profile* · 🔍 *Discovery Questions* · ✅ *First Call Checklist* · 🔄 *Sales Motion* · 📚 *Sales Asset Library* (your collateral — I can search and use it in answers!)

*💼 Deals & Pipeline*
Full pipeline tracking with *Mikey Health* scoring, deal timelines, one-click *Analyze / Prep / Next Best Action / Discovery Gaps*, auto-attached calls + meetings, and *Deal Chat* grounded in everything the deal knows.

*📞 Call Execution*
🔬 *Pre-Call Research* (\`#research\`) · ✉️ *Call Recap Email* · 📞 *Call Coaching* (transcript scorecards) · 🎯 *Cold Call Scripts* · 🛡️ *Objection Library* · 📈 *Business Cases* — turn deal evidence into a *Discovery Summary* document (ROI models + full business cases coming), even export it as a slide deck!

*🥊 Practice (The Rep Gym)*
Drill against AI buyers built from YOUR playbook — *Pre-Call Planning*, *Rapport*, *Agenda Setting* (against the clock!), *Discovery* roleplay (the buyer talks back), and the *Full Call* capstone. Every rep graded with a report card. Plus *Live-Fire mode*: rehearse a REAL upcoming call against a simulation of the actual attendee. 🎯

*📈 Coaching & Metrics*
🎓 *Coaching History* — sessions auto-synthesize into takeaways, suggested goals/tasks get extracted for your review, and a *GTM Strategy Review* pressure-tests your whole approach against your history. 📊 *Sales Metrics* — benchmarked performance analysis.

*✏️ Content*
📧 *Email Sequences* · 💼 *LinkedIn Outbound* · 📱 *Social Posts* · 📣 *Ads* · 📊 *Sales Decks*

*👥 Hiring*
👤 *AE Profile* · 👔 *Sales Leader Profile* · 📋 *Pre-Hire Assessment* · 💰 Comp plan design & onboarding guidance

━━━━━━━━━━━━━━━━━━━━━━

🌐 *Mikey on the Web*

The full web app is where the applets live 🖥️ — rich chat with voice input and file uploads, shareable links for anything, and all your deals, practice reps, coaching history, and artifacts in one place.

━━━━━━━━━━━━━━━━━━━━━━

💡 *Pro Tips*

• 🌊 Mention deals *by name* — "what's new on Acme?" beats copy-pasting context
• 🌊 Connect your *calendar and call recorder* — that's what turns me from a chatbot into a pipeline copilot
• 🌊 Send me a practice drill link and tell a teammate "go do this" — every drill has its own URL
• 🌊 Type \`#research\` or \`#precall\` + whatever you know for a pre-call brief
• 🌊 Upload a call transcript for a scorecard, or paste CRM numbers for a metrics breakdown
• 🌊 Type \`#instructions\` anytime to see this message again!

━━━━━━━━━━━━━━━━━━━━━━

Here's to some founder-led selling success! 🏄‍♂️🌊🚀

_Powered by Claude • Trained on Pete Kazanjy's founder-led sales expertise_`;

/**
 * Channel-welcome variant: shorter parent message + the rest split
 * into threaded replies. Used by handleBotChannelJoin so a brand-new
 * channel doesn't get flooded with a 100+ line wall of text in the
 * main channel timeline — interested folks click into the thread.
 *
 * The slash command `#instructions` still uses the full single-message
 * INSTRUCTIONS_MESSAGE above since that's a user-initiated reply.
 */
export const CHANNEL_WELCOME_INTRO = `👋🌊 *Hey there! I'm Mikey — your AI-powered Founder-Led Sales platform!* 🌊👋

Just \`@Mikey\` me in this channel — mention a *deal by name* and I'll answer from its live history, ask *coaching* questions against your real sessions, or ask me anything founder-led sales. I also work your pipeline automatically: calendar meetings attach to deals, recorded calls flow in, new deals get detected and announced right here. Share screenshots, PDFs, Word docs, and CSVs and I'll work with them.

🧵 *Full rundown in the thread below* — the agents, the autopilot, every built-in applet (Deals, Practice, Business Cases, Coaching…), and pro tips. Type \`#instructions\` anytime to see this again.`;

export const CHANNEL_WELCOME_REPLIES: string[] = [
  // Reply 1: Training + how to talk to me (smart routing, threading, files)
  `*🧠 What Am I Trained On?*

*Pete Kazanjy's entire body of work* on founder-led sales — 📘 *Founding Sales* (the book), 🎙️ podcasts & interviews, ✍️ essays, 🎓 the complete class curriculum, 📋 templates + real-world examples. 1000s of pages of battle-tested B2B methodology + 15+ years of expertise.

And beyond the methodology, I know *YOUR* business: your sales narrative, ICP, discovery questions, live pipeline, coaching history, and collateral all feed my answers automatically.

━━━━━━━━━━━━━━━━━━━━━━

*💬 How to Talk to Me*

\`@Mikey\` me here, or DM me directly. I route smartly:
> \`@Mikey what's the latest on the Acme deal?\` → answered from the deal's LIVE history (timeline, participants, health, next meetings)
> \`@Mikey where did we leave off in coaching?\` → your real sessions, goals, and tasks
> \`@Mikey how do I handle pricing objections?\` → the methodology + your context

🧵 I always respond in a thread — \`@Mikey\` me again in the reply to keep going (I remember the conversation).

📎 I read *images, PDFs, Word docs, and CSVs* — screenshots of email threads, proposals, CRM exports, all fair game.`,

  // Reply 2: The autopilot + common use cases
  `*🤖 I Work Your Pipeline Automatically*

📅 *Calendar watch* — every few minutes I scan your calendar; prospect meetings attach to the right deals, and when I spot a *brand-new deal* forming I create it and announce it here (with a "Not a deal" button if I got it wrong).
🎙️ *Call recorders* — connect Fathom, Granola, Fireflies, or Circleback and recorded calls attach to deals on their own, transcripts and all.
🧠 *Auto-analysis* — deals re-analyze when new evidence lands: Mikey Health, risks, discovery gaps, and next steps stay current.

━━━━━━━━━━━━━━━━━━━━━━

*🔥 Common Use Cases*

📧 *Email Help* — "How should I reply to this prospect who went cold?"
🤝 *Deal Strategy* — "What's my next move on Acme?" "Prep me for tomorrow's call." "Summarize the last call."
🗓️ *Pre-Call Research* — \`#research Acme Corp, Jane Doe CTO, acme.com\` → full research brief
✍️ *Content Drafting* — sequences, LinkedIn messages, follow-ups, proposals
📊 *Call Reviews* — upload a transcript, get a coaching scorecard
📈 *Sales Metrics* — paste numbers or a CSV for benchmarked analysis
📝 *Log Activity* — "Just talked to their CFO, she wants a security review" → onto the deal timeline`,

  // Reply 3: Built-in applets (organized like the web nav)
  `*🚀 Built-In Apps & Tools* (each with its own page on the web app)

*📋 Playbook* — 📏 GTM Maturity Assessment · 💎 Sales Narrative · 🎯 Ideal Customer Profile · 🔍 Discovery Questions · ✅ First Call Checklist · 🔄 Sales Motion · 📚 Sales Asset Library (your collateral — I can search + use it in answers)

*💼 Deals & Pipeline* — full pipeline tracking with *Mikey Health* scoring, deal timelines, one-click Analyze / Prep / Next Best Action / Discovery Gaps, auto-attached calls + meetings, and *Deal Chat* grounded in everything the deal knows

*📞 Call Execution* — 🔬 Pre-Call Research (\`#research\`) · ✉️ Call Recap Email · 📞 Call Coaching · 🎯 Cold Call Scripts · 🛡️ Objection Library · 📈 *Business Cases* — turn deal evidence into a Discovery Summary document (exportable as a slide deck!)

*🥊 Practice — the rep gym* — drill against AI buyers built from YOUR playbook: Pre-Call Planning, Rapport, Agenda Setting (against the clock), Discovery roleplay (the buyer talks back!), and the Full Call capstone — every rep graded with a report card. *Live-Fire mode* rehearses a REAL upcoming call against a simulation of the actual attendee. 🎯

*📈 Coaching & Metrics* — 🎓 Coaching History with auto-synthesized takeaways, extracted goals/tasks for your review, and a *GTM Strategy Review* that pressure-tests your whole approach · 📊 Sales Metrics analysis

*✏️ Content* — 📧 Email Sequences · 💼 LinkedIn Outbound · 📱 Social Posts · 📣 Ads · 📊 Sales Decks

*👥 Hiring* — AE Profile · Sales Leader Profile · Pre-Hire Assessment · comp plans + onboarding`,

  // Reply 4: Web + pro tips + closing
  `*🌐 Mikey on the Web*

The full web app is where the applets live 🖥️ — rich chat with voice input and file uploads, shareable links for anything, and all your deals, practice reps, coaching history, and artifacts in one place.

━━━━━━━━━━━━━━━━━━━━━━

*💡 Pro Tips*
• 🌊 Mention deals *by name* — "what's new on Acme?" beats copy-pasting context
• 🌊 Connect your *calendar and call recorder* — that's what turns me from a chatbot into a pipeline copilot
• 🌊 Send a teammate a practice drill link and say "go do this" — every drill has its own URL
• 🌊 Type \`#research\` or \`#precall\` + whatever you know for a pre-call brief
• 🌊 Upload a call transcript for a scorecard, or paste CRM numbers for a metrics breakdown
• 🌊 Type \`#instructions\` anytime to see this again

Here's to some founder-led selling success! 🏄‍♂️🌊🚀

_Powered by Claude • Trained on Pete Kazanjy's founder-led sales expertise_`,
];

/**
 * The #precall #instructions response message (Slack mrkdwn format)
 */
export const PRECALL_INSTRUCTIONS_MESSAGE = `🔍🌊 *Pre-Call Research with Mikey — How It Works!* 🌊🔍

Need to prep for an upcoming sales call? I've got you covered! Here's how to use my *Pre-Call Research* feature to walk into every meeting fully prepared. 🚀

━━━━━━━━━━━━━━━━━━━━━━

✅ *Before You Start — Set Up Your Playbook*

Pre-call research works best when I know about *your* product and sales motion. Before running your first brief, make sure you've completed these three items:

• *Sales Narrative* — Your value prop and positioning → askmikey.ai/sales-narrative
• *Discovery Questions* — Your key discovery questions → askmikey.ai/discovery-questions
• *First Call Checklist* — Your buyer personas and call framework → askmikey.ai/first-call-checklist

These let me match prospects to your personas, form a point of view on what they'll care about, and recommend specific call focus areas. Without them, I won't be able to run a research brief.

━━━━━━━━━━━━━━━━━━━━━━

📝 *How to Start a Research Brief*

Just type \`#research\` or \`#precall\` followed by whatever you know about the person or company you're meeting with. I'm flexible — give me as much or as little as you have!

*Examples:*
> \`#precall Acme Corp\`
> \`#research Acme Corp, Jane Doe CTO\`
> \`#precall Acme Corp, Jane Doe, linkedin.com/in/janedoe, acme.com\`

You can also use \`#callprep\` — they all work the same way!

━━━━━━━━━━━━━━━━━━━━━━

🤖 *What Happens Next*

1️⃣ I'll parse whatever you gave me — company name, contact name, title, LinkedIn URL, website — and show you what I found
2️⃣ If I'm missing key details, I'll ask you to fill in the gaps
3️⃣ Once I have what I need, I'll generate a *comprehensive research brief* including:

• 🏢 *Company Overview* — what they do, size, funding, recent news
• 👤 *Contact Profile* — background, role, likely priorities
• 🎯 *Persona Matching* — what type of buyer they are and what they care about
• 💡 *Point of View* — a tailored perspective on how your solution maps to their world
• 📞 *Recommended Call Focus Areas* — specific topics and discovery questions for your meeting

━━━━━━━━━━━━━━━━━━━━━━

💡 *Pro Tips*

• 🌊 The more info you provide upfront, the faster we get to your brief — but even just a company name works!
• 🌊 Include a *LinkedIn URL* if you have one — it dramatically improves the contact research
• 🌊 I'll reply in a thread so you can easily find your brief later
• 🌊 Every brief is saved — visit *askmikey.ai* to view your full research history and share briefs with your team

━━━━━━━━━━━━━━━━━━━━━━

🌐 *Pre-Call Research on the Web*

You can also run pre-call research at *askmikey.ai/pre-call-planning/research* for a richer experience with full formatting and easy sharing! 🖥️

━━━━━━━━━━━━━━━━━━━━━━

Ready to prep? Just type \`#precall\` followed by your prospect's details and let's get started! 🏄‍♂️🌊`;

/**
 * Check if a message is a hashtag command and return the response if so.
 * Returns the response string if a command matched, or null if no command found.
 */
export function handleCommand(text: string): string | null {
  const cleaned = text.trim().toLowerCase();

  // Match #precall #instructions (must check before generic #instructions)
  if (
    (cleaned.includes("#precall") || cleaned.includes("#research") || cleaned.includes("#callprep")) &&
    cleaned.includes("#instructions")
  ) {
    return PRECALL_INSTRUCTIONS_MESSAGE;
  }

  // Match #instructions anywhere in the message
  if (cleaned.includes("#instructions")) {
    return INSTRUCTIONS_MESSAGE;
  }

  // #research is handled separately in events.ts (async)
  // Don't match it here since it needs special async handling

  return null;
}

/**
 * Parse a #research command to extract company and contact info.
 * Returns null if the message doesn't contain a #research command.
 *
 * Supported formats:
 * - #research Acme Corp
 * - #research Acme Corp, Jane Doe
 * - #research Acme Corp, Jane Doe CTO
 * - #precall Acme Corp
 * - #callprep Acme Corp
 */
export function parseResearchCommand(text: string): { companyName: string; contactInfo?: string } | null {
  const cleaned = text.trim();
  const match = cleaned.match(/#(?:research|precall|callprep)\s+(.+)/i);

  if (!match) return null;

  const args = match[1].trim();
  if (!args) return null;

  // Split on comma to separate company from contact
  const parts = args.split(",").map((p) => p.trim());

  return {
    companyName: parts[0],
    contactInfo: parts.length > 1 ? parts.slice(1).join(", ") : undefined,
  };
}
