# Customer Success Applet — Design Plan

## Overview

A Customer is a closed-won Deal that grew up. The Customer Success applet houses everything that happens after the deal closes: the outcome data, the ongoing call recordings, the people involved (both who originally bought and who's there now), goals against the "why they bought" promise, and the renewal motion. Mikey treats each Customer as a long-lived record with its own per-account agent, its own pipeline of expansion opportunities, and its own QBR / outcome / renewal lifecycle.

Architecturally the cleanest framing is: **a Customer record inherits from a closed-won Deal**. The narrative, contacts, call timeline, and "why they bought" carry forward and become the founding context of the customer relationship.

---

## Biggest design lever — decide first

**Standalone applet vs. post-close view of Deals.**

- **Standalone (`/customers`)** — separate nav, separate models (`Customer`, `CustomerTimelineEntry`, etc.), separate routes. Cleaner CS-specific views and metrics. More code.
- **Post-close view of Deals** — same `Deal` record, the UI flips into "customer mode" when `status = closed_won`. Founder stays in one mental model. Naturally inherits the timeline + participants + analysis. Less code, less powerful.

**Recommendation:** start as a post-close view of Deals. Once a founder has > ~50 active customer relationships with their own lifecycle data outweighing the deal data, split it into a standalone applet. The migration is cheap because the data is already in `Deal` and its related tables.

---

## What carries over from Deals (free with the post-close-view approach)

- **Timeline of interactions** — calls, emails, meetings, notes. Same `DealTimelineEntry` shape; just keep appending after close.
- **Participants** — but with role-evolution tagging: sponsor / champion / decision-maker / detractor / new-to-account / departed.
- **Recorder integration** — Granola / Fathom / Fireflies / Circleback all keep feeding the same record.
- **Per-customer chat agent** — the existing deal agent's tools (`getDealCore`, `getRecentActivity`, `getCallDetail`, `getParticipants`, `getHealthAndRisks`, `getUpcomingMeetings`, `summarizeCall`, `draftFollowUpEmail`, `addTimelineEntry`) keep working. New CS-specific tools layer on top.
- **Pipeline-level views** — at-risk, renewing, expansion candidates (mirror the deal pipeline tools).

---

## What carries over from Coaching

- **Goals + tasks**, oriented at customer outcomes ("Get rollout to West Coast team by Q1") rather than founder development. Same `CoachingGoal` / `CoachingTask` shape, just keyed off the customer instead of a coaching session.
- **Metrics**, but account-level: usage, ARR contribution, NPS, support tickets, login frequency, feature adoption.
- **Sessions** = QBRs and status calls. Synthesis ("what was discussed / what's at risk / what's next") reuses the coaching agent's `summarizeCoachingSession` directive shape.

---

## What's genuinely new — the parts neither applet has

### 1. "Why they bought" as a pinned reference

- Captured at deal-close from the deal's `lastAnalysis` (Mikey's prior synthesis already names this).
- Editable as you learn more post-sale (people misremember, priorities shift).
- Pinned on every customer view so it's always visible during a call.
- The agent compares stated reasons against recent activity / outcomes to flag drift ("you bought us for X — we haven't talked about X in 90 days").

### 2. Renewal clock

- Explicit T-minus countdown that drives prioritization.
- Once inside the renewal window (configurable; default 90/60/30-day signals), every interaction is colored by it.
- The renewal date is the central forcing function — every CS goal/task ladders up to "what we need true before renewal day."

### 3. Outcome verification

- Structured "We promised X / We delivered X" tracking.
- Each "why they bought" reason gets a corresponding outcome record with status: not-started / in-progress / delivered / at-risk / missed.
- Surfaced in QBR prep automatically.
- The Mikey agent has a dedicated tool: "Are we delivering on why they bought?"

### 4. Expansion sub-pipeline

- New `Deal` records nested under the customer (renewal opportunities, cross-sell, multi-team expansion).
- One customer → many child deals over time.
- Each child deal still gets the full deal-applet treatment (own analysis, own agent, own participants), just rolled up under the parent customer.

### 5. Account brief

- A generated one-page rollup: "read this before your call with Acme."
- Blends stakeholder map + outcome status + recent activity + open risks + upcoming meetings.
- Generated on demand by the agent (new tool: `generateAccountBrief`).
- The CS equivalent of `summarizeCall` — a synthesis primitive specific to "what does the founder need to know walking in?"

### 6. Sentiment trend

- Derived from meeting transcripts over time (not a single snapshot).
- Surfaced as a sparkline alongside health: "sentiment trending down across the last 4 meetings."
- Pulls from existing transcript pipeline; just runs a sentiment classifier per call and aggregates.

### 7. Stakeholder evolution map

- More structured than `DealParticipant`. Each contact carries:
  - Role tag (sponsor / champion / decision-maker / detractor / new / departed)
  - First-touched date
  - Last-touched date
  - "Strength" (low / medium / strong relationship)
- Surfaces "who haven't I talked to in 90 days?" and "who's new and unmapped?"

---

## Customer-specific agent surface

