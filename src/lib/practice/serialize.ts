import type { PracticePersona } from "./persona";

/**
 * API-shape a PracticeSession row. THE rule of the practice suite:
 * the hidden dossier never leaves the server while a session is
 * active — grading against answers the founder could have peeked at
 * would make the whole gym pointless. Once completed, hidden ships as
 * the reveal alongside the report card.
 */
export function serializePracticeSession<
  T extends {
    id: string;
    drill: string;
    mode: string | null;
    persona: unknown;
    turns: unknown;
    answers: unknown;
    score: unknown;
    status: string;
    dealId: string | null;
    meetingEntryId: string | null;
    createdAt: Date;
    completedAt: Date | null;
  },
>(session: T) {
  const persona = session.persona as unknown as PracticePersona;
  const completed = session.status === "completed";
  return {
    id: session.id,
    drill: session.drill,
    mode: session.mode,
    status: session.status,
    persona: {
      public: persona.public,
      quiz: persona.quiz,
      // The agenda script is the founder's own material — never hidden.
      ...(persona.script ? { script: persona.script, scriptSource: persona.scriptSource } : {}),
      ...(persona.voice ? { voice: persona.voice } : {}),
      ...(completed ? { hidden: persona.hidden } : {}),
    },
    // Roleplay exchange — user + persona turns only, nothing hidden.
    turns: session.turns ?? null,
    answers: session.answers ?? null,
    score: session.score ?? null,
    // Live-Fire anchoring (null for gym sessions).
    dealId: session.dealId,
    meetingEntryId: session.meetingEntryId,
    createdAt: session.createdAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  };
}
