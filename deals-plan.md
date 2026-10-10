# Deals Feature — Implementation Plan

## Overview

A Deal is a living timeline of engagement artifacts for a specific sales opportunity. Users add call transcripts/summaries, emails, screenshots (paste from clipboard for Slack/iMessage), notes, and account context over time. The system uses GPT-5.2 to synthesize a current state assessment, identify deal participants (enriched via PDL), and recommend next actions — all informed by the user's Sales Narrative and Sales Motion.

---

## Data Model

### Deal

```
Deal
├── id (cuid)
├── userId (FK → User)
├── name (String) — "Visana - Enterprise Deal"
├── companyName (String) — "Visana Health"
├── companyUrl (String?, nullable) — for PDL company enrichment
├── stage (String) — "prospecting" | "discovery" | "demo" | "proposal" | "negotiation" | "closing" | "won" | "lost"
├── status (String) — "active" | "stalled" | "closed_won" | "closed_lost"
├── notes (String?, text) — general deal notes
├── lastAnalysis (String?, text) — latest AI state assessment (JSON)
├── lastAnalyzedAt (DateTime?, nullable)
├── projectId (String?, FK → Project) — optional link to chat folder
├── participants → DealParticipant[]
├── entries → DealTimelineEntry[]
├── createdAt, updatedAt
```

### DealParticipant

```
DealParticipant
├── id (cuid)
├── dealId (FK → Deal)
├── name (String) — "Conrad Smith"
├── title (String?, nullable) — "VP Engineering"
├── company (String?, nullable)
├── email (String?, nullable)
├── linkedinUrl (String?, nullable)
├── role (String) — "champion" | "decision_maker" | "influencer" | "blocker" | "end_user" | "unknown"
├── pdlData (String?, text) — cached PDL enrichment JSON
├── pdlEnrichedAt (DateTime?, nullable)
├── notes (String?, text)
├── createdAt
```

### DealTimelineEntry

```
DealTimelineEntry
├── id (cuid)
├── dealId (FK → Deal)
├── type (String) — "call_transcript" | "call_summary" | "email" | "screenshot" | "note" | "linkedin" | "document"
├── title (String?, nullable) — "Discovery Call with Conrad"
├── content (String, text) — the actual content (transcript, email body, extracted text, notes)
├── sourceUrl (String?, nullable) — recording URL, email link, LinkedIn URL
├── metadata (String?, text) — JSON: { callType?, participants?, extractedFrom?, imageDescription?, etc. }
├── order (Int) — manual ordering within timeline
├── entryDate (DateTime) — when this engagement happened
├── createdAt
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/deals` | GET | List user's deals |
| `/api/deals` | POST | Create deal |
| `/api/deals/[id]` | GET | Deal detail with participants + entries |
| `/api/deals/[id]` | PATCH | Update deal (name, stage, status, notes) |
| `/api/deals/[id]` | DELETE | Delete deal |
| `/api/deals/[id]/entries` | POST | Add timeline entry (text, screenshot, etc.) |
| `/api/deals/[id]/entries/[entryId]` | PATCH/DELETE | Edit/remove entry |
| `/api/deals/[id]/participants` | POST | Add participant |
| `/api/deals/[id]/participants/[pid]` | PATCH/DELETE | Update/remove participant |
| `/api/deals/[id]/participants/[pid]/enrich` | POST | PDL enrich participant |
| `/api/deals/[id]/analyze` | POST | Run deal analysis (GPT-5.2) |

---

## Add Entry Input — Unified Drop Zone

The primary input for adding timeline entries supports multiple input methods in one component:

```
┌──────────────────────────────────────────────────┐
│  📎 Paste or drop screenshots, emails, or notes  │
│                                                   │
│  [Paste text or Cmd+V an image...]               │
│                                                   │
│  📷 Screenshot  📧 Email  📞 Call  📝 Note       │
└──────────────────────────────────────────────────┘
```

### Input Methods

