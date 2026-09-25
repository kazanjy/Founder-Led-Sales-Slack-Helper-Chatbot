import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Truncate a string to max length at word boundary
 */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  // Find the last space before maxLength
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > 0) {
    return truncated.substring(0, lastSpace);
  }
  // If no space found, return the whole word (might exceed limit slightly)
  const nextSpace = text.indexOf(' ', maxLength);
  if (nextSpace > 0) {
    return text.substring(0, nextSpace);
  }
  return text;
}

/**
 * Generate a terse chat title from the first user message
 * @param firstMessage - The first user message in the conversation
 * @returns A short title (up to 40 characters, complete words only)
 */
export async function generateChatTitle(firstMessage: string): Promise<string> {
  console.log("[OpenAI] generateChatTitle called with message length:", firstMessage.length);
  console.log("[OpenAI] API key present:", !!process.env.OPENAI_API_KEY);
  console.log("[OpenAI] API key prefix:", process.env.OPENAI_API_KEY?.substring(0, 7) || "missing");

  try {
    console.log("[OpenAI] Calling chat.completions.create with model: gpt-5.5");
    const response = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        {
          role: "system",
          content:
            "You are a chat title generator. Given a user's message, create a short, descriptive title for the conversation. The title must be under 40 characters and use complete words only - never cut off a word. Do not use quotes. Be concise and capture the essence of the question or topic.",
        },
        {
          role: "user",
          content: `Generate a short title (under 40 chars, complete words only) for this message:\n\n${firstMessage.substring(0, 500)}`,
        },
      ],
      max_completion_tokens: 50,
    });

    console.log("[OpenAI] Response received:", JSON.stringify(response.choices[0]));
    const title = response.choices[0]?.message?.content?.trim() || null;
    console.log("[OpenAI] Extracted title:", title);

    // Ensure it's under 40 characters with complete words
    if (title && title.length > 40) {
      const truncated = truncateAtWordBoundary(title, 40);
      console.log("[OpenAI] Title truncated to:", truncated);
      return truncated;
    }

    return title || "New Conversation";
  } catch (error: unknown) {
    console.error("[OpenAI] Error generating chat title:", error);
    if (error instanceof Error) {
      console.error("[OpenAI] Error name:", error.name);
      console.error("[OpenAI] Error message:", error.message);
    }
    return "New Conversation";
  }
}

/**
 * Generate a one-sentence summary title for a GTM Maturity Assessment
 * @param aiRecommendations - The AI recommendations/analysis from the assessment
 * @returns A short title summarizing the GTM maturity state
 */
export async function generateAssessmentTitle(aiRecommendations: string): Promise<string> {
  console.log("[OpenAI] generateAssessmentTitle called with recommendations length:", aiRecommendations.length);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a GTM maturity summarizer. Given an AI analysis of a startup's GTM maturity assessment, create a one-sentence title (under 80 characters) that summarizes their current GTM state. Be specific and actionable. Examples: 'Early-stage with strong ICP, needs sales process', 'Scaling stage ready for first AE hire', 'Mature GTM but pricing strategy unclear'. Do not use quotes.",
        },
        {
          role: "user",
          content: `Generate a one-sentence summary title (under 80 chars) for this GTM assessment:\n\n${aiRecommendations.substring(0, 2000)}`,
        },
      ],
      max_completion_tokens: 100,
      temperature: 0.7,
    });

    const title = response.choices[0]?.message?.content?.trim() || null;
    console.log("[OpenAI] Generated assessment title:", title);

    // Ensure it's under 80 characters
    if (title && title.length > 80) {
      return title.substring(0, 77) + "...";
    }

    return title || "GTM Maturity Assessment";
  } catch (error: unknown) {
    console.error("[OpenAI] Error generating assessment title:", error);
    return "GTM Maturity Assessment";
  }
}

/**
 * Generate a title for a coaching session from its notes/transcript
 * @param notes - The session notes
 * @param transcript - Optional call transcript
 * @returns A short descriptive title for the session
 */
// Patterns that indicate the model refused to do the summarization
// (typically when the notes contain a URL and the small title model
// reads it as a request to browse, or when the notes are too thin to
// generate anything from). If we detect one of these in the response
// we fall back to the generic "Coaching Session" title instead of
// stamping a refusal onto a coaching session card.
const REFUSAL_PATTERNS: RegExp[] = [
  /^i'?m\s+(?:unable|sorry|not\s+able)/i,
  /^i\s+cannot/i,
  /^i\s+can'?t/i,
  /^(?:as|i'?m)\s+an?\s+ai/i,
  /\bif you (?:could )?provide me\b/i,
  /\bcannot\s+access\b/i,
  /\bunable\s+to\s+access\b/i,
];

function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(text));
}

export async function generateSessionTitle(notes: string, transcript?: string | null): Promise<string> {
  try {
    // If there's almost nothing to summarize, skip the LLM call. A
    // bare URL or one-liner gives gpt-4o-mini just enough rope to
    // hallucinate or refuse; the generic title is a better default.
    const noteBody = (notes || "").trim();
    const txBody = (transcript || "").trim();
    const totalLen = noteBody.length + txBody.length;
    if (totalLen < 30) return "Coaching Session";

    const content = txBody
      ? `Notes:\n${noteBody.substring(0, 1000)}\n\nTranscript:\n${txBody.substring(0, 1000)}`
      : `Notes:\n${noteBody.substring(0, 2000)}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a coaching session title generator. You will be given the FULL text of a sales coaching session's notes (and optionally a transcript) directly in the user message — there is nothing external to fetch. Identify the 4-8 major specific topics discussed and list them as a comma-separated title. Be specific and concrete — use the actual deal names, skills, or strategies discussed rather than generic labels. Do not use quotes. Never refuse or ask for more content; if the input is sparse, summarize what you can in 2-3 short labels. Examples: 'Pipeline Gaps, Acme Deal Strategy, Discovery Frameworks, Q1 Targets', 'Cold Call Openers, Objection Handling, Demo Flow, Pricing Negotiation, Follow-up Cadence', 'Stakeholder Mapping, Champion Building, Technical Eval, Procurement Timeline'.",
        },
        {
          role: "user",
          content: `Identify the 4-8 major specific topics from this coaching session and list them comma-separated:\n\n${content}`,
        },
      ],
      max_completion_tokens: 120,
      temperature: 0.5,
    });

    const raw = response.choices[0]?.message?.content?.trim() || "";

    // Guard against the model returning a refusal ("I'm unable to
    // access external links…", "If you provide me with the session
    // notes…", etc.) instead of an actual topic list. Without this
    // check the refusal text got stamped onto the session card.
    if (!raw || looksLikeRefusal(raw)) {
      return "Coaching Session";
    }

    if (raw.length > 120) {
      return truncateAtWordBoundary(raw, 120);
    }

    return raw;
  } catch (error: unknown) {
    console.error("[OpenAI] Error generating session title:", error);
    return "Coaching Session";
  }
}

export { openai };
