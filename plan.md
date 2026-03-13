# Ad Creator Applet — Implementation Plan

## Overview
New applet at `/ad-creator` that generates multi-platform ad copy and creative/visual direction. Single long-form document with anchored headers per platform. Follows the same architecture as LinkedIn Sequence and Email Sequence applets, plus a new "Iterate" feature.

---

## 1. Database: Prisma Schema

**New model: `AdCreatorVersion`** in `prisma/schema.prisma`

Fields (matching LinkedIn/Email pattern):
- `id` — cuid
- `userId` — FK to User
- `salesNarrativeVersionId` — FK to SalesNarrativeVersion (required context)
- `firstCallChecklistVersionId` — FK to FirstCallChecklistVersion (optional)
- `orgPersona` — Text
- `humanPersona` — Text
- `specialNotes` — Text? (user notes/guidance)
- `platforms` — String[] (selected platforms: "linkedin", "facebook-instagram", "google-sem")
- `content` — Text (generated markdown output)
- `iteratedFromId` — String? (self-referencing FK — tracks iteration lineage)
- `iterationNotes` — Text? (the guidance the user gave when iterating)
- `conversationId` — String? (linked chat thread)
- `createdAt`, `updatedAt`
- Index on `[userId, createdAt]`

Add `adCreatorVersions AdCreatorVersion[]` relation to User model.

---

## 2. API Routes

All under `/src/app/api/ad-creator/`:

### `generate/route.ts` (POST)
- Accepts: `{ orgPersona, humanPersona, specialNotes?, platforms[], includeFirstCallChecklist }`
- Fetches latest sales narrative + optional checklist
- Builds platform-specific AI prompt
- Saves `AdCreatorVersion` to DB
- Creates linked chat conversation via `createSequenceConversation`
- Upserts GTM variable `AD_CREATOR`
- Returns the new version

### `iterate/route.ts` (POST) — **NEW FEATURE**
- Accepts: `{ versionId, iterationNotes, platforms? }`
- Fetches the source version (content + personas + narrative)
- Builds prompt that includes previous output + user's iteration guidance
- Saves new `AdCreatorVersion` with `iteratedFromId` pointing to source
- Creates linked chat conversation
- Returns the new version

### `latest/route.ts` (GET)
- Returns latest version for current user (or null + flags)

### `history/route.ts` (GET)
- Returns all versions ordered by createdAt DESC

### `versions/[id]/route.ts` (GET + PATCH)
- GET: Fetch specific version by ID
- PATCH: Update content (edit-in-place)

### `prefill-personas/route.ts` (POST)
- Reads sales narrative, asks AI for suggested org + audience personas

---

## 3. Frontend Pages

### `/src/app/ad-creator/page.tsx` — Main Page

**Input Form (when no version or regenerating):**
- Organization Persona textarea (auto-prefilled)
- Target Audience Persona textarea (auto-prefilled)
- **Platform multi-select** — checkboxes for: LinkedIn Ads, Facebook/Instagram Ads, Google SEM Ads. All four checked by default.
- Special Notes textarea
- Include First Call Checklist toggle
- "Generate Ad Concepts" button

**Output View (when version exists):**
- One long markdown document with platform headers rendered as anchor-linked sections
- Table of contents with jump links to each platform section
- Action bar: **Copy | Edit | Clone | Share | Chat About | Iterate**
- Version metadata (created date, platforms, iteration lineage if applicable)

**Iterate Overlay (modal):**
- Shows summary of current version
- Textarea: "How would you like to iterate?" with placeholder examples ("Make LinkedIn ads more conversational", "Add urgency to Google SEM headlines", "Focus more on ROI messaging")
- Optional: platform re-select (pre-filled from current version)
- "Generate New Version" button → calls `/api/ad-creator/iterate`
- On success: navigates to the new version

**Edit Mode:**
- RichTextEditor for in-place editing, Save/Cancel buttons