New tools the per-customer agent should have on top of the deal-agent inheritance:

- `getCustomerOutcomeStatus({ customerId })` — returns the "why they bought" reasons paired with their delivered status.
- `compareOutcomesToReasons({ customerId })` — explicit drift check; surfaces which reasons haven't been mentioned in recent calls.
- `generateAccountBrief({ customerId, audience })` — one-pager for an upcoming call.
- `getRenewalRisk({ customerId })` — composite signal: days-to-renewal + sentiment trend + open-risk count + stakeholder gaps + outcome miss rate.
- `getStakeholderMap({ customerId })` — current cast with role tags, last-touched dates, strength scores.
- `findStakeholderGaps({ customerId })` — who's missing, who hasn't engaged, who's new and unmapped.

Cross-customer (pipeline-level) tools:

- `listAtRiskCustomers()` — book-of-business risk audit.
- `listUpcomingRenewals({ horizonDays })` — renewal countdown across all customers.
- `listExpansionOpportunities()` — surfaces customers with strong sentiment + low ARR contribution as candidates.

---

## Data model (when we split off into standalone)

Minimal additive schema layered on top of `Deal`:

```
model Customer {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(...)
  originatingDealId String? @unique  // the closed-won Deal that became this Customer
  originatingDeal   Deal?   @relation(...)

  // Lifecycle
  customerSince     DateTime
  renewalDate       DateTime?
  status            String   // "active" | "at_risk" | "churned" | "expanded"
  arr               Int?
  csmOwnerUserId    String?  // who at the founder's team owns this

  // Promise
  whyTheyBought   String? @db.Text  // editable, carried over from deal close
  outcomes        CustomerOutcome[] // structured promise/delivery records

  goals           CustomerGoal[]    // mirrors CoachingGoal
  stakeholders    CustomerStakeholder[]
  childDeals      Deal[]            // expansion / renewal opportunities

  // Inherited from Deal but kept here for performance
  health          String?  // "good" | "fair" | "at_risk" | "critical"
  sentimentScore  Float?
  lastSentimentAt DateTime?
}

model CustomerOutcome {
  id            String   @id @default(cuid())
  customerId    String
  customer      Customer @relation(...)
  reason        String   @db.Text  // "Wanted to consolidate vendor sprawl"
  status        String   // "not_started" | "in_progress" | "delivered" | "at_risk" | "missed"
  evidence      String?  @db.Text  // supporting notes / call refs
  updatedAt     DateTime @updatedAt
}

model CustomerStakeholder {
  id              String   @id @default(cuid())
  customerId      String
  customer        Customer @relation(...)
  name            String
  email           String?
  roleTag         String   // "sponsor" | "champion" | "decision_maker" | "detractor" | "new" | "departed"
  strength        String   @default("medium")  // "low" | "medium" | "strong"
  firstTouchedAt  DateTime?
  lastTouchedAt   DateTime?
  notes           String?  @db.Text
}

// CustomerGoal + CustomerTask mirror CoachingGoal / CoachingTask — same shape,
// keyed off customer instead of session.
```

The `DealTimelineEntry` stays — every call/email/meeting after close lands there on the `originatingDealId` or on a `childDeal`. We don't duplicate the timeline.

---

## Mikey integration points

- **Slack routing** — a fourth router after deal / coaching / GTM: customer-name match → customer agent. Falls through if no customer name matches (so the existing chain still handles non-customer questions).
- **`getFullAccountContext` extension** — already loads narrative + maturity + coaching corpus + metrics. Should also load customer-list summary so "what's going on with our customers?" works as a strategic question.
- **Deep links** — customer pages need links in agent replies, same pattern as deals (`/customers/<id>` or `/deals/<id>` in post-close-view mode).

---

## Phasing

**Phase 1 — Post-close view of Deals (no schema change):**
- Add a "Customer" badge + tab to the existing deal page when `status = closed_won`.
- "Why they bought" pinned card — sourced from `Deal.lastAnalysis`, editable, stored in `Deal.notes` or a new `Deal.whyTheyBought` field.
- Renewal date field on Deal (`renewalDate DateTime?`) + countdown widget.
- One new agent tool: `getCustomerOutcomeStatus` (works off `Deal.whyTheyBought` + manual outcome notes).
- Single new pipeline view: at-risk customers (filter on `status = closed_won` + Mikey-health signals).

**Phase 2 — Outcomes + stakeholder evolution:**
- `CustomerOutcome` table + UI.
- Stakeholder role tagging on existing `DealParticipant` (additive column).
- Account brief tool.

**Phase 3 — Split off into standalone applet:**
- `Customer` table, migration that links each closed-won deal to its new customer row.
- Goals + tasks (mirror coaching).
- Expansion sub-pipeline (child deals under customer).
- Sentiment trend.
- Full customer-pipeline tools (at-risk, renewing, expansion candidates).

Phase 1 is ~2-3 days of work and unlocks the most value (the "why they bought" reference + renewal clock). Don't ship Phase 3 until Phase 1's UX has been used in anger.
