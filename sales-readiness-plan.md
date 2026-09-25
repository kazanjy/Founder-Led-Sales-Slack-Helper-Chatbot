# Sales Readiness Checklist — Implementation Plan

## Overview

A persistent, account-scoped checklist of sales capabilities and assets organized by **Maturity Stage** and **Capability Category**. Each item starts as "to_do" and founders progress through them over time. Unlike coaching goals (session-scoped), this is a **global checklist** that tracks the company's overall sales readiness.

## Data Model

### Template Table (global, same for all users)

```prisma
model SalesReadinessItem {
  id    String @id @default(cuid())

  maturityStage      String   // "PROBLEM_VALIDATION", "WILL_SOMEONE_PAY", etc.
  capabilityCategory String   // "MVP Inbound", "Sales First Call", "Inbound Process"
  title              String   // "Demo Request Calendar Automation"
  description        String?  @db.Text  // optional longer description of what this means
  order              Int      @default(0)

  accountItems SalesReadinessAccountItem[]

  @@index([maturityStage])
  @@map("sales_readiness_items")
}
```

### Account Progress Table (per-account status + notes)

```prisma
model SalesReadinessAccountItem {
  id String @id @default(cuid())

  accountId String
  account   Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  itemId String
  item   SalesReadinessItem @relation(fields: [itemId], references: [id], onDelete: Cascade)

  status          String    @default("to_do")  // "to_do" | "done" | "up_next" | "not_doing" | "deferred"
  statusChangedAt DateTime?
  statusChangedBy String?   // userId of who last changed status
  completedAt     DateTime?
  notes           String?   @db.Text  // proof, links, notes entered by user

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([accountId, itemId])
  @@index([accountId])
  @@map("sales_readiness_account_items")
}
```

### Key Design Decisions

1. **Account-scoped, not user-scoped** — progress belongs to the company (account), not individual users. All team members on the same account see the same checklist state.

2. **Track who made changes** — `statusChangedBy` records the userId of whoever last changed the status, providing accountability and audit trail.

3. **Template + Progress (two tables)** — `SalesReadinessItem` is the global template (seeded from the spreadsheet, same for everyone). `SalesReadinessAccountItem` is created per-account on first interaction. New items added to the template automatically appear for all accounts.

4. **Notes field** — free text for proof, evidence, links. Editable at any time. Useful for recording "here's where we set this up" or "see this doc."

## Status Flow

```
to_do ──→ up_next ──→ in_progress ──→ done (with optional notes/proof)
  │          │              │
  ├──→ deferred (revisit later, pushed back)
  │
  └──→ not_doing (explicitly skipped, won't do)
```

### Status Definitions
- **To Do** `○` gray — not started, default state
- **Up Next** `⏭` purple — actively working on or prioritized for next
- **In Progress** `🔨` blue — partially done, more work needed
- **Done** `✅` green — completed, with completion date recorded
- **Deferred** `⏸` amber — acknowledged but pushing to later
- **Not Doing** `✗` gray strikethrough — explicitly decided not to do

## GTM Assessment Integration (Auto-Status)

### Concept

When a user completes the GTM Maturity Assessment questionnaire, Mikey analyzes their answers and automatically updates the Sales Readiness Checklist items based on what they describe.

### How It Works

1. **User completes GTM Assessment** — answers questions about their current sales setup, tools, processes, etc.

2. **Mikey analyzes each answer** — for each assessment question that maps to a readiness capability, Mikey makes a judgment:
   - **"Done"** — the user's answer clearly describes having this capability in place and working
   - **"In Progress"** — the user describes partial implementation or work underway
   - **"Not started"** — no mention of this capability, or explicitly says they don't have it

