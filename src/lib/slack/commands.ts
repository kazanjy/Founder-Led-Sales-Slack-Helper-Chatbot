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

━━━━━━━━━━━━━━━━━━━━━━

🚀 *Built-In Apps & Workflows*

I come loaded with powerful guided workflows to help you build your GTM engine from scratch:

📏 *GTM Maturity Assessment* — Measure where you stand and what to focus on next
🎯 *ICP Refinement* — Tighten your ideal customer profile
💎 *Sales Narrative / Value Prop* — Craft a compelling, terse value proposition
🔍 *Discovery Questions* — Generate great discovery questions for your product
📞 *First Call Checklist* — Structure an effective first sales call
🎯 *Pre-Call Planning Process* — Build a repeatable preparation ritual for every call
🔍 *Pre-Call Research* — Research a specific prospect before your call (type \`#research Acme Corp\` or \`#research Acme Corp, Jane Doe CTO\`)
📧 *Outbound Messaging & Sequences* — Write outreach that actually gets replies
📚 *Sales Playbook Builder* — Put together your complete sales playbook
💰 *Comp Plan Design* — Design compensation for your first sales reps
👥 *Sales Hiring Process* — Get guidance on finding and hiring great reps
🚀 *Sales Rep Onboarding* — Build an effective onboarding plan
🧠 *Founder-Led Sales Quiz* — Test your knowledge with a 20-question quiz!
📖 *Tutoring Sessions* — Get a lesson on a topic and then get quizzed on it

Just ask me to start any of these and I'll walk you through it step by step! 🪜

━━━━━━━━━━━━━━━━━━━━━━

🌐 *Mikey on the Web*

Did you know I also have a *web app*? 🖥️ Head over to *askmikey.ai* to:

• 💬 Chat with me in a full web interface
• 🔗 *Share conversations* with your team via a link — great advice shouldn't stay siloed!
• 📦 Access a *custom prompt library* — save, edit, clone, and organize your favorite workflows
• ⚙️ *Personalize your context* — set your ICP, value prop, and sales motion so I tailor my advice to YOUR business

━━━━━━━━━━━━━━━━━━━━━━

💡 *Pro Tips*

• 🌊 The more context you give me, the better my advice! Tell me about your product, your ICP, and your situation
• 🌊 I'm great for roleplay — try "Can you pretend to be a skeptical CTO and let me practice my pitch?"
• 🌊 You can ask me to be more specific, shorter, longer, or to try a different angle — I don't mind! I'm here for you 🤗
• 🌊 Type \`#research Company Name\` to research a prospect before your call!
• 🌊 Type \`#instructions\` anytime to see this message again!

━━━━━━━━━━━━━━━━━━━━━━

Here's to some founder-led selling success! 🏄‍♂️🌊🚀

_Powered by Claude • Trained on Pete Kazanjy's founder-led sales expertise_`;

/**
 * Check if a message is a hashtag command and return the response if so.
 * Returns the response string if a command matched, or null if no command found.
 */
export function handleCommand(text: string): string | null {
  const cleaned = text.trim().toLowerCase();

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
