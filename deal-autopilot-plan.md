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

## Part 2 — the Slack deal thread (the deal's own feed)

One root post per deal in the owner's claimed channel when the deal is
born (auto-detected OR manually created):

> 🎯 **Likely new deal: Acme Corp** — "Acme <> Mesh — intro" on Thu 2:00pm
> with Priya Shah (VP Finance) + 2 others. Pre-call research is ready.
> _[Open deal] · [Pre-call plan] · [Practice] · [Not a deal?]_

Everything that happens to the deal afterward is a **reply in that thread**
(threads keep the channel clean; the root post becomes the deal's Slack
permalink, stored on the deal row):

- new meeting detected / attached
- pre-call research brief generated (link)
- post-meeting: transcript attached, analysis done → health + 2-line synopsis
- confirmation / dismissal verdicts (+ Undo)
- artifacts generated (Discovery Summary, deck link)
- stage changes, went-quiet nudges

**Inbound — the thread is a deal-scoped chat.** Any human reply in a deal
thread routes to the deal agent with the deal PINNED (thread_ts →
Deal.slackThreadTs lookup — deterministic, no name matching):
- "just talked to their CFO, she wants a security review before signing" →
  agent logs it via addTimelineEntry (its existing confirm-then-write rule)
  and answers in-thread.
- "what's my next move here?" → normal deal-agent answer, full context.
This reuses the deal-agent router wholesale; the only new piece is
resolving the deal from the thread instead of from fuzzy name match.

Noise controls: per-user setting for which events post (default: born,
confirmed/dismissed, analysis after new content, artifacts; NOT every
re-analysis); batching — multiple events within a few minutes collapse into
one reply; nothing posts for dismissed deals except the dismissal itself.

## Phasing

1. **Phase 1 — Pre-meeting triage + likely deals (L)**: DealTriage model +
   `likely` status; classifier + hook in the 5-min cron; auto-create with
   enrichment + research kickoff; Slack root post (announce-only, no thread
   replies yet) with Dismiss/Undo actions. Manual Validate/Dismiss stays for
   the recorder path (unchanged) — belt and suspenders while triage bakes.
2. **Phase 2 — Post-meeting confirmation (M)**: Pass-2 classifier in the
   recorder cron for likely deals AND as the replacement for
   create-potential; expiry + nudges; backfill existing potentials; retire
   Validate/Dismiss.
3. **Phase 3 — Deal thread, outbound (M)**: thread anchor columns, event
   replies (analysis, briefs, artifacts, stage changes), noise controls.
4. **Phase 4 — Deal thread, inbound (M)**: thread_ts → deal resolution in
   the Slack router; deal-scoped chat + activity capture in-thread.

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
- **Thread-first Slack posture**: one root post per deal, everything else
  threaded. Claimed channel of the deal owner; DM fallback when no claim.