| Method | Detection | Processing |
|--------|-----------|------------|
| **Cmd+V image** | `paste` event with `clipboardData.items` of type `image/*` | Send to GPT-4o vision → extract text → store as `screenshot` entry |
| **Drag & drop image** | `drop` event with image file | Same as paste |
| **Paste text** | `paste` event with text | Auto-detect: email (looks for subject/from/to), transcript, or note |
| **Type text** | User types directly | Manual note |
| **Quick-type buttons** | User clicks type button first | Sets explicit entry type before pasting/typing |

### Screenshot Flow

1. User copies screenshot from Slack/iMessage/email (Cmd+Shift+4 on Mac, etc.)
2. User pastes into the deal entry input (Cmd+V)
3. Image is immediately sent to `POST /api/vision/extract` (existing endpoint)
4. Extracted text shown as preview with "Looks like: [Slack message / Email / iMessage]"
5. User can edit the extracted text, set a title, adjust date
6. Click "Add" → saved as timeline entry with type `screenshot`
7. Image itself is NOT stored — only the extracted text (keeps context manageable)

### Call Import Flow (Meeting Recorder Integration)

Reuse the existing `MeetingRecorderPanel` component (already on Call Recap and Call Review pages) to let users import calls directly into a deal timeline.

**How it works on the deal detail page:**
1. `MeetingRecorderPanel` appears in the deal detail page alongside the unified entry input
2. Shows connected recording providers (Granola, Fireflies, Fathom) with recent calls
3. User clicks "Use This" on a call → fetches transcript + summary via `/api/meeting-recorder/calls/[callId]`
4. Creates a `DealTimelineEntry` with:
   - `type`: `"call_transcript"`
   - `title`: call title from provider (e.g., "Discovery Call with Visana")
   - `content`: full transcript
   - `sourceUrl`: provider's recording URL
   - `metadata`: JSON with `{ summary, participants, duration, provider, callType }`
   - `entryDate`: call date from provider
5. Participants from the call are auto-added as `DealParticipant` records (matched by name to avoid duplicates)

**Component reuse:**
- Same `MeetingRecorderPanel` component, same `onSelectCall` callback shape
- The deal page wraps the callback to create a timeline entry + participants instead of populating form fields
- No new API endpoints needed — uses existing `/api/meeting-recorder/connections` and `/api/meeting-recorder/calls`

