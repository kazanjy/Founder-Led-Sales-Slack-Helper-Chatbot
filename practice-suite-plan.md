# Practice Suite — a rep gym for founder-led sales

## Vision

Drill the founder against **synthetic buyers generated from THEIR playbook**
(ICP, personas, sales narrative) and grade them against **THEIR assets**
(value props, discovery questions, first-call checklist agenda). Every drill
produces a structured report card; scores accumulate into a practice history
that the coaching applet and readiness progression can see. This is the
"practice" counterpart to Call Review's "game film."

Four drills at launch: **Pre-Call Planning · Rapport · Agenda Setting ·
Discovery.** (Objection handling is an obvious 5th riding the objection
library — designed-for, not built.)

## What already exists (this is mostly assembly)

- **Voice loop, end-to-end**: `VoiceRecordingInput` (records → `/api/voice/transcribe`,
  whisper-1) and `/api/voice/speak` (OpenAI TTS). Voice-in / voice-out roleplay
  is wiring, not new infrastructure. One addition: per-persona voice selection
  (alloy/echo/fable/onyx/nova/shimmer) so the synthetic buyer doesn't sound
  like Mikey-the-coach (nova stays the coach voice).
- **Playbook assets to grade against**: discovery questions + first-call
  checklist (via `loadDiscoveryFramework`), sales narrative + value props (via
  `loadSellerContext`), ICP JSON, objection library.
- **Grading precedent**: Call Review already does rubric-graded scoring of
  transcripts — the report-card mental model is familiar.
- **Coaching framework**: goals/tasks/metrics to receive "drill discovery 2x
  this week" style follow-ups later.

## Shared infrastructure (build once, all drills use it)

### 1. Persona Synthesizer — the heart of the suite

Generates a synthetic buyer with a **two-layer card**:

- **PUBLIC profile** (shown to the founder): name, title, company snapshot
  (size, industry, stack hints), and rapport surface — a LinkedIn-ish bio
  with planted breadcrumbs (a recent post, alma mater, a talk they gave, a
  hobby hint). All synthetic, no real people.
- **HIDDEN dossier** (used by the grader + roleplay engine, never shown until
  the reveal): which org persona + human persona this actually is, their real
  pains and current state, the compelling event, **which value props land and
  which they don't care about**, temperament (chatty / guarded / skeptical /
  distracted), objections they're carrying, and disqualifiers if any.

Inputs: ICP sections + sales narrative + discovery questions. The founder can
pick org persona × human persona explicitly, or **"I'm Feeling Lucky"**
(weighted random — see rotation below). Fairness rule baked into generation:
everything in the hidden dossier must be *inferable* — from the public card
(pre-call/rapport drills) or through conversation (discovery drill). The
grader is instructed to only penalize misses that were discoverable.

Personas are generated per-session and **snapshotted into the session row**
(no persona registry table in v1). A "Rematch" button re-drills the same
snapshot; a persona library can emerge later if wanted.

### 2. Data model (one table)

```prisma
model PracticeSession {
  id       String @id @default(cuid())
  userId   String
  user     User   @relation(...)
  drill    String  // "precall_plan" | "rapport" | "agenda" | "discovery"
  mode     String? // drill-specific: "script_visible" | "script_hidden" | "two_level" | "freestyle"
  persona  Json    // { public: {...}, hidden: {...}, voice: "onyx" }
  turns    Json    // [{ role: "user"|"persona"|"coach", text, audioDurationMs?, at }]
  answers  Json?   // structured quiz answers (pre-call drill)
  score    Json?   // { overall, dimensions: [{name, score, max, comment}], modelAnswer, reveal }
  status   String @default("active") // "active" | "completed" | "abandoned"
  createdAt   DateTime @default(now())
  completedAt DateTime?
  @@index([userId, drill, createdAt(sort: Desc)])
  @@map("practice_sessions")
}
```

Turns as JSON (not a table): sessions are short (2–30 turns), always loaded
whole, never queried across.

