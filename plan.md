# Objection Library Applet — Implementation Plan

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
3. **Generate answer**: Send question + thread context (including extracted image content) through the Chatbase API via `sendToChatbase()` (see §4 for full call pattern)
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

### 3f. Threaded Conversations on Public Answer Pages (Future)

When Mikey replies to a tweet, the original asker (or other users) may continue the conversation on Twitter. These follow-up replies should be captured and appended to the same public answer page, turning it into a threaded discussion rather than a single Q&A.

**Same-user follow-ups (the original asker replies to Mikey's reply):**
- These should definitely be appended to the existing `/answers/[slug]` page
- Mikey generates a follow-up response and appends it to the same answer
- The public page shows the full back-and-forth as a conversation thread
- On Twitter, Mikey replies in the same thread (maintaining the Twitter conversation)
- The `PublicAnswer` model may need a related `PublicAnswerReply` model (or a JSON array of exchanges) to store multi-turn conversations

**Third-party interjections (a different user replies to Mikey's reply):**
- TBD — needs a design decision:
  - **Option A**: Treat as a new question → new answer page (cleaner, avoids noise)
  - **Option B**: Append to the same page as a community thread (more engaging, but moderation burden)
  - **Option C**: Ignore unless they also @mention Mikey directly (safest default)
- Leaning toward Option A or C initially to keep pages focused

**Implementation considerations:**
- The polling worker needs to distinguish "reply to Mikey's reply by original asker" vs "new mention by a different user"
- Use `conversation_id` + `in_reply_to_user_id` to detect whether a reply is part of an existing Mikey conversation
- The answer page UI needs a thread/conversation view (alternating question/answer blocks) instead of a single answer block
- SEO: the H1 stays as the original question; follow-up exchanges are supplementary content

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

### Chatbase Integration (required)

All answer generation **must** go through the existing Chatbase API client at `src/lib/chatbase/client.ts` — the same route every other Mikey feature uses. This keeps Public Mikey's knowledge, tone, and behavior consistent with the rest of the product.

**Call pattern:**

1. Build the prompt (question + thread context + any vision-extracted image content)
2. If the combined content exceeds the 7,500-char buffer, use the chunking utilities from `src/lib/chatbase/chunking.ts`:
   - `needsChunking(content)` to check
   - `splitIntoChunks(content)` to split on markdown headers / line boundaries
   - `buildChunkedHistory(chunks, "Thread context")` to create a multi-message history with assistant acknowledgments between parts
3. Call `sendToChatbase(prompt, undefined, chatbaseHistory)` — non-streaming is fine since there's no live user waiting (Twitter replies and Ask Mikey submissions are async)
4. Parse the response text as the full answer
5. Generate the preview (second `sendToChatbase` call with a short summarization prompt, or truncate the first sentence to ≤280 chars)
6. Generate the slug from the question text

**Why not a separate LLM call?** Chatbase already has Mikey's training data, system prompt, and founder-led sales knowledge baked in. Calling a raw OpenAI/Anthropic endpoint would bypass all of that and produce generic answers. The whole point is that Public Mikey sounds like Mikey.

**No `conversationId` needed** — each public answer is a one-shot generation, not a multi-turn conversation. Pass `undefined` for the conversation ID.

### Content notes

- Prompt includes general founder-led sales knowledge (not user-specific sales narratives — this is public)
- For Twitter sources: includes vision-extracted content from any images in the thread
- Preview generation: either a second summarization call via `sendToChatbase` or first-sentence truncation

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
17. Admin moderation UI for managing answers
18. Duplicate question detection

---

## 10. Admin Dashboard — Public Mikey Section

Extend the existing admin dashboard (`/admin`) with a new **Public Mikey** tab that gives visibility into public usage across both Twitter and Ask Mikey channels.

### Navigation

Add a new tab to the admin layout navigation:
- `{ href: "/admin/public-mikey", label: "🌐 Public Mikey" }`

### Admin Page: `/src/app/admin/public-mikey/page.tsx`

**Overview Stats Cards:**

| Stat | Description |
|---|---|
| Total Answers | Count of all `PublicAnswer` records |
| Published | Count where `status = "published"` |
| Hidden / Draft | Count where `status = "hidden"` or `"draft"` |
| Twitter Answers | Count where `source = "twitter"` |
| Ask Mikey Answers | Count where `source = "ask-mikey"` |
| Total Views | Sum of `viewCount` across all answers |
| Answers (7d) | Count created in the last 7 days |
| Avg Views / Answer | Mean `viewCount` across published answers |

**Source Breakdown Chart:**
- Simple bar or pie showing Twitter vs Ask Mikey volume over time (weekly buckets)

**Top Answers Table:**
- Top 20 answers sorted by `viewCount` descending
- Columns: Question (truncated), Source, Views, Status, Created Date
- Click to expand full answer or link to public page

**Recent Answers Feed:**
- 20 most recent `PublicAnswer` records
- Columns: Question (truncated), Source, Status, Views, Created Date
- Source badge: 🐦 Twitter | 🌐 Ask Mikey
- Status badge: colored (published = green, draft = yellow, hidden = red)
- Actions: View public page | Edit | Hide | Delete

**Twitter Activity Section:**
- Last poll timestamp (from most recent `PublicAnswer` with `source = "twitter"`)
- Recent Twitter replies: list of recent Twitter-sourced answers showing `@handle`, question snippet, reply status
- Failed/skipped mentions (if tracking is added): count of filtered spam or errors

**Moderation Queue:**
- List of answers with `status = "draft"` awaiting review
- Quick actions: Publish | Edit | Delete
- Bulk publish option for multiple drafts

### Admin Detail Page: `/src/app/admin/public-mikey/[id]/page.tsx`

- Full question text
- Full answer text (rendered markdown)
- Source metadata (Twitter handle, tweet URL, thread context — or "Ask Mikey")
- View count
- Status with toggle (draft ↔ published ↔ hidden)
- Created / updated timestamps
- Edit answer text inline
- Link to public answer page (`/answers/[slug]`)
- Delete with confirmation

### API Routes

#### `GET /api/admin/public-mikey/stats`
Returns aggregated stats for the overview cards:
- Total, published, hidden, draft counts
- Source breakdown (twitter vs ask-mikey)
- Total and average view counts
- 7-day and 30-day creation counts

#### `GET /api/admin/public-mikey/answers`
Paginated list of all `PublicAnswer` records for the admin table:
- Query params: `?page=`, `?sort=`, `?status=`, `?source=`, `?search=`
- Search matches against question text
- Sort by: `createdAt`, `viewCount`, `status`
- Returns: question, slug, source, status, viewCount, twitterHandle, createdAt

#### `GET /api/admin/public-mikey/answers/[id]`
Full detail for a single answer (all fields).

#### `PATCH /api/admin/public-mikey/answers/[id]`
Update answer fields:
- `answer` (text), `preview`, `status`, `slug`
- Used for moderation (publish/hide) and content edits

#### `DELETE /api/admin/public-mikey/answers/[id]`
Remove an answer. Soft-delete (set `status = "hidden"`) or hard-delete based on query param.

### File Checklist

**New files:**
- [ ] `src/app/admin/public-mikey/page.tsx` — Public Mikey admin dashboard
- [ ] `src/app/admin/public-mikey/[id]/page.tsx` — Single answer admin detail
- [ ] `src/app/api/admin/public-mikey/stats/route.ts` — Aggregated stats endpoint
- [ ] `src/app/api/admin/public-mikey/answers/route.ts` — Paginated answer list
- [ ] `src/app/api/admin/public-mikey/answers/[id]/route.ts` — Single answer CRUD

**Existing files to modify:**
- [ ] `src/app/admin/layout.tsx` — Add "Public Mikey" tab to navigation

### Implementation Order

Add to **Phase 4** (after core public answer pages exist):

19. Add Public Mikey tab to admin layout navigation
20. Build `/api/admin/public-mikey/stats` endpoint
21. Build `/api/admin/public-mikey/answers` list endpoint + CRUD
22. Build `/admin/public-mikey` page with stats cards + answer tables
23. Build `/admin/public-mikey/[id]` detail page with edit/moderation
24. Add moderation queue for draft answers

---

## 11. Wired-Off Features (Re-enable at Public Launch)

The following features have been built but are currently disabled to keep the public pages undiscoverable until launch. When ready to go live, reverse these changes:

### Cross-Page Navigation Links

1. **`/answers/[slug]` header** — Restore `<Link href="/answers">` on the "Ask Mikey" title and add back the "Ask a Question" `<Link href="/ask">` in the header
2. **`/answers/[slug]` bottom CTA** — Restore the "Have a sales question? Ask Mikey" CTA block linking to `/ask`
3. **`/answers` header** — Restore `<Link href="/answers">` on the "Ask Mikey" title and add back the "Ask a Question" `<Link href="/ask">` in the header
4. **`/answers` empty state** — Restore the "Be the first to ask Mikey a question!" `<Link href="/ask">` in the empty-state block
5. **`/ask` header** — Restore `<Link href="/answers">` on the "Ask Mikey" title and add back the "Browse Answers" `<Link href="/answers">` in the header (also re-add the `import Link from "next/link"` import)

### SEO & Crawlability

6. **`sitemap.ts`** — Add back the `/ask` and `/answers` index entries to the sitemap return array
7. **`robots.ts`** — Add `/ask` and `/answers` back to the `allow` list