### `/src/app/ad-creator/history/page.tsx` — History Page
- List of all versions with date, persona summary, platform badges
- "Edited" badge when updatedAt !== createdAt
- "Iterated from v#" badge when iteratedFromId is set
- Click navigates to `/ad-creator?version={id}`

---

## 4. Integration Points

### SalesNavBar (`src/components/SalesNavBar.tsx`)
- Add: `{ href: "/ad-creator", label: "📣 Ads", statusKey: "adCreator" }`

### Document Share (`src/app/api/documents/share/route.ts`)
- Add `"adCreator"` to `validTypes` array

### Document Clone (`src/app/api/documents/clone/route.ts`)
- Add `"adCreator"` case to switch statement

### SharedDocClient (`src/app/share/doc/[code]/SharedDocClient.tsx`)
- Add `adCreator: "Ad Creator"` to typeLabels

### Import Route (`src/app/api/import/route.ts`)
- Add `"adCreator"` to `VALID_APPLET_TYPES` and merge config

### Sequence Conversation (`src/lib/sequences/sequence-conversation.ts`)
- Add `"ad-creator"` type support

---

## 5. Generated Output Structure

Single markdown document with anchored headers per platform:

```markdown
# Ad Concepts: [Company] → [Target Audience]

## LinkedIn Ads {#linkedin-ads}

### Concept 1: [Theme Name]
**Ad Format:** Sponsored Content (Single Image)
**Headline:** ...
**Intro Text:** ...
**Description:** ...
**CTA:** ...
**Creative Direction:** [Visual description — imagery, mood, style, color palette]

### Concept 2: [Theme Name]
...

---

## Facebook & Instagram Ads {#facebook-instagram-ads}

### Concept 1: [Theme Name]
**Ad Format:** Feed Ad
**Primary Text:** ...
**Headline:** ...
**Description:** ...
**CTA:** ...
**Creative Direction:** ...

### Concept 2: Story Ad Concept
...

---

## Google SEM Ads {#google-sem-ads}

### Ad Group 1: [Theme/Intent]
**Headlines:** (up to 15, max 30 chars each)
1. ...
**Descriptions:** (up to 4, max 90 chars each)
1. ...
**Target Keywords:** ...
```

Each platform section only appears if that platform was selected. Creative Direction notes describe visual concepts (imagery, mood, style, color palette, composition ideas).

---

## 6. AI Prompt Strategy

### Generate Prompt
- Instructions first (survives chunking truncation)
- Platform-specific format requirements with character limits
- Creative Direction note required for each concept
- Tone: authentic, founder-led, not corporate
- Output: clean markdown with `{#anchor-id}` on platform headers

### Iterate Prompt
- Includes previous version's full output
- User's iteration guidance
- "Keep what works, improve what was called out"
- Generates complete new document

---

## 7. File Checklist

**New files:**
- [ ] `prisma/migrations/YYYYMMDD_add_ad_creator/migration.sql`
- [ ] `src/app/ad-creator/page.tsx`
- [ ] `src/app/ad-creator/history/page.tsx`
- [ ] `src/app/api/ad-creator/generate/route.ts`
- [ ] `src/app/api/ad-creator/iterate/route.ts`
- [ ] `src/app/api/ad-creator/latest/route.ts`
- [ ] `src/app/api/ad-creator/history/route.ts`
- [ ] `src/app/api/ad-creator/versions/[id]/route.ts`
- [ ] `src/app/api/ad-creator/prefill-personas/route.ts`

**Existing files to modify:**
- [ ] `prisma/schema.prisma` — Add AdCreatorVersion model + User relation
- [ ] `src/components/SalesNavBar.tsx` — Add nav item
- [ ] `src/app/api/documents/share/route.ts` — Add to validTypes
- [ ] `src/app/api/documents/clone/route.ts` — Add clone case
- [ ] `src/app/share/doc/[code]/SharedDocClient.tsx` — Add type label
- [ ] `src/app/api/import/route.ts` — Add applet type
- [ ] `src/lib/sequences/sequence-conversation.ts` — Add type label
