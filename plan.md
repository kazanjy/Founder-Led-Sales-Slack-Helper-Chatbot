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
