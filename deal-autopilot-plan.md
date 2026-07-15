# Deal Autopilot — auto-detection, auto-disposition, and the Slack deal thread

## The problem with "Potential deals" today

The recorder scanner creates Potential deals and posts Validate / Dismiss
buttons to Slack. That makes a HUMAN the disposition engine: every detected
call demands a decision, nothing happens on a real deal until someone clicks
Validate, and the queue rots when they don't. Meanwhile the signal we need to
make that decision automatically already exists — the calendar invite before
the meeting, and the recording after it.

## The redesign: staged confidence, zero mandatory clicks

Two judgment passes, matched to when evidence exists:

```
calendar event appears (5-min cron, already live)
        │
        ▼
  PRE-MEETING TRIAGE (LLM: invite title + description + attendees + PDL + founder's ICP)
        │
   ┌────┴─────────────┐
   ▼                  ▼
 LIKELY DEAL      UNLIKELY (vendor / fundraising / recruiting / internal / personal)
   │                  │
   │                  └── logged (audit trail + weekly "correct me" digest), no deal created
   ▼
 DEAL CREATED, status "likely" — the machine starts working immediately:
   enrich (PDL), attach the meeting, pre-call research brief, Slack thread
   opens ("🎯 Likely new deal: Acme — first call Thursday 2pm"), pre-call
   plan + live-fire practice one click away
        │
        ▼   meeting happens; recorder scanner picks up the call (already live)
  POST-MEETING CONFIRMATION (LLM: transcript — "was this a sales conversation
  for OUR product? stage? buying signals?")
        │
   ┌────┴─────────────┐
   ▼                  ▼
 CONFIRMED         NOT A DEAL
 status → active   status → dismissed (auto), one-line Slack note with Undo
 transcript attached, analysis runs, Slack thread updates
```

Manual disposition disappears. The escape hatches that replace it:
- Every Slack announcement carries a quiet **"Not a deal? Dismiss"** action —
  optional, never required.
