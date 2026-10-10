import { openai } from "@/lib/openai";

const ALLOWED_TYPES = new Set([
  "call_transcript",
  "call_summary",
  "email",
  "slack_message",
  "sms_message",
  "linkedin",
  "twitter_dm",
  "document",
  "note",
]);

export interface ClassifyEntryResult {
  /** Short concise title (<80 chars), null if content doesn't suggest one. */
  title: string | null;
  /**
   * When the interaction happened, if visible in the content.
   * "YYYY-MM-DDTHH:MM" (naive local time — no timezone) when a time
   * signal exists ("Monday, July 13, 2026 at 9:59 AM" is common in
   * recorder transcripts), "YYYY-MM-DD" when only a date is visible,
   * null otherwise.
   */
  date: string | null;
  /** Best-guess entry type. Always one of ALLOWED_TYPES. */
  suggestedType: string;
}

/**
 * Lightweight LLM pass over freshly-pasted timeline content that fills in
 * whichever fields the user left blank: title, date, type. Runs only when
 * the title is empty (clear "user didn't bother" signal) and content is
 * long enough to be worth a GPT call. Called from POST
 * /api/deals/[id]/entries before the row is created.
 *
 * Type detection is conservative — the user's selection wins unless they
 * left it on the catch-all "note", in which case we'll upgrade if the
 * content clearly looks like a call / email / Slack / SMS / LinkedIn.
 */
export async function classifyEntryContent(
  content: string,
  currentType: string,
): Promise<ClassifyEntryResult> {
  const fallback: ClassifyEntryResult = { title: null, date: null, suggestedType: currentType };
  if (!content) return fallback;

  const todayIso = new Date().toISOString().slice(0, 10);
  const systemPrompt = `You triage a piece of content that was just pasted into a B2B sales deal's timeline. The user did NOT title or date it. Your job: infer the title, the most likely date the interaction happened, and the entry type.

Today's date is ${todayIso}. Use the CURRENT year for any month-day-only reference unless the content explicitly says otherwise.

Return ONE line of JSON and nothing else:
{"title": "...", "date": "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD" or null, "suggestedType": "..."}

- title: a concise label under 80 chars summarizing WHAT this is (e.g. "Discovery call w/ Acme — pricing pushback", "Reply from Sarah re: contract redlines"). Skip generic preambles ("Note about..."). null if content is too generic to title meaningfully.
- date: when the interaction actually happened, if visible in the content (timestamps, "called on May 21", email date headers, recorder headers like "Date: Monday, July 13, 2026 at 9:59 AM"). INCLUDE THE TIME as YYYY-MM-DDTHH:MM (24-hour, no timezone) whenever a time is visible — "at 9:59 AM" → "T09:59", "2:30 PM" → "T14:30". Date-only YYYY-MM-DD when no time signal. null if no date signal exists — caller will default to today.
- suggestedType: one of:
  * "call_transcript" — speaker-attributed dialogue with timestamps or speaker labels ("Participant 1:", "[1:53:39] Speaker:", "John:")
  * "call_summary" — narrative summary of a call (no raw dialogue, but talks about who said what)
  * "email" — From/To/Subject header pattern, or a clear email body / reply chain
  * "slack_message" — Slack DM/channel content (mentions of channels, threads, @mentions, Slack reactions)
  * "sms_message" — phone-style text messaging (iMessage, SMS, WhatsApp): short bursts with timestamps, no email headers
  * "twitter_dm" — a Twitter/X direct message exchange: @handles, short bursts, often quoted tweets or links
  * "linkedin" — LinkedIn InMail, connection request, profile content, or LinkedIn message thread
  * "document" — contract / proposal / brief / formal document prose
  * "note" — fallback when content doesn't clearly fit any of the above (a user-typed observation)`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: content.substring(0, 12000) },
      ],
      max_completion_tokens: 200,
      temperature: 0.1,
    });
    const raw = response.choices[0]?.message?.content?.trim() || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as { title?: unknown; date?: unknown; suggestedType?: unknown };
    const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 100) : null;
    const date =
      typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(parsed.date)
        ? parsed.date
        : null;
    const rawType = typeof parsed.suggestedType === "string" ? parsed.suggestedType : currentType;
    const suggestedType = ALLOWED_TYPES.has(rawType) ? rawType : currentType;
    return { title, date, suggestedType };
  } catch (err) {
    console.error("classifyEntryContent failed:", err);
    return fallback;
  }
}
