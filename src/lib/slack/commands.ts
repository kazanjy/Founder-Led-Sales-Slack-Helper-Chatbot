/**
 * Hashtag command handling for Mikey Slack bot.
 * Commands are triggered by #hashtag patterns in messages.
 */

/**
 * The #instructions response message (Slack mrkdwn format)
 */
export const INSTRUCTIONS_MESSAGE = `👋🌊 *Hey there! I'm Mikey — your AI-powered Founder-Led Sales assistant!* 🌊👋

So glad you're here! Let me give you the full rundown on how to get the most out of me. 🚀

━━━━━━━━━━━━━━━━━━━━━━

🧠 *What Am I Trained On?*

I'm trained on *Pete Kazanjy's entire body of work* on founder-led sales — we're talking the whole enchilada 🌯:

📘 *Founding Sales* — the book that started it all
🎙️ Podcasts & interviews
✍️ Blog posts & essays
🎓 Complete class curriculum
📋 Templates, sales assets, and real-world examples
…and so much more! 1000s of pages of battle-tested B2B sales methodology and 15+ years of expertise, all at your fingertips. 🤯

━━━━━━━━━━━━━━━━━━━━━━

💬 *How to Talk to Me in Slack*

It's easy! Just \`@Mikey\` me in any channel I've been added to:

> \`@Mikey how do I handle pricing objections?\`

Or *DM me directly* for a private conversation — just click on my name and start typing! 🤫

━━━━━━━━━━━━━━━━━━━━━━

🧵 *How Threading Works*

I *always* respond in a thread to keep things tidy! Here's how it works:

• Your first \`@Mikey\` message kicks off a new thread 🆕
• To keep chatting in that thread, just \`@Mikey\` me again in the reply
• I look back at the *last 50 messages* in our thread for context, so I remember what we've been discussing 🧠💭
• No need to repeat yourself — I've got the receipts! 🧾

━━━━━━━━━━━━━━━━━━━━━━

📎 *I Can Read Images & PDFs!*

Got a screenshot of an email you need help replying to? A PDF of a prospect's website? Send it my way! 🖼️📄

I can analyze images and PDFs you share in our conversation and give you advice based on what I see. Super handy for reviewing real sales collateral! 👀✨

━━━━━━━━━━━━━━━━━━━━━━

🔥 *Common Use Cases*

Here are some of the things people love using me for:

📧 *Email Help* — "Hey Mikey, how should I reply to this prospect who went cold?" Forward me screenshots of email threads and I'll help you craft the perfect response!
✍️ *Content Drafting* — Outbound sequences, LinkedIn messages, follow-up emails, proposals — I'll draft it with you!
❓ *Burning Questions* — Whatever's keeping you up at night about sales, just ask! "How do I build a pipeline from scratch?" "When should I hire my first rep?" "How do I handle the 'we don't have budget' objection?"
🗓️ *Pre-Call Prep* — Tell me about your upcoming call and I'll help you prepare discovery questions, talking points, and a game plan!
🤝 *Deal Strategy* — Walk me through a deal and I'll help you figure out the best path forward, including spotting risks!
📊 *Call Reviews* — Upload a call transcript and I'll score the call across discovery, demo effectiveness, objection handling, and next steps — with specific coaching!
📈 *Sales Metrics* — Paste your pipeline numbers or upload a CSV and I'll benchmark your performance and spot what to fix!

━━━━━━━━━━━━━━━━━━━━━━

🚀 *Built-In Apps & Tools*

I come loaded with powerful tools — each with its own dedicated page at *askmikey.ai*:

*📋 Foundation (Build Your Playbook)*
📏 *GTM Maturity Assessment* — Measure where you stand across key sales dimensions and get prioritized recommendations
💎 *Sales Narrative* — Craft a compelling value prop and product story
🔍 *Discovery Questions* — Generate targeted discovery questions for your ICP
📞 *First Call Checklist* — Structure what to cover on every first call
🎯 *Pre-Call Planning* — Build a repeatable prep framework for every meeting

*🔬 Research & Prep*
🔍 *Pre-Call Research* — Research a prospect before your call! Type \`#research\` or \`#precall\` followed by whatever you know — company name, contact name, LinkedIn URL, website — and I'll generate a full research brief with persona matching and recommended call focus areas. Example: \`#research Acme Corp, Jane Doe CTO, acme.com\`

*⚡ Execution Tools*
📧 *Email Sequences* — Generate multi-step outbound email sequences with subject lines, body copy, and follow-up cadence
💬 *LinkedIn Sequences* — Create LinkedIn-optimized connection requests and follow-up messages
📞 *Cold Call Scripts* — Generate call scripts tailored to specific buyer personas
📊 *Sales Decks* — Generate structured sales presentation outlines, or enhance your existing deck

*📈 Analysis & Coaching*
🎯 *Call Review* — Upload a call transcript and get a detailed scorecard with scoring, red flags, and improvement areas
📊 *Sales Metrics Analysis* — Upload CRM data (CSV) or enter your numbers manually and get benchmarked performance analysis
🗒️ *Coaching History* — Log coaching sessions with notes and transcripts, then chat with me about your progress over time

*🎓 Learning & Practice*
🧠 *Founder-Led Sales Quiz* — Test your knowledge with a 20-question quiz!
📖 *Tutoring Sessions* — Get a lesson on a topic and then get quizzed on it
📚 *Sales Playbook Builder* — Put together your complete sales playbook
💰 *Comp Plan Design* — Design compensation for your first sales reps
👥 *Sales Hiring Process* — Get guidance on finding and hiring great reps
🚀 *Sales Rep Onboarding* — Build an effective onboarding plan

Just ask me to start any of these, or visit *askmikey.ai* to use the full web experience! 🪜

━━━━━━━━━━━━━━━━━━━━━━

🌐 *Mikey on the Web*

I also have a full *web app* at *askmikey.ai* with extra capabilities! 🖥️

• 💬 Chat with me with full rich formatting, voice input, and file uploads
• 🔗 *Share anything* — conversations, research briefs, call reviews, and more via a shareable link
• 📦 Access a *custom prompt library* — save, edit, clone, and organize your favorite workflows
• ⚙️ *Personalize your context* — set your ICP, value prop, and sales motion so I tailor everything to YOUR business
• 📁 *Files* — all your uploaded images, PDFs, and CSVs in one place

━━━━━━━━━━━━━━━━━━━━━━

💡 *Pro Tips*

• 🌊 The more context you give me, the better my advice! Tell me about your product, your ICP, and your situation
• 🌊 I'm great for roleplay — try "Can you pretend to be a skeptical CTO and let me practice my pitch?"
• 🌊 You can ask me to be more specific, shorter, longer, or to try a different angle — I don't mind! I'm here for you 🤗
• 🌊 Type \`#research\` or \`#precall\` followed by whatever you know about an upcoming call — I'll walk you through gathering the rest and generate a full pre-call brief!
• 🌊 Upload a call transcript to get a full scorecard, or paste in your CRM numbers for a sales metrics breakdown!
• 🌊 Type \`#instructions\` anytime to see this message again!

━━━━━━━━━━━━━━━━━━━━━━

Here's to some founder-led selling success! 🏄‍♂️🌊🚀

_Powered by Claude • Trained on Pete Kazanjy's founder-led sales expertise_`;

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
