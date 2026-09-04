import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { loadSellerContext, formatSellerContext } from "@/lib/seller-context";
import { assembleDealEvidence } from "@/lib/business-cases/generate";
import type { PracticePersona } from "./persona";

/**
 * Live-Fire mode (practice-suite-plan.md Phase 6): build the practice
 * persona from a REAL deal — the actual upcoming meeting's attendee,
 * grounded in the deal's timeline evidence — instead of synthesizing
 * a fictional buyer.
 *
 * Differences from the gym synthesizer, by design:
 *  - Everything is EVIDENCE-GROUNDED. The hidden dossier is what the
 *    deal actually shows; genuinely unknown fields are marked
 *    "(unknown — close this on the call)" rather than invented. The
 *    reveal doubles as call prep.
 *  - Temperament is inferred from how this person actually talks in
 *    the call transcripts (guarded default if they've never spoken).
 *  - Rapport breadcrumbs are only REAL details from the evidence — no
 *    planted hobbies for a real human.
 *  - The agenda drill's script is meeting-specific: proposed from the
 *    calls to date, the current stage, and this meeting's invite.
 */

const LIVEFIRE_PERSONA_PROMPT = `You are building a PRACTICE CARD for a founder rehearsing a REAL upcoming sales call. Below you have the deal's full evidence (timeline, participants), the meeting details, the focal attendee, and the founder's positioning. Produce the same two-layer card a practice drill uses — but grounded ENTIRELY in the evidence.

Return ONLY a JSON object with this exact shape:

{
  "public": {
    "name": "<the focal attendee's actual name>",
    "title": "<their actual title, or best evidence-based description>",
    "company": { "name": "<the real company>", "industry": "<from evidence>", "size": "<from evidence, or '(unknown)'>", "blurb": "<2-3 sentences on the company AS THE EVIDENCE SHOWS IT>" },
    "bio": "<2-4 sentences on this person built from the evidence: role, involvement in the deal so far, how they engage>",
    "breadcrumbs": ["<REAL personal/human details from the evidence only (something they joked about, mentioned in a call). Empty array if none — do NOT invent details about a real person.>"],
    "intro": "<2-3 sentence spoken self-intro in THIS person's actual voice/register as heard in transcripts (or a plausible neutral one if they've never spoken)>"
  },
  "hidden": {
    "orgPersona": "<which of the founder's org personas this account is>",
    "humanPersona": "<this person's role in the deal: economic buyer / champion / technical evaluator / end user / blocker — per the evidence>",
    "pains": ["<pains THE EVIDENCE shows, quoted/paraphrased from calls. Mark inferred ones '(inferred)'.>"],
    "currentState": "<how they handle the problem today, per evidence, or '(unknown — close this on the call)'>",
    "compellingEvent": "<the why-now from evidence, or '(unknown — close this on the call)'>",
    "valuePropsThatLand": ["<founder's value props the evidence suggests THIS person cares about>"],
    "valuePropsThatDont": ["<founder's value props with no evidence of resonance for this person (label these honestly — absence of evidence, not proof of indifference)>"],
    "temperament": "<one of: chatty | guarded | skeptical | distracted | enthusiastic — inferred from how they actually talk in transcripts; 'guarded' if they've never spoken>",
    "objections": ["<objections they've ACTUALLY raised, plus at most 1-2 likely ones marked '(likely)'>"]
  },
  "quiz": {
    "orgPersonaOptions": ["<4-5 options incl. hidden.orgPersona verbatim>"],
    "humanPersonaOptions": ["<4-5 options incl. hidden.humanPersona verbatim>"]
  },
  "voiceGender": "<'male' or 'female' — best guess from the name, for TTS voice selection only>"
}

Rules:
- EVIDENCE ONLY. This is a real person and a real deal: never invent facts, quotes, hobbies, or numbers. Unknowns are marked, not filled.
- The pains/value-prop lists must reference the founder's actual playbook below.
- Keep the intro and any roleplay-facing text consistent with this specific person's speaking style where transcripts exist.
- Return ONLY the JSON object.`;

interface MeetingInfo {
  title: string;
  date: string;
  description: string;
  linkedParticipantIds: string[];
  attendeeEmails: string[];
}

async function loadMeetingInfo(
  dealId: string,
  meetingEntryId: string | null
): Promise<MeetingInfo | null> {
  if (!meetingEntryId) return null;
  const entry = await prisma.dealTimelineEntry.findFirst({
    where: { id: meetingEntryId, dealId, type: "meeting" },
    select: { title: true, entryDate: true, content: true, metadata: true },
  });
  if (!entry) return null;
  let linkedParticipantIds: string[] = [];
  let attendeeEmails: string[] = [];
  if (entry.metadata) {
    try {
      const m = JSON.parse(entry.metadata);
      if (Array.isArray(m.linkedParticipantIds)) {
        linkedParticipantIds = m.linkedParticipantIds.filter(
          (x: unknown): x is string => typeof x === "string"
        );
      }
      if (Array.isArray(m.attendeeEmails)) {
        attendeeEmails = m.attendeeEmails.filter(
          (x: unknown): x is string => typeof x === "string"
        );
      }
    } catch {
      /* ignore */
    }
  }
  return {
    title: entry.title || "Meeting",
    date: entry.entryDate.toISOString(),
    description: (entry.content || "").substring(0, 3000),
    linkedParticipantIds,
    attendeeEmails,
  };
}

