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
(candidate + "interview"), internal-only domains. Below a confidence
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
- **"📋 New Pre-Call Plan"** — posted **~2 hours before a meeting** on an
  in-play deal: auto-generated pre-call brief preview (attendee readout +
  top objectives) with links to the full plan and 🥊 practice.
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
   record their ts); "📋 New Pre-Call Plan" at T-2h (rides the 5-min
   cron; generates the brief — synopsis + top objectives + watchout —
   with links to the deal and 🥊 live-fire practice); "🧠 Updated Deal
   Analysis" after the recorder cron's analysis cascade (health pill
   with before→after, first-paragraph synopsis; replaces the legacy
   "meeting added" DM; a cooldown-skipped re-analysis posts a one-line
   "call attached" note instead); the deferred 7-day no-recording nudge
   (one per likely deal, ever; 14-day lookback floor so it never
   overlaps the 21-day expiry).
5. **Phase 4 — Inbound stub threads (M)**: reply-under-stub → deal-agent
   routing with the deal pinned; activity capture in-thread.

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
