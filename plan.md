# Objection Library Applet — Implementation Plan

**STATUS: COMPLETED**

## Overview

New applet at `/objection-library` that helps founders build, manage, and practice a library of objection handles organized by category and persona. Follows the same architecture as existing applets (Email Sequence, Ad Creator, etc.) with Chatbase API for generation and a new per-entry CRUD pattern.

The library is **per-persona** — the same objection text aimed at different personas gets separate entries with tailored handles. Bootstrap generates 8-10 product/ROI-focused objections from the user's sales narrative.

---

## 1. Objection Categories (9 total)

| # | Category Key | Display Name | Description |
|---|---|---|---|
| 1 | `need` | Need & Problem Recognition | "Do I actually have this problem?" |
| 2 | `priority` | Priority & Urgency | "Is this worth solving now vs. other things?" |
| 3 | `roi` | ROI & Value Justification | "Can I justify the spend with concrete returns?" |
| 4 | `product` | Product Fit & Capabilities | "Does this product solve my problem well enough?" |
| 5 | `competition` | Competition & Alternatives | "Is this the best option, including build-vs-buy?" |
| 6 | `adoption` | Adoption & Implementation | "Will my team actually use this? Can we make the switch?" |
| 7 | `budget` | Price & Budget | "Can I afford this / is it priced fairly?" |
| 8 | `trust` | Trust & Vendor Risk | "Can I trust this company to deliver and survive?" |
| 9 | `authority` | Authority & Process | "Can I actually get this approved internally?" |

These are stored as an enum in the schema and as a constant lookup in the frontend.

---

## 2. Database: Prisma Schema

### New model: `ObjectionEntry`

```
model ObjectionEntry {
  id              String   @id @default(cuid())

  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // What the prospect says
  objection       String   @db.Text

  // Category (enum)
  category        ObjectionCategory

  // Target persona this handle is tailored for
  orgPersona      String   @db.Text
  humanPersona    String   @db.Text

  // The handle (how to respond)
  handle          String   @db.Text

  // Optional notes, context, or examples
  notes           String?  @db.Text

  // Where it came from
  source          String   @default("bootstrap")  // "bootstrap" | "manual" | "call-review" | "chat"

  // Linked chat thread for iteration
  conversationId  String?

  // Sort within category
  sortOrder       Int      @default(0)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId, category])
  @@index([userId, createdAt])
  @@map("objection_entries")
}

enum ObjectionCategory {
  NEED
  PRIORITY
  ROI
  PRODUCT
  COMPETITION
  ADOPTION
  BUDGET
  TRUST
  AUTHORITY
}
```

### New model: `ObjectionBootstrap`

Tracks each bootstrap generation run (like SalesNarrativeVersion tracks narrative versions).

```
model ObjectionBootstrap {
  id                      String   @id @default(cuid())

  userId                  String
  user                    User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // The sales narrative used as input
  salesNarrativeVersionId String
  salesNarrativeVersion   SalesNarrativeVersion @relation(fields: [salesNarrativeVersionId], references: [id], onDelete: Cascade)

  // Persona configuration
  orgPersona              String   @db.Text
  humanPersona            String   @db.Text

  // How many entries were generated
  entryCount              Int

  createdAt               DateTime @default(now())

  @@index([userId, createdAt])
  @@map("objection_bootstraps")
}
```

### User model additions

```
objectionEntries          ObjectionEntry[]
objectionBootstraps       ObjectionBootstrap[]
```

### SalesNarrativeVersion addition

```
objectionBootstraps       ObjectionBootstrap[]
```

---

## 3. API Routes

All under `/src/app/api/objection-library/`:

### `bootstrap/route.ts` (POST)
**Bootstrap generation — creates 8-10 objection entries from sales narrative.**

- Accepts: `{ orgPersona, humanPersona }`
- Fetches latest `SalesNarrativeVersion`
- Builds prompt asking for 8-10 objections focused on **product, ROI, adoption, competition, and trust** categories
- Sends to Chatbase API (with chunking if context is large)
- Parses structured JSON response → creates `ObjectionEntry` rows in bulk
- Creates `ObjectionBootstrap` record
- Returns the new entries

**AI prompt instructs:**
- Generate 8-10 common objections a founder selling this product would hear
- Each objection must include: `objection`, `category`, `handle` (the response)
- Focus on product fit, ROI/value, adoption, competition, and trust categories
- Handles should be specific to the product (not generic sales advice)
- Return as JSON array

### `entries/route.ts` (GET + POST)
- **GET**: List all entries for current user, with optional `?category=` and `?persona=` filters
- **POST**: Create a new manual entry — `{ objection, category, handle, orgPersona, humanPersona, notes? }`

### `entries/[id]/route.ts` (GET + PATCH + DELETE)
- **GET**: Single entry by ID
- **PATCH**: Update objection, handle, category, notes, sortOrder
- **DELETE**: Remove entry

### `match/route.ts` (POST)
**Hybrid search — find the best matching objection handle for a given prospect objection.**

- Accepts: `{ objection, orgPersona?, humanPersona? }`
- **Step 1 — Text match**: Case-insensitive substring/keyword search across stored objections for the user
- **Step 2 — Semantic match** (if no confident text hit): Send the prospect's objection + all stored objections to Chatbase/OpenAI, ask it to identify the closest match(es) and return the handle
- Returns: Top 1-3 matching entries with confidence indicator

### `iterate/route.ts` (POST)
**Improve an existing handle via Chatbase chat.**

- Accepts: `{ entryId, feedback }`
- Fetches the entry + sales narrative
- Builds prompt with current handle + user feedback
- Gets improved handle from Chatbase
- Updates the entry in-place (or creates new version — TBD)
- Returns updated entry