3. **Auto-update readiness items** — Mikey updates the matching `SalesReadinessAccountItem` records:
   - Sets `status` to `done`, `in_progress`, or leaves as `to_do`
   - Sets `statusChangedBy` to "mikey-auto" (or the user's ID)
   - Adds a note like "Auto-assessed from GTM Assessment: [relevant excerpt from answer]"
   - Does NOT override items the user has manually set (respects manual overrides)

### Mapping: Assessment Questions → Readiness Items

Each GTM Assessment question can map to one or more readiness items. Examples:

| Assessment Question | Maps To |
|---|---|
| "Do you have a CRM?" | MVP Tech Stack → Basic CRM |
| "How do you handle inbound demos?" | MVP Inbound → Demo Request Calendar Automation, Internal Notifications |
| "Do you have discovery questions documented?" | Sales First Call → Discovery Questions |
| "What's your sales narrative?" | Market Opportunity Hypothesis → Sales Narrative |
| "How do you onboard new customers?" | MVP Customer Success → Onboarding Checklist, Onboarding Deck |

### Implementation

1. **Create mapping table** — define which assessment questions map to which readiness items (can be JSON config or a DB table)

2. **Post-assessment hook** — after the GTM Assessment is completed, trigger the analysis:
   ```
   POST /api/sales-readiness/auto-assess
   Body: { assessmentId: string }
   ```

3. **LLM analysis** — send each relevant answer + the mapped capability description to GPT with a prompt:
   ```
   Based on this user's answer about their sales setup, determine if they have
   this capability: "[capability title]"
   
   Their answer: "[assessment answer text]"
   
   Respond with:
   - status: "done" | "in_progress" | "to_do"
   - confidence: "high" | "medium" | "low"
   - excerpt: a brief quote from their answer that supports your judgment
   ```

4. **Apply results** — update readiness items where confidence is medium or high, skip low confidence, never override manual user changes

### UX

- After assessment completion, show a banner: "Mikey updated 8 items on your Sales Readiness Checklist based on your assessment"
- Auto-assessed items show a note: "🤖 Auto-assessed from GTM Assessment"
- User can always override Mikey's judgment by changing the status manually

## Maturity Stages (from existing system)

| Key | Stage Name | Question |
|-----|-----------|----------|
| PROBLEM_VALIDATION | Problem Validation | Do we know what problem we're solving? |
| VALUE_VALIDATION | Value Validation | Does the product solve the problem and create value? |
| FIRST_REVENUE | First Revenue | Can we get someone to pay for the product? |
| REPEATABLE_REVENUE | Repeatable Revenue | Can we get many people to pay for the product? |
| FIRST_SALES_HIRE | First Sales Hire | Can we get someone other than the founder to sell? |
| SCALING_SALES | Scaling Sales | Can we get many people other than the founder to sell? |

## Seed Data (from spreadsheet)

Items are organized by maturity stage and capability category. Example for "Will Someone Pay" stage:

### MVP Inbound
- Inbound Basics & Audit Inbound
- Demo Request Button Well Placed
- Demo Request Calendar Automation
- Demo Request Internal Notifications & Response
- Demo Request form qualification criteria & routing
- Demo Request Prospect Facing auto-email
- Demo Request Outbound Multi-thread

### Inbound Process
- Meeting Invite Format
- Website De-anonymize & alert & action
- Website De-anonymize automated action
- Recorded Demo Video Collateral

### MVP Inbound (User Table)
- User Table Signup Internal Alerting
- User Table Automatic Email
- User Table Backlog Enrich & Triage
- User Table Backlog Outbound
- User Table Signup Auto-Email With Content
- User Table Outbound Multi-thread

### Sales First Call
- Are you properly blocking calendar for prep and follow up?
- Call Execution Setup (Second monitor)
- Headphones
- Pre-Call Planning Checklist
- Rapport & Agenda Set Approach
- Elevator Pitch
- Discovery Questions
- First Call Checklist
- Sales Deck
- Demo Outline / Script
- Pricing
- Next Steps / Sales Motion Map

*(Additional stages and categories to be added from full spreadsheet)*

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/sales-readiness` | Get all items with account's progress, grouped by stage/category |
| PATCH | `/api/sales-readiness/[itemId]` | Update status and/or notes for an item (records who changed it) |
| GET | `/api/sales-readiness/progress` | Get summary stats (X/Y done per stage, overall %) |
| POST | `/api/admin/sales-readiness/seed` | Admin: seed or update template items from JSON |

### GET `/api/sales-readiness` Response

```json
{
  "stages": [
    {
      "key": "WILL_SOMEONE_PAY",
      "label": "Will Someone Pay",
      "categories": [
        {
          "name": "MVP Inbound",
          "items": [
            {
              "id": "item_abc",
              "title": "Demo Request Calendar Automation",
              "description": null,
              "status": "done",
              "statusChangedAt": "2026-03-15T...",
              "statusChangedByName": "Pete Kazanjy",
              "completedAt": "2026-03-15T...",
              "notes": "Set up in Calendly, connected to HubSpot"
            },
            {
              "id": "item_def",
              "title": "Demo Request Internal Notifications",
              "status": "to_do",
              "notes": null
            }
          ],
          "doneCount": 3,
          "totalCount": 7
        }
      ],
      "doneCount": 8,
      "totalCount": 24
    }
  ],
  "overall": {
    "done": 12,
    "upNext": 5,
    "deferred": 3,
    "notDoing": 2,
    "total": 47
  }
}
```

### PATCH `/api/sales-readiness/[itemId]` Request

```json
{
  "status": "done",
  "notes": "Set up in Calendly, connected to HubSpot workflow"
}
```

Records `statusChangedBy` from the authenticated user automatically.

## UI Design

### Page Layout

```
Sales Readiness Checklist
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Overall Progress: 12/47 done · 5 up next · 3 deferred
[████████░░░░░░░░░░░░] 26%

Filter: [All] [To Do] [Up Next] [Done] [Deferred] [Not Doing]

▼ Stage 2: Will Someone Pay ← (current stage, auto-expanded)
  
  ┌─ MVP Inbound (3/8 done) ─────────────────────────────────
  │
  │  ✅  Inbound Basics & Audit Inbound
  │      Done Mar 15 by Pete · "Audited with Chilipiper"
  │
  │  ✅  Demo Request Button Well Placed
  │      Done Mar 18 by Pete
  │
  │  ⏭  Demo Request Calendar Automation
  │      Up Next · [Add notes...]
  │
  │  ○   Demo Request Internal Notifications        [To Do ▾]
  │  ○   Demo Request form qualification             [To Do ▾]
  │  ○   Demo Request Prospect Facing auto-email     [To Do ▾]
  │  ○   Demo Request Outbound Multi-thread          [To Do ▾]
  │
  ├─ Inbound Process (0/4 done) ─────────────────────────────
  │
  │  ○   Meeting Invite Format                       [To Do ▾]
  │  ○   Website De-anonymize & alert                [To Do ▾]
  │  ...
  │
  └─ Sales First Call (2/13 done) ───────────────────────────
  
     ✅  Elevator Pitch
         Done Mar 20 by Charlene · "Refined in narrative"
     
     ✅  Discovery Questions
         Done Mar 22 by Pete · → View in MikeyBot
     
     ⏭  First Call Checklist
         Up Next · → Generate in MikeyBot
     
     ○   Sales Deck                                  [To Do ▾]
     ...

▶ Stage 3: Repeatable Revenue (collapsed, 0/15 done)
▶ Stage 4: First Sales Hire (collapsed, 0/20 done)
```

### Item Interaction

Each item has:
- **Status dropdown** — To Do / Up Next / Done / Deferred / Not Doing
- **Notes textarea** — click to expand, auto-save with debounce
- **Completion info** — "Done Mar 15 by Pete" (date + who changed it)
- **MikeyBot link** — for items that map to applets (Discovery Questions, Sales Deck, etc.), show a "→ View in MikeyBot" or "→ Generate in MikeyBot" CTA

### Status Colors & Icons
- `○` **To Do** — `bg-gray-100 text-gray-600`
- `⏭` **Up Next** — `bg-purple-100 text-purple-700`
- `✅` **Done** — `bg-green-100 text-green-700`
- `⏸` **Deferred** — `bg-amber-100 text-amber-700`
- `✗` **Not Doing** — `bg-gray-100 text-gray-400 line-through`

## Integration Points

### 1. Maturity Stage (Coaching Module)
- Auto-expand the stage matching the user's current maturity stage setting
- If no maturity stage set, prompt user to set one

### 2. MikeyBot Applet Links
Items that correspond to existing applets get automatic CTAs:
- "Discovery Questions" → link to `/discovery-questions`
- "First Call Checklist" → link to `/first-call-checklist`
- "Sales Deck" → link to `/sales-deck`
- "Elevator Pitch" → link to `/sales-narrative` (50-word version)
- "Pricing" → could link to future pricing applet
- "Pre-Call Planning Checklist" → link to `/pre-call-planning`

### 3. Auto-Complete Detection
When a user generates content in a linked applet, optionally auto-mark the corresponding readiness item as "done" with a note like "Generated via MikeyBot on Mar 22."

### 4. Coaching Chat Context
Include readiness progress in the coaching chat context:
```
## Sales Readiness: 12/47 done (26%)
- Will Someone Pay: 8/24 done
  - Up Next: Demo Request Calendar Automation, First Call Checklist
  - Recently Done: Elevator Pitch, Discovery Questions
```

### 5. Navigation
- Add "Readiness" to the main nav bar (under Coaching or as its own item)
- Or embed as a tab within the Coaching page

## Implementation Phases

### Phase 1: Schema + Seed + API
- Add Prisma models
- Create migration SQL
- Build seed script with items from spreadsheet
- Build GET and PATCH API routes
- Add User relation for `statusChangedBy`

### Phase 2: UI
- New page at `/sales-readiness`
- Collapsible stage sections with category sub-groups
- Status dropdown per item with instant save
- Notes textarea with debounced auto-save
- Progress bars per stage and overall
- Filter chips (All / To Do / Up Next / Done / Deferred / Not Doing)
- "Changed by [name] on [date]" attribution

### Phase 3: Polish + Integrations
- Auto-expand current maturity stage
- MikeyBot applet CTAs on matching items
- Auto-complete detection from applet usage
- Include in coaching chat context
- Add to admin dashboard activity feed
- Sidebar ad card CTA on relevant pages