const VOICES_MALE = ["onyx", "echo", "fable"] as const;
const VOICES_FEMALE = ["shimmer", "alloy"] as const;

/**
 * Build a live-fire practice persona for a real deal + upcoming
 * meeting. For the agenda drill, also generates a meeting-specific
 * script (calls to date → what this meeting needs to open with).
 */
export async function buildLiveFirePersona(
  userId: string,
  dealId: string,
  meetingEntryId: string | null,
  drill: string
): Promise<PracticePersona> {
  const [assembled, meeting, seller] = await Promise.all([
    assembleDealEvidence(userId, dealId),
    loadMeetingInfo(dealId, meetingEntryId),
    loadSellerContext(userId),
  ]);
  if (!assembled) throw new Error("Deal not found");

  // Identify the focal attendee for the model: linked meeting
  // participants first, then champion/decision-maker, then anyone.
  const participants = await prisma.dealParticipant.findMany({
    where: { dealId },
    select: { id: true, name: true, title: true, role: true, email: true, company: true },
  });
  const linked = (meeting?.linkedParticipantIds || [])
    .map((pid) => participants.find((p) => p.id === pid))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const focal =
    linked.find((p) => p.title) ||
    linked[0] ||
    participants.find((p) => p.role === "champion" || p.role === "decision_maker") ||
    participants[0] ||
    null;

  const meetingBlock = meeting
    ? `## THE UPCOMING MEETING (the call being rehearsed)\nTitle: ${meeting.title}\nWhen: ${meeting.date}\nInvite notes: ${meeting.description || "(none)"}\nLinked attendees: ${linked.map((p) => `${p.name}${p.title ? ` (${p.title})` : ""}`).join(", ") || "(none linked)"}\nOther invitees: ${meeting.attendeeEmails.join(", ") || "(none)"}`
    : "## THE UPCOMING MEETING\n(no specific meeting — general rehearsal for the next call on this deal)";

  const focalBlock = focal
    ? `## FOCAL ATTENDEE (build the card for this person)\n${focal.name}${focal.title ? ` — ${focal.title}` : ""}${focal.role && focal.role !== "unknown" ? ` (deal role: ${focal.role})` : ""}${focal.email ? ` · ${focal.email}` : ""}`
    : "## FOCAL ATTENDEE\n(no participant records — build the card for the most senior external attendee evident in the meeting invitees/evidence)";

  const content = [
    LIVEFIRE_PERSONA_PROMPT,
    meetingBlock,
    focalBlock,
    formatSellerContext(seller),
    `## DEAL EVIDENCE\n\n${assembled.evidence.substring(0, 60_000)}`,
  ].join("\n\n---\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content }],
  });

  let parsed: PracticePersona & { voiceGender?: string };
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("Live-fire persona generation returned unparseable JSON");
  }
  if (!parsed.public?.name || !parsed.hidden?.humanPersona) {
    throw new Error("Live-fire persona generation returned an incomplete card");
  }

  // Guarantee quiz correctness server-side (same as the gym path).
  const orgOptions = new Set(parsed.quiz?.orgPersonaOptions || []);
  orgOptions.add(parsed.hidden.orgPersona);
  const humanOptions = new Set(parsed.quiz?.humanPersonaOptions || []);
  humanOptions.add(parsed.hidden.humanPersona);
  const valueProps = [
    ...(parsed.hidden.valuePropsThatLand || []),
    ...(parsed.hidden.valuePropsThatDont || []),
  ].sort(() => Math.random() - 0.5);

  const voicePool = parsed.voiceGender === "male" ? VOICES_MALE : VOICES_FEMALE;
  const persona: PracticePersona = {
    public: parsed.public,
    hidden: parsed.hidden,
    quiz: {
      orgPersonaOptions: [...orgOptions].sort(() => Math.random() - 0.5),
      humanPersonaOptions: [...humanOptions].sort(() => Math.random() - 0.5),
      valueProps,
    },
    voice: voicePool[Math.floor(Math.random() * voicePool.length)],
  };

  // Agenda drill (and the Full Call's agenda stage): meeting-specific
  // script proposed from the deal state (NOT the generic first-call
  // default — this call has history).
  if (drill === "agenda" || drill === "full_call") {
    const scriptCompletion = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        {
          role: "user",
          content: `Write the AGENDA-SET SCRIPT (spoken passage, ~45-75 seconds, plain text, no markdown) the founder should open THIS specific upcoming meeting with. Ground it in the deal evidence: reference where the conversation left off, what this meeting is for (per the invite), the proposed shape of THIS call, the explicit out, and close with the up-front contract confirmation + call for agreement/additions ("does that work — anything else you want to cover?"). Skip the elevator pitch if the buyer already knows the product (later-stage deal); include a one-line context reset only if the evidence suggests new attendees are joining. Under 140 words. Break it into 3-5 SHORT PARAGRAPHS separated by blank lines — one beat per paragraph; it's read off a teleprompter mid-delivery, so no walls of text. Return ONLY the script.\n\n---\n\n${meetingBlock}\n\n${formatSellerContext(seller)}\n\n## DEAL EVIDENCE\n\n${assembled.evidence.substring(0, 40_000)}`,
        },
      ],
    });
    const script = (scriptCompletion.choices[0]?.message?.content || "").trim();
    if (script) {
      persona.script = script;
      persona.scriptSource = "generated";
    }
  }

  return persona;
}
