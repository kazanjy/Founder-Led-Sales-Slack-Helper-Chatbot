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