### 3. Grading engine

One `gradeSession(drill, session, playbookAssets)` function with a
**per-drill rubric**. Output is uniform so ONE report-card component renders
every drill:

```
{ overall: "B+", dimensions: [{ name, score, max, comment }],
  modelAnswer: "what great looks like, concretely",
  reveal: "the hidden dossier, now shown",
  nextRep: "the one thing to fix on the next attempt" }
```

Grading always ends with the **reveal** — the founder sees the hidden dossier
side-by-side with their answers. That's where the learning lands.

### 4. Practice home — `/practice`

Drill cards (each with last score + sparkline of recent attempts), streak
counter, and a "weakest area" nudge. Per-drill history pages list past
sessions with scores; clicking one replays the transcript + report card.
Nav: new "Practice" item (🥊). Rotation logic for "I'm Feeling Lucky":
weighted toward org×human combos with the fewest attempts and lowest scores —
spaced-repetition-lite, no fancy scheduling in v1.

## The four drills

### Drill 1 — Pre-Call Planning (forms only, no voice — ships first)

Flow: persona PUBLIC card appears (as if a meeting landed on the calendar) →
quiz form:
1. Which of your **org personas** is this? (choices from their ICP + distractors)
2. Which **human persona**? (economic buyer / champion / end user / …)
3. What's your **angle** — the hypothesized pain and why-now? (free text)
4. Which of your **value props land** for this person, and which DON'T?
   (multi-select over their actual value props)

Grade against the hidden dossier: persona identification, pain hypothesis
accuracy, value-prop mapping (both directions — picking a prop they don't
care about costs points, because pitching it on a real call burns time and
credibility). Reveal + model answer + rotation to the next combo.

### Drill 2 — Rapport (voice in, no voice out)

Persona public card with planted rapport breadcrumbs → founder delivers the
icebreaker **by voice** (or types). Grade: (a) authenticity — does it sound
like a human or a LinkedIn bot; (b) relevance — did they use a breadcrumb
that's actually appropriate to use; (c) brevity; (d) the pivot — does it
bridge naturally into business. Penalize icks explicitly: fake flattery,
over-familiarity, creepy-specific research. Report card offers two
alternative angles from the same card.

### Drill 3 — Agenda Setting (voice + script modes + a clock)