**UI placement:**
```
┌──────────────────────────────────────────────────┐
│  📎 Paste or drop screenshots, emails, or notes  │
│  [Paste text or Cmd+V an image...]               │
│  📷 Screenshot  📧 Email  📞 Call  📝 Note       │
├──────────────────────────────────────────────────┤
│  🎙 Import from Recording                        │
│  ┌────────────────────────────────────────────┐  │
│  │ Apr 6 · Discovery Call                     │  │
│  │ Visana x Ember · 32m · 3 people [Use This] │  │
│  ├────────────────────────────────────────────┤  │
│  │ Apr 4 · Demo                               │  │
│  │ PartnerCare Review · 45m · 2     [Use This]│  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

---

## Deal Analysis

### Context Assembly

When user clicks "Analyze Deal", the system assembles:

1. All timeline entries (chronological)
2. All participants with roles and PDL data
3. User's Sales Narrative (latest, truncated to 3000 chars)
4. User's Sales Motion synthesis
5. Deal stage, status, and notes

### GPT-5.2 Response Structure

```json
{
  "stageAssessment": {
    "currentStage": "demo",
    "confidence": "high",
    "reasoning": "Completed discovery, demo scheduled for next week..."
  },
  "dealHealth": {
    "score": 72,
    "signals": [
      { "type": "positive", "text": "Champion actively pushing internally" },
      { "type": "risk", "text": "No access to economic buyer yet" },
      { "type": "neutral", "text": "Competitive evaluation in progress" }
    ]
  },
  "participantMap": {
    "identified": [
      { "name": "Conrad Smith", "inferredRole": "champion", "evidence": "Initiated all calls" }
    ],
    "missing": ["Economic buyer not yet identified"]
  },
  "nextActions": [
    { "priority": "high", "action": "Schedule multi-thread meeting...", "reasoning": "..." }
  ],
  "timeline": {
    "daysSinceFirstEngagement": 14,
    "daysSinceLastEngagement": 2,
    "engagementVelocity": "accelerating",
    "estimatedClose": "3-4 weeks"
  }
}
```

---

## UI Structure

### Deal List Page (`/deals`)

Card grid of active deals showing:
- Company name + deal name
- Stage badge (color-coded)
- Health score (0-100)
- Last activity date
- Participant count
- Filter by stage / status
- "New Deal" button

### Deal Detail Page (`/deals/[id]`)

```
┌────────────────────────────────────────────────┐
│ [Back]  Visana - Enterprise Deal    [Analyze]  │
│ Stage: Demo  ●●●○○○  Health: 72/100           │
├────────────────────────────────────────────────┤
│                                                │
│ ┌──────────┐  ┌──────────────────────────────┐ │
│ │Participants│ │ Timeline                     │ │
│ │           │  │                              │ │
│ │ Conrad S. │  │ Apr 6 — Discovery Call       │ │
│ │ Champion  │  │   transcript + summary       │ │
│ │ VP Eng    │  │                              │ │
│ │ [Enrich]  │  │ Apr 4 — Email thread         │ │
│ │           │  │   pricing discussion         │ │
│ │ Jodi M.   │  │                              │ │
│ │ Decision  │  │ Apr 2 — Slack screenshot     │ │
│ │ Maker     │  │   "Conrad says budget ok"    │ │
│ │           │  │                              │ │
│ │ [+ Add]   │  │ [📎 Paste/drop entry input] │ │
│ └──────────┘  └──────────────────────────────┘ │
│                                                │
│ ┌──────────────────────────────────────────────┐│
│ │ Deal Analysis                    [Refresh]  ││
│ │                                              ││
│ │ Stage: Demo (high confidence)                ││
│ │ Health: 72/100 — Accelerating                ││
│ │                                              ││
│ │ ✅ Champion actively pushing internally      ││
│ │ ⚠️  No access to economic buyer yet          ││
│ │                                              ││
│ │ Next Actions:                                ││
│ │ 1. Schedule multi-thread meeting...          ││
│ │ 2. Send case study...                        ││
│ └──────────────────────────────────────────────┘│
│                                                │
│ [Chat About This Deal]                         │
└────────────────────────────────────────────────┘
```

---

## Integration Points

| From | Action | Result |
|------|--------|--------|
| **Call Recap page** | "Add to Deal" button | Creates `call_summary` entry with recap email + transcript |
| **Call Review page** | "Add to Deal" button | Creates `call_transcript` entry with scores summary |
| **Chat page** | Three-dot menu → "Add to Deal" | Creates `note` entry with conversation context |
| **Projects** | Deal linked to Project via `projectId` | Groups deal-related chats |
| **Nav** | "Deals" in SalesNavBar | Under Call Execution or standalone |

---

## Key Design Decisions

- **User-scoped**: Deals belong to individual users (not account-scoped, for now)
- **Analysis is on-demand**: User clicks "Analyze" — not auto-running on every entry
- **PDL enrichment is per-participant**: User clicks "Enrich" to avoid burning API credits
- **Screenshots stored as extracted text**: GPT-4o extracts content, we store text only (not images)
- **Clipboard paste is the primary screenshot input**: Optimized for Cmd+V workflow
- **Deal stages are simple**: 8 stages matching common B2B sales flows
- **Timeline is append-mostly**: Entries rarely edited, mostly added chronologically

---

## Deal Creation Flow

The primary way to create a deal is by **pasting a call transcript/summary**. The system extracts company name, participants, and call type from the content to bootstrap the deal automatically. Users can also manually create a blank deal if they prefer.

**"New Deal from Call" flow:**
1. User clicks "New Deal" → shown a paste input: "Paste a call transcript or summary to get started"
2. User pastes transcript → AI extracts: company name, deal name suggestion, participant names, call type
3. System creates Deal + first DealTimelineEntry + DealParticipants in one step
4. User lands on the deal detail page, can edit the AI-suggested name/participants

---

## Implementation Staging

### Phase 1: Foundation (shippable)
1. DB models + migration — Deal, DealParticipant, DealTimelineEntry
2. Core API — CRUD for deals, entries, participants
3. Deal list page (`/deals`) — card grid, stage filters, "New Deal" button
4. Nav — add Deals to SalesNavBar

### Phase 2: Deal Detail + Timeline (shippable)
5. Deal detail page (`/deals/[id]`) — header with stage/health, timeline view, participants sidebar
6. Add entry input — unified paste/drop/type component
7. "New Deal from Call" flow — paste transcript → AI extracts company, participants, call type → creates deal + first entry in one step
8. Call import — reuse `MeetingRecorderPanel` on deal detail page to import calls from connected recorders (Granola, Fireflies, Fathom) as timeline entries with auto-created participants

### Phase 3: Intelligence (shippable)
8. Deal analysis — GPT-5.2 with context stuffing (Sales Narrative + Sales Motion)
9. PDL participant enrichment — reuse existing `src/lib/search/pdl.ts`
10. Screenshot paste — clipboard image → GPT-4o vision → text entry

### Phase 4: Cross-Feature Integration
11. "Add to Deal" from Call Recap — button on recap page
12. "Add to Deal" from Call Review — button on review page
13. "Chat About This Deal" — Chatbase conversation with deal context
14. Link to Projects — optional projectId association
9. **Cross-feature integration** — "Add to Deal" from call recap, call review, chat
10. **Nav integration** — add Deals to SalesNavBar

### Phase 5: Inline Deal Chat (v2)

Today "Chat About This Deal" opens a new Chatbase conversation in a separate tab, and the "Ask Mikey about this" field on the entry form also opens a new tab for the resulting conversation. That's functional but noisy — the user bounces between the deal page and the chat tab to reconcile analysis + conversation.

**Right-side chat panel on the deal detail page:**
- Collapsible right panel on `/deals/[id]` (slides in from the right edge, user can drag-resize the divider).
- Shows a full chat UI streaming Chatbase responses, pinned to the current deal's context.
- "Chat About This Deal" and the "Ask Mikey about this" field on entry commits open the panel instead of a new tab, with the user's question pre-filled as the first message.
- Panel persists across page navigation within the deal (collapsed state + conversation ID stored in URL query or local storage).
- Each deal can have multiple conversations; small dropdown at the top of the panel lets the user switch or start a new thread.

**Why v2, not v1:** requires lifting/embedding the existing chat streaming UI out of `/chat/[[...id]]/page.tsx` into a reusable component, plus state management for the panel, resize handle, and per-deal conversation list. Worth doing after we see whether users actually want the side-by-side view or are fine with tab-switching.

**Smaller intermediate step:** an overlay modal (not a side panel) on the deal page that shows just the chat thread — less layout work than a resizable panel, but loses the "glance between analysis and reply" benefit. Probably skip and go straight to the side panel.

### Phase 6: Background Meeting Scanner + Slack Notifications

Today new-call detection only runs when the user opens Mikey — the "catch me up" happens on visits to `/deals` or when they hit Deep Search in the meeting recorder panel. If a call happens overnight or between visits, there's no push. We want a recurring, user-passive loop that notices new calls in connected recorders, matches them to existing deals or flags them as new-deal candidates, and pings the user in Slack with actionable buttons.

**Hourly meeting scanner → Slack DM:**
- Vercel Cron job (`vercel.json` schedule) runs every hour, hitting `POST /api/cron/scan-meetings` with a shared `CRON_SECRET` header for auth.
- Handler iterates every active `MeetingRecorderConnection`, fetches calls newer than `lastSyncedAt` via the existing `provider.listCalls(apiKey, ...)` with `created_after` filter where supported, and matches each new call against the user's deals.
- Matches are scored by: (a) any attendee email-domain matching `deal.participants.company` or the inferred deal company domain, (b) attendee names matching existing `DealParticipant.name` (case-insensitive, tolerant of first-name-only vs full-name), (c) attendee appearing on a prior call already in the deal.
- For each new call:
  - **Match found → "New call for &lt;Deal&gt;" DM** with Slack blocks showing call title + date + attendees, plus buttons: `Add to <Deal>` · `Ignore`.
  - **External attendees, no deal match → "New call — create a deal?" DM** with buttons: `Create deal from this call` · `Ignore`.
- After the scan completes for a connection, bump `lastSyncedAt` so the next tick starts where we left off.
- Notify-only by default — no auto-writes to the timeline. The user taps the Slack button to commit. Revisit auto-commit once we see how the confidence scoring behaves in practice.

**Data model additions:**
```
NotifiedMeetingCall
├── id (cuid)
├── userId (FK → User)
├── provider (String) — "granola" | "fireflies" | "fathom"
├── providerCallId (String) — the recorder's call id, unique per provider
├── notifiedAt (DateTime)
├── action (String?, nullable) — "added_to_deal" | "created_deal" | "ignored" | null (pending)
├── dealId (String?, FK → Deal) — set when actioned
├── slackChannelId (String?, nullable)
├── slackMessageTs (String?, nullable) — so we can update/delete the DM after action
└── @@unique([userId, provider, providerCallId])
```
The unique constraint is the idempotency key — a call that stays unactioned across multiple hourly runs doesn't re-DM.

**Slack interaction handler:**
- Buttons POST to the existing Slack interactions endpoint (new `action_id` prefixes like `deal_scan_add`, `deal_scan_create`, `deal_scan_ignore`).
- Handler: verify signature, look up the `NotifiedMeetingCall` row via embedded metadata, fetch the call detail with the existing `provider.getCallDetail`, create the timeline entry (or the deal), update the row's `action` + `dealId`, update the original DM to show "Added to &lt;Deal&gt; ✓" instead of the buttons.

**Why phase 6, not baked into phase 2:** the matching + Slack roundtrip is its own UX loop and a second deployment surface (cron + interaction handler). Worth shipping after deal creation + timeline flows have settled so the "what's worth notifying about" bar is clear.

**Known open decisions:**
- **Confidence threshold for auto-commit**: start notify-only; if users overwhelmingly tap "Add to X" and never "Ignore" on high-confidence matches (domain + 2+ name hits), add an auto-commit path that still sends a "Added &lt;call&gt; to &lt;Deal&gt; — undo?" DM.
- **Delivery channel**: Slack DM first (we already have the infra). Email fallback for users without Slack is a follow-up.
- **Cadence**: hourly is the default. Recorders typically finish summaries ~10 min after a call ends, so hourly feels near-real-time. If quota costs bite or users complain of noise, drop to every 2–3 hours or make it user-configurable.
- **Quiet hours**: probably worth respecting user timezone and a default 10pm–8am quiet window before we ship — batch overnight notifications into a single morning digest.

### Phase 7: Slack-Side Deal Interactions

Phase 6 pushes notifications OUT to Slack. Phase 7 lets the conversation come back IN from Slack: a user can ask Mikey about a deal or drop a new asset onto one without leaving Slack or opening the web UI. Keeps the founder in-flow when something deal-relevant just landed in their DMs or a channel.

**Ask Mikey about a deal from Slack:**
- Extend the existing slash-command dispatcher (`src/lib/slack/commands.ts`) with something like `/mikey deal <deal-name-or-fragment> <question>`, or a sub-command under the existing `/mikey` surface if that's how the UX reads best.
- Deal resolution: fuzzy match `<fragment>` against the user's deals on `name` + `companyName`, case-insensitive substring + token-overlap score.
  - **Exact or clear single match** → build context server-side (same fields as `buildDealChatContext` — deal, participants, timeline sans chat breadcrumbs, latest analysis, sales narrative), send to Chatbase, post the reply in the thread or DM the command came from.
  - **Ambiguous (multiple plausible matches)** → reply with a block-kit picker listing the top 3. User taps one; original question re-runs.
  - **No match** → reply with "no deal matches '<fragment>'" + a "Create a new deal" button that either opens the `/deals` page in a browser or opens a modal to collect name/company inline.
- Slack user → Mikey user mapping reuses the existing coaching-thread plumbing (`Workspace.slackTeamId` + a Slack user id on `User`), so we already know whose deals to search.

**Add assets to a deal from Slack:**
- **Message shortcut "Add to Deal"** available on any message in any channel: when invoked, Mikey opens a modal with a deal picker (fuzzy resolver + recent deals at the top). Committing creates a timeline entry on that deal:
  - Message text → `content`
  - Message author → surfaced in `metadata` so the timeline entry shows "via Slack from @<author>"
  - Any attached files (images, PDFs) → downloaded server-side, routed through the existing `/api/vision/extract` for images or the PDF extraction path for PDFs, attached as a `screenshot` / `document` entry
- **Screenshot paste in DM with Mikey**: user pastes a Slack/SMS/email screenshot into a DM. Mikey replies in-thread with "which deal?" + a block-kit picker of the user's recent/active deals. On confirmation, the image goes through vision extraction and lands as a `screenshot` entry. The DM message itself becomes the entry's `title` context (e.g., "Slack DM from Conrad, Apr 22").
- **Natural-language shortcut** (v2): user DMs Mikey "add this to the Visana deal" with a screenshot; Mikey resolves the deal name inline (no modal) and creates the entry. Needs light intent classification — skip for v1.

**Data model**: none. Everything reuses existing endpoints and helpers — `/api/deals/[id]/entries`, `buildDealChatContext`, `/api/vision/extract`.

**Why phase 7, not baked into phase 6:** phase 6 is one-way (Mikey → Slack, notify). Phase 7 is two-way (Slack → Mikey, interact). Different Slack surface area entirely — slash commands, message shortcuts, file-upload handling, interaction payload handlers — and different auth surface: we need to authenticate the Slack user as a Mikey user before every action, whereas phase 6 is just sending to a known DM.

**Known open decisions:**
- **Command shape**: `/mikey deal <fragment> <question>` vs `/deal <fragment> <question>` as a new top-level command. Top-level reads cleaner in Slack but costs a slash-command registration.
- **Ambiguous match UX**: inline picker (current proposal) vs force the user to re-type with more specificity. Picker is more forgiving but adds block-kit work.
- **Deal context size**: Slack posts have a 40k-char limit per message (in blocks, smaller). If a deal's timeline is huge, we may need to truncate more aggressively than we do in the web panel, or split replies across messages.
- **Multi-file uploads**: if a user drops three screenshots in one message shortcut, do we create one entry with three images or three entries? Probably three entries so each gets its own vision extraction + participant attribution, but worth deciding.
- **Permissions**: a Slack user could theoretically try to add to a deal owned by a colleague. For now the fuzzy resolver is scoped to their own deals only. Shared-account deal access is a later call.

### Phase 8: Onboarding-Driven Deal Bootstrap + Closed-Deal Synthesis

A new user's first 10 minutes with Mikey today are mostly setup — connect things, fill out a sales narrative, then start the deal flow from scratch. They've already had dozens of sales calls recorded by the time they sign up. Phase 8 mines that history during onboarding so by the time they see the `/deals` board for the first time, it's pre-populated with their actual live deals, their sales narrative is filled in, and we've synthesized a sales motion + a "platonic" discovery call + a demo script from their closed-won deals.

**Onboarding wizard (multi-step, gates the first /deals visit):**

1. **Step 1 — Connect a call recorder.** Pull-in of `MeetingRecorderPanel`'s connect flow (Granola / Fireflies / Fathom / Google Meet). Skippable but skipping disables steps 3–5; users see a "you can connect later" link with a clear note that we won't be able to bootstrap their board.

2. **Step 2 — Sales narrative.** Embed the existing `/sales-narrative` flow. We need this for tone + ICP context anyway, and asking now (while the user is in setup mode) gets it done before they hit the deal board where it gets used.

3. **Step 3 — Live-deal detection + instantiation.** Pull the last 60 days of calls from the connected recorder via `provider.listCalls`. Cluster by external attendees' email domains (excluding free/internal domains) and by attendee-name overlap across calls. For each cluster of ≥1 call with external attendees, run an LLM classifier on the call titles + summaries: *"is this a sales conversation about a deal?"*. Surviving clusters are presented as "We found these potential live deals — pick which to import" with a one-tap accept-all. Each accepted cluster instantiates a `Deal` plus one `DealTimelineEntry` per call plus deduped `DealParticipant` records (same machinery the existing "New Deal from calls" flow uses). Auto-runs `analyzeDeal` per imported deal.

4. **Step 4 — Closed-deal detection.** Pull all available history from the recorder (subject to provider limits — Granola's public API only returns notes with summaries, so old un-summarized calls are invisible). Cluster the same way as step 3. For each cluster, two classifiers:
   - **Outcome classifier** (LLM on summaries): closed_won / closed_lost / stalled / unknown.
   - **Stage classifier per call** (LLM on title + summary): discovery / demo / proposal / negotiation / kickoff / other.
   Heuristic guardrails before spending on the model: a cluster needs ≥2 calls and a 30+ day gap between most-recent call and now (otherwise it's likely still a live deal, handled by step 3). Closed-won candidates are confirmed with the user before we write them — present as "We think these N deals closed won, this M closed lost — confirm or fix" with editable status per row. Confirmed closed deals get instantiated as `Deal` rows with `status: "closed_won" | "closed_lost"` and the same timeline + participant import.

5. **Step 5 — Synthesize sales motion + disco template + demo script from closed-won deals.** Three parallel synthesis passes, each fed the closed-won corpus:
   - **Sales motion** → reuses `/sales-motion/new`'s analyze flow, fed the merged closed-won timeline data instead of asking the user to write one from scratch. Output saved as the user's sales motion.
   - **Platonic discovery call** → take every call in closed-won deals classified as `discovery` (from step 4's stage classifier), concatenate transcripts, run a synthesis prompt: *"distill the structure these N successful discovery calls share — questions asked in what order, qualification frameworks, common objections + how this seller handled them."* Output: a structured markdown doc the user can edit, saved as a new `Asset` (or in the sales-asset library if a fitting model already exists).
   - **Demo script** → same as platonic disco but for `demo`-classified calls. Output: a section-by-section demo script (intro, problem framing, capability tour, pricing intro, close).

**Data model additions:**
- Probably none new for the deals/participants/entries side — reuses existing models.
- Maybe an `OnboardingProgress` model to track wizard step completion + idempotency on bootstrap (so a refresh mid-step-3 doesn't double-create deals):
```
OnboardingProgress
├── userId (PK, FK → User)
├── recorderConnected (Bool)
├── narrativeCompleted (Bool)
├── liveDealsImported (Bool)
├── closedDealsImported (Bool)
├── motionSynthesized (Bool)
├── discoTemplateSynthesized (Bool)
├── demoScriptSynthesized (Bool)
├── completedAt (DateTime?)
```
- Generated synthesis docs (platonic disco, demo script) probably belong in the existing sales-asset-library tables — confirm at scoping time.

**Why phase 8, not earlier:** the synthesis passes (steps 3–5) need stable deal models, the analyzer, the meeting-recorder providers, and the sales-narrative + sales-motion features all in place. None of those existed when we started; all do now. Onboarding is the natural moment to leverage them.

**Known open decisions:**
- **Cluster-grouping signal**: domain-only is too coarse (one customer = one cluster, but enterprise with multiple buying centers should split). Domain + attendee-overlap with a threshold is probably right, but the threshold needs empirical tuning on real call sets.
- **Classifier model choice**: cheap (haiku-class) is fast and ok for "is this a sales call?"; the disco/demo synthesis needs a deeper model. Spec the cheap classifier as a batched call (one prompt covering N candidate clusters) to keep cost down.
- **History depth per provider**: Granola only surfaces summarized notes (~last few months for most users); Fireflies/Fathom typically retain longer. Worth surfacing this in step 4's UI: *"Granola only goes back 90 days, so older deals may not appear here"*.
- **Confirmation UX vs auto-import**: I lean confirm-before-write for both step 3 and 4 — the cost of bad auto-import (deals you have to delete) is higher than the cost of one extra tap. Step 5 outputs are also presented as drafts the user reviews before they're saved.
- **Re-run path**: the wizard runs once at onboarding. But Phase 6's hourly scanner picks up new calls forever, so phase-8 logic doesn't need to re-run. The closed-deal synthesis (step 5) might benefit from a "regenerate from updated closed-won corpus" button later — out of scope for v1.
- **Skip path**: a user who doesn't connect a recorder still gets steps 2 (narrative) and a normal empty `/deals` board. Steps 3–5 just don't fire. The board's existing first-run "auto-open New Deal modal" affordance handles the empty state.
- **Privacy framing**: surfacing all-time call history requires a clear "Mikey will read your calls to build your deal board — here's what we look at, here's what we don't" disclosure on step 1. Probably a separate review with whoever owns the privacy posture.

---

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Deal, DealParticipant, DealTimelineEntry models |
| `src/app/deals/page.tsx` | Deal list page |
| `src/app/deals/[id]/page.tsx` | Deal detail page |
| `src/components/DealEntryInput.tsx` | Unified paste/drop/type input component |
| `src/app/api/deals/route.ts` | List + create deals |
| `src/app/api/deals/[id]/route.ts` | Detail + update + delete |
| `src/app/api/deals/[id]/entries/route.ts` | Add timeline entry |
| `src/app/api/deals/[id]/participants/route.ts` | Add participant |
| `src/app/api/deals/[id]/participants/[pid]/enrich/route.ts` | PDL enrichment |
| `src/app/api/deals/[id]/analyze/route.ts` | GPT-5.2 deal analysis |
| `src/lib/search/pdl.ts` | Existing PDL integration (reuse) |
| `src/app/api/vision/extract/route.ts` | Existing vision extraction (reuse) |
| `vercel.json` | Cron schedule for `/api/cron/scan-meetings` (phase 6) |
| `src/app/api/cron/scan-meetings/route.ts` | Hourly scanner → Slack DM (phase 6) |
| `src/lib/slack/client.ts` | Existing Slack poster (reuse for notification blocks) |
| `src/lib/slack/commands.ts` | Existing slash-command dispatcher — extend with `/mikey deal` (phase 7) |
| `src/app/api/slack/interactions/route.ts` | Existing Slack interactions handler — extend for message shortcut + modal submit (phase 7) |
| `src/app/onboarding/page.tsx` | Multi-step wizard (phase 8) |
| `src/app/api/onboarding/bootstrap-deals/route.ts` | Cluster + classify recent calls → propose live deals (phase 8 step 3) |
| `src/app/api/onboarding/detect-closed-deals/route.ts` | Cluster + outcome-classify historical calls (phase 8 step 4) |
| `src/app/api/onboarding/synthesize-templates/route.ts` | Sales motion + platonic disco + demo script generation (phase 8 step 5) |
| `src/app/sales-motion/new/page.tsx` | Existing sales-motion analyze flow — reused as a synthesis target (phase 8) |
| `src/app/sales-narrative/page.tsx` | Existing sales-narrative flow — embedded in onboarding step 2 |