- A weekly **triage digest** lists the UNLIKELY calls ("meetings I decided
  weren't deals — tap to promote") so false negatives are catchable without
  a mandatory review queue.
- **Human-touch override**: a deal the founder has manually edited (stage,
  notes, entries) is NEVER auto-dismissed — once a human engages, the machine
  only suggests.

## Judgment passes

### Pass 1 — pre-meeting triage (calendar evidence)

Inputs: event title + description; attendee emails/domains (external,
non-public-provider); PDL enrichment of external attendees (title, company,
size — is this a prospect-shaped human at an ICP-shaped company?); the
founder's ICP + sales narrative; the founder's own email domain(s); existing
deal index (skip events already matched to a deal — the existing sweep
already handles those).

Output (json): `{ verdict: likely_deal | unlikely_deal, category:
prospect_first_call | existing_customer | vendor_pitch_to_us | fundraising |
recruiting | internal | personal | unknown, confidence: 0-1, companyName,
companyDomain, reason }`.

Rules of the classifier: external attendees from one non-ICP-irrelevant
company + meeting language that reads like an intro/demo/discovery →
likely. Signals AGAINST: the founder is the buyer (vendor demos TO us),
investor patterns (partner titles at funds, "catch up"), recruiting
(candidate + "interview"), internal-only domains. DEAL-STATE EVIDENCE
first: the classifier gets the most recent call transcripts from any
prior deal on the domain (dismissed/closed-lost/in-play) plus its
status and last triage verdict — "we're evaluating buying you" vs
"we're customers, implementing you" is judged from what was actually
said, and always beats cadence or invite language. ONGOING-CADENCE is
a supporting signal only: a recurring series or several future
meetings booked with the account (recurringEventId + per-domain window
counts, computed by the sweep) breaks ties toward existing_customer. Below a confidence
threshold (default 0.7) → classify unlikely but flag `borderline: true` for
the digest. Never invents: PDL miss + empty description + unknown domain =
unlikely/unknown, digest-flagged.

### Pass 2 — post-meeting confirmation (recording evidence)

Trigger: the recorder scanner (every-minute cron, already live) matches a
new recording to a `likely` deal (by attendee domain — same matching it does
today). Instead of attach-and-wait-for-Validate:

Inputs: transcript + summary; the founder's narrative/ICP; the triage record.
Output: `{ verdict: confirmed_deal | not_a_deal, stage: discovery | demo |
…, reason }`.

- `confirmed_deal` → status active, transcript attached, runDealAnalysis,
  Slack thread: "✅ Confirmed after Thursday's call — health: Good. Analysis
  inside." Stage set from evidence.
- `not_a_deal` → status dismissed, Slack thread one-liner + Undo. Timeline
  and classification kept (auditability; undo restores everything).
- No recording arrives within N days (default 7) of the meeting: leave
  `likely`, thread nudge once ("no recording found for Thursday's call —
  still live? paste notes or dismiss"). Likely deals with no activity at all
  auto-expire to dismissed after 21 days (thread note + Undo).

### Recorder-detected calls with NO prior calendar triage

(Current "potential" path.) Same Pass-2 classifier runs directly on the
transcript — it either creates a confirmed active deal or logs a dismissal
record. The Validate/Dismiss block-kit flow retires. Existing `potential`
deals migrate through Pass 2 in a one-time backfill.

## Data model

```prisma
// One row per (user, calendar event or recording) judgment — the audit
// trail, the dedupe guard, and the digest source.
model DealTriage {
  id        String  @id @default(cuid())
  userId    String
  user      User    @relation(...)
  source    String  // "calendar" | "recording"
  sourceId  String  // calendarEventId or recording callId
  eventAt   DateTime // meeting start / call time
  title     String?
  verdict   String  // "likely_deal" | "unlikely_deal" | "confirmed_deal" | "not_a_deal"
  category  String? // prospect_first_call | vendor_pitch_to_us | fundraising | ...
  confidence Float?
  borderline Boolean @default(false)
  reason    String? @db.Text
  dealId    String? // set when a deal was created/matched
  overriddenAt DateTime? // human corrected the verdict
  createdAt DateTime @default(now())
  @@unique([userId, source, sourceId])
  @@index([userId, createdAt(sort: Desc)])
}
```

- `Deal.status` gains `"likely"` (between nothing and active). `potential`
  deprecates after backfill. Status pills/filters/sorts already generalize.
- `Deal` gains `slackChannelId` + `slackThreadTs` (nullable) — the deal's
  Slack thread anchor.

## Where it hooks (all crons already exist)

- **Pass 1** rides the 5-minute `scan-future-meetings` cron: after the sweep,
  classify NEW events that didn't match an existing deal (today those are
  simply ignored). Triage rows dedupe re-runs.
- **Pass 2** rides the every-minute `scan-recordings` cron: replace the
  create-potential + Validate/Dismiss branch with the confirmation classifier.
- Expiry/nudges ride the daily cron.

## Part 2 — Slack stub posts (timed, event-shaped previews)

NOT one ever-growing thread per deal (revised per feedback). Each key
moment gets its own channel-level STUB POST — a scannable preview with a
deep link — timed to when the founder actually needs it:

- **"🎯 New Deal Detected"** — at birth (likely-deal triage or recorder
  confirmation). Preview: meeting title/time, attendees, why the classifier
  thinks it's a deal. Actions: [Open deal] · [Not a deal?].
- **"📋 New Pre-Call Plan"** — posted **~4 hours before a meeting** on an
  in-play deal: auto-generated pre-call brief preview (attendee readout +
  top objectives) with links to the full plan and 🥊 practice. Four hours
  (not two) so there's runway to actually run a practice rep.
- **"🧠 Updated Deal Analysis"** — **~5 minutes after a meeting recording
  lands**: health pill + 2-line synopsis + what changed, linking to the
  deal. (Rides the recorder cron's existing analysis cascade.)
- Confirmation / auto-dismissal verdicts (+ Undo) post the same way.

Each stub is its own Slack message → each gets its own reply thread.
**Inbound**: replies under any deal stub route to the deal agent with the
deal PINNED (stub ts → deal lookup via a small DealSlackPost table —
deterministic, no name matching): "just talked to their CFO…" logs to the
timeline via addTimelineEntry; "what's my next move?" answers with full
deal context.

Noise controls: claimed channel of the deal owner (DM fallback); nothing
posts for dismissed deals except the dismissal; per-user toggles per stub
type later if volume warrants.

## Part 3 — Pipeline Review, deal tasks, and proof capture

The timed stubs cover MOMENTS (a deal is born, a call is coming, a call
landed). Nothing covers the SLOW DECAY between moments — the Charlie
Labs problem: Proposal stage, 35 days in stage, last activity 3 weeks
ago, no upcoming meeting, health Poor, and the "send Jerrod an is-this-
still-live Slack" recommendation buried in an analysis nobody reopens.
Autopilot's third leg: watch the whole pipeline on a cadence, turn
recommendations into TRACKABLE to-dos on the deal, and close the loop
with proof.

### Deal tasks — recommendations become objects

Every deal analysis already computes a "Next Best Action"; it dies as
prose inside lastAnalysis. Materialize it:

```prisma
model DealTask {
  id        String @id @default(cuid())
  userId    String
  dealId    String   // relation, cascade
  title     String   // imperative: "Send Jerrod a direct 'is this still live?' Slack"
  rationale String?  @db.Text // why the machine proposed it (evidence-cited)
  source    String   // "pipeline_review" | "deal_analysis" | "user"
  status    String   @default("proposed") // proposed | done | dismissed | expired
  proofEntryId String?  // timeline entry evidencing completion (nullable — Done on trust is fine)
  reviewRunId  String?  // groups tasks proposed by the same weekly review
  createdAt DateTime @default(now())
  resolvedAt DateTime?
}
```

- Lifecycle is deliberately thin: proposed → done / dismissed. No
  "accepted" state — a founder either does it or kills it.
- **Expiry, not duplication**: the next review sees open proposed tasks
  as input. It re-affirms (leaves them), or expires ones whose
  underlying condition changed (meeting got booked → "book a meeting"
  task expires). It never re-proposes a near-duplicate of an open task.
- Surfaced as a "Proposed actions" card on the deal page and a compact
  pill/row on the deals list; Done / Dismiss one click, proof optional.

### Weekly Pipeline Review

Weekly cron (Monday morning, rides the daily-cron slot or its own):

1. Gather per-deal signals for every in-play deal — health, days in
   stage, days since last activity, upcoming-meeting presence, value,
   the lastAnalysis Next Best Action, open DealTasks. No fresh analyses
   are run (the recorder/calendar crons keep those current); the review
   SYNTHESIZES across deals — that's what no existing surface does.
2. One LLM pass over the portfolio: rank deals needing attention
   (health × staleness × value), and for the top few produce/refresh a
   concrete task each (with rationale citing the deal evidence).
   **Cap ~5 tasks/week** — a wall of 20 to-dos reads as noise and dies;
   five ranked asks get done. Everything else appears as one roll-up
   line ("6 other deals moving normally").
3. Slack "📊 Weekly Pipeline Review" post (claimed channel, DM
   fallback; recorded in DealSlackPost kind "pipeline_review"):
   pipeline stats (in-play count/value, week's movement: stage changes,
   new deals, wins/losses) + the ranked attention list. Each attention
   item: company + health pill + one-liner + its task, with
   [✓ Done] [✕ Dismiss] [Open deal] actions (deal_task_done /
   deal_task_dismiss).
4. Tasks link back: the deal page card shows the same tasks; resolving
   in either surface updates both (same row).

### Proof capture — close the loop with evidence

A task's real resolution is usually an email/Slack/iMessage the founder
already sent. Let them paste it:

- **Ingestion surfaces**: (a) deal page + deals list — paste or
  drag-drop an image (screenshot of email/slack/imessage) or raw text
  onto the deal; (b) Slack — reply to any deal stub thread (pipeline
  review item, task stub) with the screenshot attached; DM to Mikey
  works too. Slack ingestion rides Phase 4's thread→deal routing.
- **Pipeline**: image → vision extraction (same Vision path the Slack
  file handler uses) → {channel: email|slack|imessage|other,
  participants?, date?, extractedText}. Lands as a timeline entry type
  "evidence" with metadata {channel, ingestedVia: paste|slack_reply,
  taskId?} — rendered with a 📎 pill, feeds the analyzer like any
  other entry.
- **Task linkage**: proof pasted from a task's context (task card
  button, or a reply under that task's Slack stub) sets proofEntryId
  and flips the task to done. Proof pasted cold just becomes evidence.
- **Dupe detection** (paste-time, before writing): candidate set =
  recent timeline entries of correspondence-ish types (email, note,
  evidence, call_summary) within ±14 days of the extracted date (or
  last 30 days when undated); cheap token-overlap score first, then an
  LLM same-or-different judge on the top candidates. On dupe: discard
  and tell the user WHICH entry it matched ("already on the deal —
  Jul 10 recap email"). Near-miss (same thread, new reply) ingests
  with a "related to <entry>" link instead of discarding.

## Re-engagement: closed-lost accounts coming back

A new call/meeting with an account whose only deal is CLOSED-LOST is a
re-engagement — one of the highest-value moments in founder-led sales — and
must create a NEW deal that references the old one (never resurrect the
dead deal, never treat the account as a stranger):

- **`Deal.previousDealId`** — nullable self-relation, set at auto-create
  time to the account's most recent closed_lost (or dismissed) deal. Chains
  if it happens twice. Deliberately NOT a full Account/Company entity —
  one nullable FK gets 90% of the value without a heavy migration; chains
  migrate cleanly into an Account model if that world ever arrives.
- **Birth timeline entry**: "↩️ Re-engagement — prior deal closed lost
  Mar 2026 (reason: competition). See <prior deal>."
- **Cooldown fix**: the 30-day creation cooldown applies ONLY to dismissed
  deals (its purpose is dismiss-then-recreate loops). Closed-lost never
  suppresses creation.
- **Context propagation** (where the link earns its keep):
  - Pass-2 confirmation classifier is told about the prior loss so it can
    tell genuine re-engagement from a lingering post-mortem thread;
  - deal analyzer gets a "Prior relationship" line (Discovery Gaps probes
    what changed since the loss);
  - deal agent exposes previousDeal via getDealCore;
  - Slack stub reads "🎯 Acme is back — previously closed lost in March";
  - deal page banners in both directions (returning account ↔ newer deal).

## Phasing

1. **Phase 1 — Pre-meeting triage + likely deals (L)**: DealTriage model +
   `likely` status; classifier + hook in the 5-min cron; auto-create with
   enrichment + research kickoff; Slack root post (announce-only, no thread
   replies yet) with Dismiss/Undo actions. Manual Validate/Dismiss stays for
   the recorder path (unchanged) — belt and suspenders while triage bakes.
2. **Phase 2 — Post-meeting confirmation — ✅ SHIPPED**: Pass-2 classifier
   in the recorder cron (likely deals + replacement for create-potential,
   with legacy Validate/Dismiss as the classifier-outage fallback);
   gradual backfill of existing potentials + self-heal for likelies whose
   confirmation errored (2/user/tick); 21-day likely expiry with
   human-touch override; ✅ Confirmed / 🗂️ Archived stubs with Undo
   (undo restores to ACTIVE and records the override). Deferred: the
   7-day no-recording nudge (Phase 3, alongside the timed stubs).
3. **Phase 2.5 — Re-engagement linking (S/M)**: previousDealId + cooldown
   fix + context propagation per the section above.
4. **Phase 3 — Timed stub posts — ✅ SHIPPED**: DealSlackPost table
   (ts → deal, dedupe key, Phase-4 routing source; all stub posters now
   record their ts); "📋 New Pre-Call Plan" at T-4h (rides the 5-min
   cron; generates the brief — synopsis + top objectives + watchout —
   with links to the deal and 🥊 live-fire practice); "🧠 Updated Deal
   Analysis" after the recorder cron's analysis cascade (health pill
   with before→after, first-paragraph synopsis; replaces the legacy
   "meeting added" DM; a cooldown-skipped re-analysis posts a one-line
   "call attached" note instead); the deferred 7-day no-recording nudge
   (one per likely deal, ever; 14-day lookback floor so it never
   overlaps the 21-day expiry).
5. **Phase 4 — Inbound stub threads (M)**: reply-under-stub → deal-agent
   routing with the deal pinned; activity capture in-thread. Now also
   the transport for Slack-side proof capture (Phase 8) — build before
   or with it.
6. **Phase 5 — Deal tasks (M)**: DealTask model; harvest the Next Best
   Action from each fresh deal analysis into a proposed task (dedupe vs
   open tasks); "Proposed actions" card on the deal page + deals-list
   surfacing; Done / Dismiss.
7. **Phase 6 — Weekly Pipeline Review (M)**: portfolio synthesis cron +
   the Slack review post with per-task actions; task expiry/re-affirm
   pass; DealSlackPost kind "pipeline_review".
8. **Phase 7 — Proof paste in the UI (M/L)**: paste/drag email-slack-
   imessage screenshots (or raw text) on the deal page and deals list;
   vision extraction → "evidence" timeline entries; dupe detection with
   named-match discard; task-context paste sets proofEntryId → done.
9. **Phase 8 — Proof via Slack (M)**: screenshot replies under task /
   review stubs (and Mikey DM) run the same extraction + dupe pipeline
   and resolve the task. Rides Phase 4 routing.

## Design decisions (made — flag if you disagree)

- **"Likely" deals are REAL deals**, not a shadow queue: full timeline,
  enrichment, pre-call machinery, practice — because the whole point is to
  start working the deal before the first call. The status pill is the only
  difference; auto-dismissal cleans up the misses.
- **Unlikely events create NO deal object** — just a triage row. Creating
  deals for vendor pitches (even archived ones) pollutes search, counts,
  and agent context. The digest is the recovery path.
- **Confidence threshold defaults conservative (0.7)** and borderline cases
  land in the digest rather than auto-creating — a false "likely deal"
  Slack post costs founder trust faster than a missed one.
- **The human-touch override is absolute**: any manual edit permanently
  exempts a deal from auto-dismissal.
- **Closed-won accounts are customers, not pipeline**: calls/meetings
  with an account that has a closed-won deal never spawn a new deal and
  never attach to the won deal (both passes check via
  `findClosedWonDealForDomains` before doing anything). Post-close call
  logging is the Customer Success applet's job, later. (Closed-LOST
  accounts are different — that's Phase 2.5 re-engagement.)
- **Stub-post Slack posture** (revised per feedback): individual timed
  preview posts per key moment, each anchoring its own reply thread.
  Claimed channel of the deal owner; DM fallback when no claim.