Setup: pull the agenda-set template from the **first-call checklist**
(editable before starting — edits are session-local, with a "save back to
checklist" affordance). Persona card for org+human context. Two modes:
- **Script visible** — teleprompter-style panel while recording.
- **Script hidden** — from memory.

Founder records the agenda set + terse elevator pitch → transcribe → grade
against the script: coverage of beats (in order), fidelity where wording
matters vs. acceptable paraphrase, **duration** (MediaRecorder gives it —
"agenda set in under 60s, pitch under 90s"), pace (words/min), filler
density ("um/uh/like/sort of" per minute — Whisper catches these). Score
trend per mode, so graduating from script-visible to script-hidden is
visible progress.

### Drill 4 — Discovery (the flagship)

Persona selection: explicit org×human pick or I'm Feeling Lucky. Three modes:

- **Two-Level Drill** (the rep): persona gives a short self-intro (TTS +
  text) → founder asks ONE discovery question by voice → transcribed →
  persona answers in character from the hidden dossier (typed reply, spoken
  via TTS) → founder asks the **second-level follow-up** → graded. Rubric:
  was Q1 aligned to their discovery framework; was the follow-up genuinely
  second-level (digs into the answer: quantifies, asks for an example,
  probes impact) vs. a first-level topic-hop; missed-gold detection ("she
  said 'we tried building it ourselves' and you didn't pull that thread").
  Report card shows what the follow-up *could have been*.
- **Questions visible / hidden** toggle applies to both drill modes —
  visible shows their discovery questions in a side panel.
- **Freestyle**: full discovery conversation. Founder speaks; persona
  replies in character — **typed text rendered in the transcript AND spoken
  via TTS** (per your spec); loop continues until the founder says
  wrap-up (or hits end). Personas are instructed to answer like real
  buyers: SHORT, sometimes vague, occasionally tangential, volunteering
  gold only when a question earns it; temperament from the dossier shapes
  cooperativeness. Full-conversation grade: **coverage against their
  discovery framework** (which of THEIR questions got answered — same
  audit concept as the deal analyzer's Discovery Gaps section), talk
  ratio, second-level ratio, missed threads, and the kicker: *"from this
  conversation you could fill in X of the sections of your Discovery
  Summary template — here's what you'd still be missing."* That ties
  practice directly to the Business Cases suite.

## Live-Fire mode — practice for a REAL upcoming call (the payoff)

The gym drills build skill against synthetic buyers; **live-fire mode preps
an actual call on an actual deal**. Entry points: a "🥊 Practice for this
call" button on each Upcoming Meeting row on the deal page, and a "practice
for a real call" picker on `/practice` listing upcoming meetings across
deals. Same session model (`dealId` + `meetingEntryId` nullable columns on
PracticeSession), same drills, different persona source:

### Real-persona assembly (replaces the synthesizer)

Build the buyer card from what we actually know, best-source-first:
1. **DealParticipant** record (name, title, role, email) for the attendee.
2. **PDL enrichment** — reuse the existing pre-call enrichment path
   (`PreCallEnrichmentAttempt` plumbing) to fill title/level/background when
   the participant record is thin. Enrichment miss → **ask the founder for
   the human persona type** (one select) and synthesize the rest from the
   org context.
3. **Prior-call behavior** — the deal's transcripts tell us how THIS person
   actually talks: terse or chatty, what they've already said they care
   about, objections already raised, commitments already made. This feeds
   both the "likely response" simulation and the grader.

The "hidden dossier" equivalent is the deal's actual evidence — so the
reveal doubles as call prep, and a live-fire session's report card is
effectively a rehearsed pre-call plan.

### The three live-fire drills

- **Pre-Call Planning (live)**: quiz against the real attendee — persona
  type, angle, value-prop mapping — graded against PDL + deal evidence. When
  we genuinely don't know an answer (thin deal), the grader says "unknown —
  and that's a gap to close on the call," not a wrong-answer buzzer.
- **Agenda Setting (live)**: propose the agenda for the NEXT call from the
  calls to date + current stage + what the natural next step is (the sales
  motion asset's call-sequence knowledge informs "what call comes after
  where we are"; first-call checklist covers the true-first-call case).
  Founder edits the proposed agenda if desired, then practices it verbally —
  script visible or hidden — and is graded against the agenda they approved,
  same coverage/duration/filler metrics as the gym drill.
- **Discovery (live)**: propose the discovery question to ask — sourced
  straight from THIS deal's **Discovery Gaps** (the analyzer section already
  emits ready-to-ask questions, prioritized by economic-case impact).
  Founder asks it verbally → the simulated buyer answers with a LIKELY
  response conditioned on prior-call evidence + human/org persona ("given
  what Sundar has said about procurement, he'll probably deflect to the
  security review") → founder follows up → graded. Every rep here is
  double-duty: skill practice AND a rehearsal of the actual next call.

Live-fire grading rule: synthetic drills grade against a knowable dossier;
live-fire grades against deal evidence and is explicitly honest about
unknowns — the point is readiness, not gotchas. A completed live-fire
session can optionally log a compact summary to the deal timeline ("Practiced
for Jul 10 call — plan: …") so prep work shows up in deal history.

## Cross-suite integration (later phases)

- **Coaching**: `getPracticeActivity` tool for the coaching agent; coach can
  see drill scores/trends; outcome extraction can propose "drill X" tasks.
- **Readiness**: practice reps as evidence in `/api/sales-readiness/sync`.
- **Objection drill (Drill 5)**: persona raises objections from the objection
  library; founder responds by voice; graded against the library's approved
  responses. Cheap once the loop exists.
- **Call Review bridge**: same rubric dimensions on real calls vs. practice —
  "your practice talk-ratio is 40%, your real-call ratio is 68%." For
  live-fire: after the real call's recording lands, compare the practiced
  plan vs. what actually happened.

## API surface

```
POST /api/practice/sessions           { drill, mode?, orgPersona?, humanPersona? } → session (persona generated + snapshotted)
POST /api/practice/sessions/[id]/turn { text } → { personaReply } (roleplay drills; TTS fetched separately via /api/voice/speak)
POST /api/practice/sessions/[id]/grade { answers? } → { score } (finalizes)
GET  /api/practice/sessions?drill=…    → history + stats
```

Voice stays client-orchestrated: record → `/api/voice/transcribe` → POST turn
→ render persona text → `/api/voice/speak` for playback. No new audio infra.

## Phasing

- **Phase 1 — foundation + Drill 1 — ✅ SHIPPED**: PracticeSession model, persona
  synthesizer (two-layer card + fairness rule), grading engine + report-card
  component, `/practice` home with history, Pre-Call Planning drill
  end-to-end. Forms only — no voice dependency, fastest path to feeling the
  loop (generate → attempt → reveal → rotate).
- **Phase 2 — Rapport — ✅ SHIPPED**: first voice-in drill; streaks + sparklines.
- **Phase 3 — Agenda Setting — ✅ SHIPPED**: script from saved default
  (AGENDA_SCRIPT merge field) > first-call checklist > skeleton; script
  visible/hidden modes; real duration clock (speech-end aware); beat/
  fidelity/time/delivery grading with filler counting.
- **Phase 4 — Discovery (L)**: two-level drill, then freestyle with the TTS
  persona voice loop. The flagship — lands last on purpose, everything it
  needs (persona engine, turn loop, grading, voice) is proven by then.
- **Phase 5 — integrations (M)**: coaching tool + readiness evidence +
  objection drill.
- **Phase 6 — Live-Fire mode (L)**: deal-anchored variants of Pre-Call
  Planning, Agenda Setting, and Discovery — real-persona assembly (PDL +
  participant + prior-call behavior), deal-page entry point on upcoming
  meetings, Discovery-Gaps-sourced question proposals, optional practice
  summary to the deal timeline. Lands after the gym proves the drill loops;
  everything it adds is persona sourcing + deal grounding.
- **Phase 7 — Full Call (L) — the capstone.** One persona, one continuous
  session, all four drills in call order: pre-call quiz (plan the approach)
  → rapport (icebreaker → response → pivot) → agenda set (delivered off the
  pivot) → discovery (freestyle roleplay) → wrap-up. Graded per-stage with
  the existing rubrics PLUS a whole-call synthesis: did the plan survive
  contact (did they pitch the value props they said would land?), did
  rapport insights carry into discovery, arc coherence, and one overall
  letter grade. Reuses everything — persona engine, turn loop, per-drill
  graders — the new work is stage orchestration on one session (mode:
  "full_call", stage markers in turns) and the cross-stage synthesis
  grader. Works in gym mode AND Live-Fire (full rehearsal of a real
  upcoming call). Deliberately last: it's an assembly of proven parts.

## Design decisions (made — flag if you disagree)

- **Personas are per-session snapshots, not a registry.** Rematch re-uses a
  snapshot; a curated persona library is a later feature if repetition
  demands it.
- **Hidden-dossier fairness rule**: the grader may only penalize what was
  discoverable (from the card or the conversation). No gotchas — this is a
  gym, not a casino.
- **Persona replies are deliberately terse/imperfect** in freestyle — LLMs
  love to monologue helpfully; real buyers don't. Temperament in the dossier
  controls cooperativeness so drills vary in difficulty.
- **Letter grades + dimension scores**, not just prose — trends need numbers,
  founders need the one-line verdict, and the reveal carries the nuance.
- **Voice is always optional** (type instead) — keeps drills usable in an
  open office, and keeps accessibility clean.