### `latest/route.ts` (GET)
- Returns summary: total entries, entries by category, last bootstrap date, has entries flag

---

## 4. Frontend Pages

### `/src/app/objection-library/page.tsx` — Main Page

**Empty state (no entries):**
- Explanation of what the objection library is
- "Bootstrap Your Library" CTA button
- Bootstrap modal: persona inputs (auto-prefilled from latest narrative) + "Generate" button

**Library view (entries exist):**
- **Category filter tabs** across the top (All, Need, Priority, ROI, Product, Competition, Adoption, Budget, Trust, Authority) with count badges
- **Persona filter** dropdown (shows unique org+human combos from existing entries)
- **Search bar** — filters entries by text match on objection or handle
- **Entry cards** — each shows:
  - Category badge (colored)
  - Objection text (bold)
  - Handle text (the response)
  - Persona tag
  - Source badge (bootstrap / manual / call-review)
  - Actions: Edit | Chat About | Delete
- **Add Objection** button (manual entry form)
- **Re-Bootstrap** button (generates more, doesn't delete existing)

**Entry edit modal:**
- Objection textarea
- Category dropdown
- Handle textarea (rich text)
- Persona fields
- Notes textarea
- Save / Cancel

### `/src/app/objection-library/history/page.tsx` — Bootstrap History
- List of bootstrap runs with date, persona, entry count
- Click shows which entries were created in that run

---

## 5. Integration Points

### SalesNavBar (`src/components/SalesNavBar.tsx`)
- Add: `{ href: "/objection-library", label: "🛡️ Objections", statusKey: "objectionLibrary" }`

### Document Share (`src/app/api/documents/share/route.ts`)
- Add `"objectionLibrary"` to `validTypes` array
- Share exports the full library as a formatted markdown document

### Document Clone (`src/app/api/documents/clone/route.ts`)
- Add `"objectionLibrary"` case — clones all entries for the user

### SharedDocClient
- Add `objectionLibrary: "Objection Library"` to typeLabels

### Import Route (`src/app/api/import/route.ts`)
- Add `"objectionLibrary"` to `VALID_APPLET_TYPES`

### Sequence Conversation (`src/lib/sequences/sequence-conversation.ts`)
- Add `"objection-library"` type support for the "Chat About" linked conversations

### Attachments (`src/app/api/attachments/`)
- Add objection library as an optional attachment type that can be included in chat context (so the chatbot knows the user's objection handles)

---

## 6. Bootstrap AI Prompt Strategy

### Prompt Structure (sent to Chatbase)

**Instructions block** (first, survives truncation):
```
You are an expert B2B sales coach helping a founder build their objection handling library.

## INSTRUCTIONS:
Generate 8-10 common objections that prospects would raise when evaluating this product. Focus on objections related to:
- Product fit & capabilities (does it solve the problem?)
- ROI & value justification (can they justify the spend?)
- Adoption & implementation (will the team use it?)
- Competition & alternatives (including build-vs-buy)
- Trust & vendor risk (are you too early-stage?)

For each objection, provide:
1. The objection (what the prospect actually says)
2. The category (one of: NEED, PRIORITY, ROI, PRODUCT, COMPETITION, ADOPTION, BUDGET, TRUST, AUTHORITY)
3. A specific, tactical handle (how to respond — use concrete details from the sales narrative, not generic advice)

## TARGET PERSONA:
- Organization type: {orgPersona}
- Target role: {humanPersona}

## OUTPUT FORMAT:
Return a JSON array. Each element: { "objection": "...", "category": "...", "handle": "..." }
Do NOT wrap in code blocks. Return only the JSON array.
```

**Context block** (chunked if needed):
```
## SALES NARRATIVE:
{narrative content}
```

---

## 7. Hybrid Match Algorithm

### `/api/objection-library/match` flow:

1. **Normalize** input objection (lowercase, trim)
2. **Text search**: Query entries where `objection` contains significant keywords from the input (skip stop words). Score by keyword overlap.
3. **If top text match score > threshold** (e.g., 60% keyword overlap): return it directly
4. **Else — Semantic match**: Build prompt with the input objection + all stored objections (as numbered list), ask LLM: "Which of these objections is the prospect expressing? Return the number(s) of the closest match(es), or 'none' if no match."
5. **Return** top 1-3 matches with handles, or "no match found" with suggestion to add a new entry

---

## 8. File Checklist

**New files:**
- [ ] `prisma/migrations/YYYYMMDD_add_objection_library/migration.sql`
- [ ] `src/app/objection-library/page.tsx`
- [ ] `src/app/objection-library/history/page.tsx`
- [ ] `src/app/api/objection-library/bootstrap/route.ts`
- [ ] `src/app/api/objection-library/entries/route.ts`
- [ ] `src/app/api/objection-library/entries/[id]/route.ts`
- [ ] `src/app/api/objection-library/match/route.ts`
- [ ] `src/app/api/objection-library/iterate/route.ts`
- [ ] `src/app/api/objection-library/latest/route.ts`
- [ ] `src/lib/objection-library/categories.ts` (category constants, colors, labels)

**Existing files to modify:**
- [ ] `prisma/schema.prisma` — Add ObjectionEntry, ObjectionBootstrap models + enums + User relations
- [ ] `src/components/SalesNavBar.tsx` — Add nav item
- [ ] `src/app/api/documents/share/route.ts` — Add to validTypes
- [ ] `src/app/api/documents/clone/route.ts` — Add clone case
- [ ] `src/app/share/doc/[code]/SharedDocClient.tsx` — Add type label
- [ ] `src/app/api/import/route.ts` — Add applet type
- [ ] `src/lib/sequences/sequence-conversation.ts` — Add type support

---
---

# Public Mikey — Twitter Integration & Ask Mikey

## Overview

Two public intake channels that let anyone ask Mikey a question and get a persistent, crawlable answer page. This creates an organic SEO flywheel: each answered question becomes a long-tail keyword page that drives traffic, which drives more questions.

### Channels

1. **Twitter/X** — A `@AskMikey` (TBD) handle that listens for mentions, answers with a preview + link
2. **Ask Mikey (Web)** — A public page at `/ask` where anyone can submit a question directly

Both channels feed into the same answer pipeline and produce the same public answer pages.

---

## 1. Data Model

### New model: `PublicAnswer`

```
model PublicAnswer {
  id              String   @id @default(cuid())

  // The question asked
  question        String   @db.Text

  // SEO-friendly slug derived from question text
  slug            String   @unique

  // The full answer from Mikey
  answer          String   @db.Text

  // Short preview (used in tweet replies, meta descriptions)
  preview         String   @db.VarChar(280)

  // Where the question came from
  source          String   // "twitter" | "ask-mikey"

  // Twitter-specific metadata (null for ask-mikey)
  twitterTweetId  String?  @unique
  twitterTweetUrl String?            // Full tweet URL for oEmbed rendering
  twitterHandle   String?
  twitterThreadContext String? @db.Text

  // Tracking
  viewCount       Int      @default(0)

  // Status: draft → published (allows moderation before posting)
  status          String   @default("published") // "draft" | "published" | "hidden"

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([slug])
  @@index([source, createdAt])
  @@index([status, createdAt])
  @@map("public_answers")
}
```

### Slug Strategy

Generate from question text: `"How do I price my first SaaS deal?"` → `how-do-i-price-my-first-saas-deal`

- Lowercase, strip punctuation, replace spaces with hyphens
- Truncate to ~80 chars at a word boundary
- Append short random suffix if collision (e.g., `-a3f`)

---

## 2. Public Pages

### `/ask` — Ask Mikey Page

- Simple, clean public page (no auth required)
- Text input for the question
- Optional: category/topic selector
- "Ask Mikey" submit button
- Clear messaging: "This is a public Q&A — your question and Mikey's answer will be visible to everyone"
- After submission: redirect to the answer page
- Below the form: grid/list of recent popular questions (internal linking for SEO)

### `/answers/[slug]` — Public Answer Page

- **Embedded tweet** (Twitter-sourced only): Use Twitter's oEmbed API (`https://publish.twitter.com/oembed?url=...`) to render the original tweet card at the top of the page. This shows the real question in its original social context with the asker's avatar, handle, and engagement. Load the Twitter widget JS (`widgets.js`) to render it client-side. Falls back to a styled quote block if the tweet is deleted or unavailable.
- **H1**: The question text (matches search intent for SEO — also serves as the heading for Ask Mikey-sourced questions that don't have a tweet embed)
- **Source attribution**: "Asked on Twitter by @handle" or "Asked on Ask Mikey"
- **Full answer**: Rich formatted Mikey response
- **Related questions**: Links to other answer pages (internal linking for SEO)
- **CTA**: "Have a question? Ask Mikey" → links back to `/ask`
- **Meta tags**: Open Graph, Twitter cards, structured data (FAQ schema for Google rich results)
- **No auth required** — fully public and crawlable

### `/answers` — Answer Index / Browse Page

- Paginated list of all published answers
- Search/filter by keyword
- Category grouping (if categories are added)
- Acts as a sitemap-like page for crawlers

---

## 3. Twitter Integration

### 3a. Ingestion — Polling for Mentions

- **Worker/cron job** that polls Twitter API v2 for mentions every 60 seconds
- Endpoint: `GET /2/users/:id/mentions` with `since_id` tracking
- For each new mention:
  - Extract tweet text as the question
  - Walk up the reply chain (`conversation_id` + `in_reply_to`) to gather thread context
  - Store the raw tweet data

### 3b. Image/Vision Extraction

- When processing a mention or its thread context, check each tweet for attached media (images, screenshots)
- Use the same vision extraction pipeline already in the app to extract text/content from images
- Extracted image content gets appended to the thread context before answer generation
- This handles cases like: "What do you think of this sales email?" + attached screenshot

### 3c. Processing Pipeline

For each new mention:

1. **Filter/moderate**: Skip obvious spam, non-questions, or inappropriate content
2. **Extract images**: Run vision extraction on any images in the mention or thread
3. **Generate answer**: Send question + thread context (including extracted image content) through the Mikey answer pipeline
3. **Generate preview**: Truncate/summarize the answer to fit in a tweet (~200 chars to leave room for the link)
4. **Generate slug**: From the question text
5. **Store**: Create `PublicAnswer` record with `source: "twitter"`
6. **Reply**: Post tweet reply: `"{preview}… {link to /answers/[slug]}"`
7. **Track**: Store the reply tweet ID to avoid double-posting

### 3d. Twitter API Requirements

- **API tier**: Basic ($100/mo) or Pro — need read + write access
- **Endpoints needed**:
  - `GET /2/users/:id/mentions` — poll for mentions
  - `POST /2/tweets` — post replies
  - `GET /2/tweets/:id` — fetch thread context
- **Rate limits**: Basic tier allows 1,500 tweets posted/mo, 10,000 tweet reads/mo
- **Auth**: OAuth 2.0 with PKCE or OAuth 1.0a for user-context actions

### 3e. Worker Architecture Options

| Option | Pros | Cons |
|---|---|---|
| **Next.js cron route** (e.g., Vercel Cron) | No extra infra, stays in the app | 60s min interval on Vercel, cold starts |
| **External worker** (e.g., separate Node service) | Full control, can do streaming | Separate deployment to manage |
| **Queue-based** (e.g., BullMQ + Redis) | Reliable, retryable, rate-limit friendly | More infra complexity |

**Recommendation**: Start with a Next.js API route triggered by Vercel Cron (or equivalent). Move to a queue if volume grows.

---

## 4. Answer Generation Pipeline (Shared)

This is the core service both Twitter and Ask Mikey call:

```
generatePublicAnswer(input: {
  question: string
  context?: string        // thread context for Twitter
  source: "twitter" | "ask-mikey"
}) → {
  answer: string          // full rich answer
  preview: string         // ≤280 char summary
  slug: string            // SEO slug
}
```

- Uses the same Chatbase/LLM pipeline as existing Mikey chat
- Prompt includes general founder-led sales knowledge (not user-specific sales narratives — this is public)
- For Twitter sources: includes vision-extracted content from any images in the thread
- Preview generation: either first sentence of the answer or a separate summarization call

---

## 5. SEO Strategy

### On-Page SEO

- **H1** = question text (natural language, matches long-tail queries)
- **Meta title** = `"{question}" — Ask Mikey`
- **Meta description** = preview text
- **Canonical URL** = `/answers/[slug]`
- **FAQ structured data** (JSON-LD) for Google rich results
- **Open Graph + Twitter Card** meta tags for social sharing

### Crawlability

- `/answers` index page links to all answer pages
- `sitemap.xml` includes all published answer pages (auto-generated)
- Internal linking: each answer page links to related questions
- No auth walls — everything public

### Content Growth

- Each Twitter mention = 1 new indexed page
- Each Ask Mikey submission = 1 new indexed page
- Related questions feature encourages browsing (lowers bounce rate)
- Over time: a library of hundreds of founder-led sales Q&A pages

---

## 6. Moderation & Safety

- **Pre-publish filter**: Run question through a moderation check before generating an answer
- **Spam detection**: Ignore mentions from accounts with low follower counts, new accounts, or repeated identical questions
- **Duplicate detection**: Check slug similarity / question text similarity before creating a new answer — link to existing answer if one exists
- **Hide/flag**: Admin ability to mark answers as `hidden` if they're low quality or inappropriate
- **Rate limiting**: Cap the number of answers generated per hour to control costs

---

## 7. API Routes

### Public routes (no auth):

- `GET /api/public/answers` — List published answers (paginated, filterable)
- `GET /api/public/answers/[slug]` — Single answer by slug
- `POST /api/public/ask` — Submit a question from Ask Mikey page

### Internal/admin routes (auth required):

- `POST /api/twitter/poll` — Triggered by cron to poll for new mentions
- `PATCH /api/admin/answers/[id]` — Edit/hide/publish an answer
- `GET /api/admin/answers` — List all answers with status filters
- `DELETE /api/admin/answers/[id]` — Remove an answer

### Webhook route (optional):

- `POST /api/twitter/webhook` — If upgrading to Account Activity API for real-time mentions

---

## 8. File Checklist

**New files:**
- [ ] `prisma/migrations/YYYYMMDD_add_public_answers/migration.sql`
- [ ] `src/app/ask/page.tsx` — Public Ask Mikey page
- [ ] `src/app/answers/page.tsx` — Public answer index/browse page
- [ ] `src/app/answers/[slug]/page.tsx` — Individual public answer page
- [ ] `src/app/api/public/answers/route.ts` — List answers API
- [ ] `src/app/api/public/answers/[slug]/route.ts` — Single answer API
- [ ] `src/app/api/public/ask/route.ts` — Submit question API
- [ ] `src/app/api/twitter/poll/route.ts` — Twitter mention polling worker
- [ ] `src/app/api/admin/answers/route.ts` — Admin answer management
- [ ] `src/app/api/admin/answers/[id]/route.ts` — Admin single answer management
- [ ] `src/lib/public-answers/generate.ts` — Shared answer generation pipeline
- [ ] `src/lib/public-answers/slugify.ts` — Slug generation utility
- [ ] `src/lib/public-answers/twitter.ts` — Twitter API client wrapper
- [ ] `src/lib/public-answers/moderation.ts` — Moderation/spam filtering

**Existing files to modify:**
- [ ] `prisma/schema.prisma` — Add PublicAnswer model
- [ ] `next.config.js` — Add any public route rewrites if needed
- [ ] `src/app/layout.tsx` or equivalent — Ensure public pages have proper meta/layout

---

## 9. Implementation Order

### Phase 1: Public Answer Pages (foundation)
1. Add `PublicAnswer` model to Prisma schema + migrate
2. Build `/answers/[slug]` page with SEO meta tags
3. Build `/answers` index page
4. Add sitemap generation for answer pages

### Phase 2: Ask Mikey (web intake)
5. Build shared answer generation pipeline (`src/lib/public-answers/generate.ts`)
6. Build `/ask` page with public question form
7. Build `POST /api/public/ask` endpoint
8. Wire up: question → generate → store → redirect to answer page

### Phase 3: Twitter Integration
9. Set up Twitter API credentials + client wrapper
10. Build polling worker (`/api/twitter/poll`)
11. Build thread context extraction
12. Wire up: mention → generate → store → reply with link
13. Set up cron trigger for polling

### Phase 4: Polish & SEO
14. Add related questions feature (internal linking)
15. Add FAQ structured data (JSON-LD)
16. Add Open Graph + Twitter Card meta tags

---

# Coaching Session Enhancement — Implementation Plan

## Overview

Transform the coaching interface from a simple "log notes + transcript" tool into a structured **goal-tracking, metrics-measuring, stage-aware coaching framework** that carries state forward session to session.

---

## Session Lifecycle: 3 States

### NEW (live coaching call)
- Created from "New Session" button
- Auto-locks the previous session (if one exists in NEW or IN_PROGRESS state)
- Carries forward all ACTIVE goals, tasks, and metric definitions from the last session
- Maturity stage snapshot'd at creation time
- Full control: add/edit/complete/retire goals, tasks, metrics, notes, transcript

### IN_PROGRESS (sprint — 1-2 weeks between sessions)
- Triggered when user clicks **"Start Sprint"**
- The working period between coaching calls
- Full control: add/edit/complete/retire goals, tasks, update metrics, edit notes
- Same capabilities as NEW — no restrictions on adding goals/tasks mid-sprint

### LOCKED (archived)
- Triggered automatically when user creates the next NEW session
- Can also be triggered manually via "Lock Session"
- Everything is frozen with timestamps
- Read-only — view as historical record

### Transition Diagram

```
[New Session] → NEW (live coaching call)
                  │
            "Start Sprint"
                  │
                  ▼
            IN_PROGRESS (1-2 week sprint)
                  │
        ┌─────────┴──────────┐
        │                    │
  "Lock Session"      "New Session"
   (manual)          (auto-locks this one)
        │                    │
        ▼                    ▼
     LOCKED              LOCKED + NEW (next session)
```

### Transition Rules

| Action | Button Label | From State | To State | What happens |
|--------|-------------|-----------|----------|-------------|
| User finishes live call | **"Start Sprint"** | NEW | IN_PROGRESS | Sprint period begins |
| User creates next session | **"New Session"** | — | NEW (new) | Previous session auto → LOCKED, active items carry forward |
| User manually archives | **"Lock Session"** | IN_PROGRESS | LOCKED | Manual archive |

---

## Data Model

### 1. Extend Existing `CoachingSession`

Add to the existing model:

```prisma
model CoachingSession {
  // ...existing fields...

  sessionStatus   String  @default("new")  // "new" | "in_progress" | "locked"
  maturityStage   String? // snapshot of stage at session creation

  // Relations to new models
  goals           CoachingGoal[]
  metricEntries   CoachingMetricEntry[]
}
```

### 2. Sales Maturity Stage (per user, singleton)

```prisma
model SalesMaturityStage {
  id     String @id @default(cuid())
  userId String @unique
  user   User   @relation(...)

  currentStage String
  // Values:
  //   "PROBLEM_VALIDATION"    - "Do we know what problem we're solving?"
  //   "VALUE_VALIDATION"      - "Does the product solve the problem and create value?"
  //   "FIRST_REVENUE"         - "Can we get someone to pay for the product?"
  //   "REPEATABLE_REVENUE"    - "Can we get many people to pay for the product?"
  //   "FIRST_SALES_HIRE"      - "Can we get someone other than the founder to sell?"
  //   "SCALING_SALES"         - "Can we get many people other than the founder to sell?"

  updatedAt DateTime @updatedAt
}
```

### 3. Goals (persistent, carry across sessions)

```prisma
model CoachingGoal {
  id          String  @id @default(cuid())
  userId      String
  user        User    @relation(...)

  sessionId   String  // session where this goal was CREATED
  session     CoachingSession @relation(...)

  title       String
  description String? @db.Text
  status      String  @default("active") // "active" | "done" | "not_doing" | "deprioritized"
  statusChangedAt DateTime?

  tasks       CoachingTask[]

  createdAt   DateTime @default(now())
  order       Int      @default(0)
}
```

Goals are **user-level persistent objects**. They're created once, linked to the session where they were born (`sessionId`), but visible across all non-locked sessions until retired.

### 4. Tasks (under goals, persistent)

```prisma
model CoachingTask {
  id       String @id @default(cuid())
  userId   String
  user     User   @relation(...)

  goalId   String
  goal     CoachingGoal @relation(...)

  title    String
  status   String @default("active") // "active" | "done" | "not_doing" | "deprioritized"
  statusChangedAt DateTime?

  createdAt DateTime @default(now())
  order     Int      @default(0)
}
```

Same carry-forward pattern as goals.

### 5. Metric Definitions (persistent templates)

```prisma
model CoachingMetricDefinition {
  id         String  @id @default(cuid())
  userId     String
  user       User    @relation(...)

  name       String  // "Customers", "Revenue", or custom
  definition String? @db.Text // "Companies with signed contract paying >$0/mo"
  interval   String? // "weekly" | "monthly" | "quarterly" | null
  isDefault  Boolean @default(false) // true for Customers & Revenue
  order      Int     @default(0)

  entries    CoachingMetricEntry[]

  createdAt  DateTime @default(now())
}
```

### 6. Metric Entries (per-session values)

```prisma
model CoachingMetricEntry {
  id                    String @id @default(cuid())
  userId                String
  user                  User   @relation(...)

  metricDefinitionId    String
  metricDefinition      CoachingMetricDefinition @relation(...)

  sessionId             String
  session               CoachingSession @relation(...)

  currentValue          Float  // total value at this point
  addedSinceLastSession Float  @default(0) // auto-calculated delta

  createdAt             DateTime @default(now())
}
```

---

## Default Metrics

When a user creates their first coaching session, auto-create two metric definitions:

1. **Customers** (isDefault: true)
   - Definition slot: empty for user to fill
   - User enters: total count + "added since last"

2. **Revenue** (isDefault: true)
   - Definition slot: empty for user to fill
   - User enters: total value + "added since last"

User can add custom metrics tied to their goals (e.g., "Outbound meetings booked", "Demo-to-close rate").

---

## "New Session" Carry-Forward Logic

When the user clicks "New Session":

1. **Lock previous session**: Set most recent NEW or IN_PROGRESS session to `status: "locked"`
2. **Snapshot maturity stage**: Copy current `SalesMaturityStage.currentStage` to `session.maturityStage`
3. **Carry forward goals**: All ACTIVE goals remain visible (they're user-level, always visible in non-locked sessions)
4. **Carry forward tasks**: All ACTIVE tasks under active goals remain visible
5. **Carry forward metrics**: All metric definitions carry over. For each definition, create empty `CoachingMetricEntry` entries for the new session. Auto-calculate `addedSinceLastSession` as `currentValue - previousSessionValue`
6. **Create new session** with `status: "new"`

---

## UI Layout

### Coaching Session Page (enhanced)

```
┌─────────────────────────────────────────────────────┐
│ HEADER                                              │
│ Session: Mar 27, 2026    Status: [IN_PROGRESS]      │
│ [Chat About All] [+ New Session] [Start Sprint]     │
├─────────────────────────────────────────────────────┤
│                                                     │
│ 🔄 Sales Maturity Stage                            │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ○ Problem Validation                            │ │
│ │ ○ Value Validation                              │ │
│ │ ● First Revenue       ← current                 │ │
│ │ ○ Repeatable Revenue                            │ │
│ │ ○ First Sales Hire                              │ │
│ │ ○ Scaling Sales                                 │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ 📊 Metrics                                         │
│ ┌────────────┬────────────┬────────────┐           │
│ │ Customers  │ Revenue    │ Pipeline   │           │
│ │ Total: 12  │ Total: $50K│ Total: 25  │           │
│ │ +3 since   │ +$12K since│ +8 since   │           │
│ │ last       │ last       │ last       │           │
│ └────────────┴────────────┴────────────┘           │
│ [+ Add Metric]                                      │
│                                                     │
│ 🎯 Goals & Tasks                                   │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Goal: Prove outbound pipeline        [ACTIVE ▼] │ │
│ │   ☑ Write 3 email templates          [DONE ✓]   │ │
│ │   □ Run 50-contact test campaign     [ACTIVE ▼] │ │
│ │   □ Analyze response rates           [ACTIVE ▼] │ │
│ │                                                 │ │
│ │ Goal: Improve demo conversion        [ACTIVE ▼] │ │
│ │   □ Record 3 demo calls             [ACTIVE ▼] │ │
│ │   □ Build demo script               [ACTIVE ▼] │ │
│ └─────────────────────────────────────────────────┘ │
│ [+ Add Goal]                                        │
│                                                     │
│ 📝 Notes (existing functionality)                  │
│ ...                                                 │
│                                                     │
│ 🎙️ Transcript / Recording (existing)               │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
```

### Status Badge Colors
- **NEW**: Blue badge — "Live Session"
- **IN_PROGRESS**: Orange badge — "Sprint"
- **LOCKED**: Gray badge — "Archived"

### Goal/Task Status Options
- **Active**: Default, shown as open checkbox
- **Done**: Green checkmark, timestamped
- **Not Doing**: Strikethrough, gray
- **Deprioritized**: Yellow, moved to bottom

---

## API Routes Needed

### Maturity Stage
- `GET /api/coaching/maturity-stage` — get current stage
- `PUT /api/coaching/maturity-stage` — update stage

### Session Status
- `PATCH /api/coaching-sessions/[id]/status` — transition: "new" → "in_progress" → "locked"

### Goals
- `GET /api/coaching/goals` — list active goals (user-level)
- `POST /api/coaching/goals` — create goal (linked to current session)
- `PATCH /api/coaching/goals/[id]` — update title, description, status, order
- `DELETE /api/coaching/goals/[id]` — delete goal

### Tasks
- `POST /api/coaching/goals/[id]/tasks` — create task under goal
- `PATCH /api/coaching/tasks/[id]` — update title, status, order
- `DELETE /api/coaching/tasks/[id]` — delete task

### Metrics
- `GET /api/coaching/metrics` — list metric definitions
- `POST /api/coaching/metrics` — create metric definition
- `PATCH /api/coaching/metrics/[id]` — update definition
- `DELETE /api/coaching/metrics/[id]` — delete definition

### Metric Entries
- `POST /api/coaching/metrics/[id]/entries` — record a value for a session
- `GET /api/coaching-sessions/[id]/metrics` — get all metric entries for a session

### New Session (enhanced)
- `POST /api/coaching-sessions` — create new session (auto-lock previous, carry forward, snapshot stage)

---

## Implementation Order

### Phase 1: Schema + Migration
1. Extend `CoachingSession` with `sessionStatus` and `maturityStage`
2. Create `SalesMaturityStage` table
3. Create `CoachingGoal` table
4. Create `CoachingTask` table
5. Create `CoachingMetricDefinition` table
6. Create `CoachingMetricEntry` table
7. Migration SQL

### Phase 2: API Routes
8. Maturity stage CRUD
9. Goal CRUD + status transitions
10. Task CRUD + status transitions
11. Metric definition CRUD
12. Metric entry recording
13. Session status transitions (Start Sprint, Lock)
14. Enhanced "new session" with carry-forward logic

### Phase 3: UI
15. Maturity stage selector section on coaching page
16. Metrics section with cards + add metric modal
17. Goals & tasks section with inline add/edit/status dropdowns
18. "Start Sprint" / "Lock Session" / status badge in header
19. Read-only mode for LOCKED sessions

### Phase 4: Future (not in this build)
20. Standalone metrics history page (charts + trends)
21. Slack-based metric check-ins (Mikey asks "how did you do?")
22. Metrics over time visualization
23. Goal completion rate analytics

---

# Sales Motion Analyzer — Implementation Plan

## Overview

Users upload the "raw material" of their best completed deals — actual call summaries and transcripts from their call recorder — and the system synthesizes:

1. A **prototypical sales motion** (the canonical sequence of stages and activities)
2. **Canonical call scripts/flows** per call type (synthesized from multiple examples of the same type)
3. A **GTM variable** (`SALES_MOTION`) so the sales motion context feeds into all other Mikey workflows

### Core Instruction to Users

> Provide 3-5 of your best completed deals. For each deal, paste the chronological series of calls — summaries and transcripts from your call recorder. Focus on "good to great" deals that represent how you want your sales process to work.

---

## Data Flow

```
User provides 3-5 complete deals
  → Each deal has 3-8 calls in chronological order
    → Each call has: pasted summary + pasted transcript (separate fields)

On save:
  → LLM auto-names each deal (e.g., "Acme Corp - Enterprise Deal")
  → LLM auto-names each call (e.g., "Initial Discovery Call")
  → LLM auto-classifies each call type (discovery, demo, proposal,
    security, negotiation, technical, closing, etc.)

On "Analyze Sales Motion":
  → Pass 1: Synthesize the prototypical sales motion from all deals
  → Pass 2: Group calls by type across deals
  → Pass 3: For each type with 2+ examples, synthesize a canonical
    call flow (timing, agenda, questions, content, structure)
  → Save sales motion as GTM merge variable
```

---

## Data Model

### SalesMotionCollection (top-level container)

```prisma
model SalesMotionCollection {
  id      String @id @default(cuid())
  userId  String
  user    User   @relation(...)

  title   String @default("Sales Motion Analysis")
  status  String @default("draft") // "draft" | "processing" | "complete"

  // Synthesized output
  salesMotionSynthesis  String? @db.Text  // Prototypical sales motion (markdown)

  deals    SalesMotionDeal[]
  scripts  SalesMotionCallScript[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, createdAt])
}
```

### SalesMotionDeal (a single completed deal)

```prisma
model SalesMotionDeal {
  id            String @id @default(cuid())
  collectionId  String
  collection    SalesMotionCollection @relation(...)

  name          String?  // AI-generated: "Acme Corp - Enterprise Deal"
  outcome       String?  // "won" — focus on won deals
  dealOrder     Int      @default(0)

  calls         SalesMotionCall[]

  createdAt     DateTime @default(now())
}
```

### SalesMotionCall (a single call within a deal)

```prisma
model SalesMotionCall {
  id         String @id @default(cuid())
  dealId     String
  deal       SalesMotionDeal @relation(...)

  // User inputs (separate fields)
  summary    String? @db.Text   // Pasted call summary from recorder
  transcript String? @db.Text   // Pasted full transcript

  // AI-generated on save
  name       String?   // "Initial Discovery Call"
  callType   String?   // "discovery" | "demo" | "proposal" | "negotiation" |
                       // "security" | "technical" | "closing" | "other"
  callOrder  Int @default(0)  // chronological order within the deal

  createdAt  DateTime @default(now())
}
```

### SalesMotionCallScript (synthesized canonical script per call type)

```prisma
model SalesMotionCallScript {
  id              String @id @default(cuid())
  collectionId    String
  collection      SalesMotionCollection @relation(...)

  callType        String   // "discovery" | "demo" | "proposal" etc.
  title           String   // "Canonical Discovery Call"
  content         String   @db.Text  // Synthesized script/flow (markdown)
  sourceCallCount Int      // How many calls were used to synthesize

  iterationHistory String[] @default([])

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

---

## Processing Pipeline

### Pass 1: Name & Classify (parallel per deal)

For each deal, send all its call summaries to the LLM and ask it to:
- Generate a deal name
- Name each call
- Classify each call type

This is fast — one LLM call per deal, all in parallel.

### Pass 2: Synthesize Sales Motion (single call)

Take all deals' call sequences (names + types + summaries) and synthesize:
- **Typical deal stages**: What's the usual progression? (e.g., Discovery → Demo → Proposal → Security Review → Negotiation → Close)
- **Stage durations**: How long does each stage typically take?
- **Key activities per stage**: What happens at each stage?
- **Decision points**: Where do deals branch or stall?
- **Stakeholder involvement**: When do different personas enter?
- **Common patterns**: What's consistent across winning deals?

Output: Markdown document saved as `salesMotionSynthesis` and as `SALES_MOTION` GTM variable.

### Pass 3: Synthesize Call Scripts (parallel per call type)

Group all calls by type across deals. For each type with 2+ examples:

- **Discovery calls** (e.g., 4 examples across deals): Synthesize the canonical flow — opening, agenda setting, questions asked consistently, information gathered, objections handled, next steps, timing
- **Demo calls** (e.g., 3 examples): Synthesize the demo structure — setup, flow, key moments, proof points shown, trial/next-step close
- **Proposal calls**: Structure, pricing presentation, objection handling
- etc.

Each synthesis uses the **summaries as structure** and **transcripts for detail** (specific language, questions, transitions).

### Size Management

Transcripts can be huge (10K+ words each). Strategy:
- **Summaries** are primary context for motion synthesis (Pass 2)
- **Transcripts** are used selectively for script synthesis (Pass 3) — truncated per call to stay within context limits
- On ingest: if a transcript exceeds 50K chars, truncate with a note

---

## UX Flow

### Step 1: Data Entry Page (`/sales-motion/new`)

```
┌─────────────────────────────────────────────────────┐
│ Analyze Your Sales Motion                           │
│                                                     │
│ Provide 3-5 of your best completed deals. For each, │
│ paste call summaries and transcripts in order.       │
│ Focus on "good to great" deals.                      │
│                                                     │
│ ┌─── Deal 1 ──────────────────────────────── [×] ─┐ │
│ │                                                 │ │
│ │  Call 1                                         │ │
│ │  ┌─ Summary ─────────────────────────────────┐  │ │
│ │  │ [paste call summary from recorder]        │  │ │
│ │  └───────────────────────────────────────────┘  │ │
│ │  ┌─ Transcript ──────────────────────────────┐  │ │
│ │  │ [paste full transcript]                   │  │ │
│ │  └───────────────────────────────────────────┘  │ │
│ │                                                 │ │
│ │  Call 2                                         │ │
│ │  ┌─ Summary ─────────────────────────────────┐  │ │
│ │  │ [paste call summary]                      │  │ │
│ │  └───────────────────────────────────────────┘  │ │
│ │  ┌─ Transcript ──────────────────────────────┐  │ │
│ │  │ [paste transcript]                        │  │ │
│ │  └───────────────────────────────────────────┘  │ │
│ │                                                 │ │
│ │  [+ Add Call]                                   │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─── Deal 2 ──────────────────────────────── [×] ─┐ │
│ │ ...                                             │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [+ Add Deal]                                        │
│                                                     │
│ [Analyze Sales Motion]                              │
└─────────────────────────────────────────────────────┘
```

### Step 2: Processing

Show a streaming progress page:
- "Naming and classifying your calls..." (parallel, fast)
- "Synthesizing your sales motion..." (streams into view)
- "Creating canonical call scripts..." (parallel per type)

### Step 3: Results Page (`/sales-motion`)

Tabbed view:

```
Tabs: [Motion Overview] [Discovery Script] [Demo Script]
      [Proposal Script] [...] [Deals]

── Motion Overview ──
[Rendered markdown of prototypical sales motion]
[Iterate sidebar]

── Discovery Call Script ──
Synthesized from 4 discovery calls across 4 deals
[Rendered markdown of canonical discovery flow]
[Iterate sidebar]

── Demo Script ──
Synthesized from 3 demos across 3 deals
[Rendered markdown of canonical demo structure]
[Iterate sidebar]

── Deals ──
Deal 1: Acme Corp (4 calls: Discovery → Demo → Proposal → Close)
Deal 2: Globex Inc (5 calls: Discovery → Discovery → Demo → Security → Close)
Deal 3: Initech (3 calls: Discovery → Demo → Close)
[Click to expand individual calls with summaries]
```

---

## API Routes

### Collections
- `POST   /api/sales-motion/collections` — create new collection
- `GET    /api/sales-motion/latest` — get latest complete collection
- `GET    /api/sales-motion/collections/[id]` — get specific collection with deals/calls/scripts
- `DELETE /api/sales-motion/collections/[id]` — delete collection
- `GET    /api/sales-motion/history` — list all collections

### Deals
- `POST   /api/sales-motion/deals` — add deal to collection
- `PATCH  /api/sales-motion/deals/[id]` — update deal
- `DELETE /api/sales-motion/deals/[id]` — delete deal

### Calls
- `POST   /api/sales-motion/calls` — add call to deal
- `PATCH  /api/sales-motion/calls/[id]` — update call (summary/transcript)
- `DELETE /api/sales-motion/calls/[id]` — delete call

### Analysis
- `POST   /api/sales-motion/analyze` — run full pipeline (SSE streaming)
  - Event: `classify_done` — deal/call names and types
  - Event: `motion_token` — streaming sales motion synthesis
  - Event: `motion_done` — motion complete
  - Event: `script_done` — each call script as it completes
  - Event: `complete` — all done, GTM variable saved

### Iteration
- `POST   /api/sales-motion/scripts/[id]/iterate` — iterate on a script (SSE streaming)
- `POST   /api/sales-motion/iterate` — iterate on the motion overview (SSE streaming)

---

## GTM Variable Integration

On completion, the sales motion synthesis is saved as:
- **Merge field**: `SALES_MOTION`
- **Name**: "Sales Motion"
- **Value**: The full markdown synthesis

This makes it available to all other content generation workflows (email sequences, discovery questions, coaching context, etc.).

---

## Nav Placement

Under **Playbook & Strategy** dropdown (alongside Sales Narrative, ICP, Discovery Questions):

```
📊 GTM Assessment
📖 Sales Narrative
🎯 Ideal Customer Profile
🔄 Sales Motion        ← NEW
🔍 Discovery Questions
✅ First Call Checklist
📋 Pre-Call Checklist
```

---

## Implementation Order

### Phase 1: Schema + Migration
1. Create 4 new tables: Collection, Deal, Call, CallScript
2. Extend User model with relations
3. Migration SQL

### Phase 2: Data Entry
4. Create/edit page with deal + call input UI
5. CRUD API routes for collections, deals, calls
6. Auto-save as user pastes content

### Phase 3: Analysis Pipeline
7. Name & classify endpoint (parallel per deal)
8. Sales motion synthesis (streaming SSE)
9. Call script synthesis (parallel per type)
10. GTM variable save on completion

### Phase 4: View Page
11. Tabbed view: Motion Overview + per-type scripts + Deals
12. Iterate sidebar per tab/section
13. Share link, history, copy

### Phase 5: Future (not in this build)
14. Re-analyze with additional deals added later
15. Compare sales motions across time periods
16. Integration with call review (auto-pull from reviewed calls)
17. Sales motion coaching (Mikey coaches against the canonical motion)
17. Admin moderation UI for managing answers
18. Duplicate question detection
