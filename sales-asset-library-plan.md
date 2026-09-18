# Sales Asset Library — Implementation Plan

## Overview

A simple landing page in the Playbook section that acts as the **single source of truth** for a founder-led sales team's current production GTM assets. Each slot holds a hyperlink to wherever the asset lives externally (Notion, Google Docs, Gamma, Loom, etc.) with full version history.

The page ships with 14 pre-seeded default slots covering the core GTM toolkit. Users can add custom asset types for anything specific to their workflow.

---

## Scope

- **Account-scoped** — the whole team sees the same library. Any team member can add/edit links.
- **Version history** — every URL change creates a new version. History shows who changed what and when.
- **External links** — this is for linking to production assets hosted elsewhere, not for duplicating content already in the app.

---

## Default Slots (14)

### Messaging
1. **Sales Narrative** — Core positioning and messaging doc
2. **Objections and FAQs** — Common objections with handles and FAQ responses

### Sales Materials
3. **Sales Deck** — Main pitch deck
4. **Sales Deck Script** — Talk track / speaker notes for the deck
5. **Demo Script** — Structured demo flow and talking points
6. **Demo Video** — Recorded demo or product walkthrough
7. **Pricing** — Pricing page, sheet, or calculator
8. **Business Case Template** — Template for building customer business cases
9. **ROI Model** — ROI calculator or model template

### Process
10. **Sales Playbook** — End-to-end sales process documentation
11. **First Call Checklist & Discovery Questions** — Checklist and question bank for first calls

### Customer Success / Onboarding
12. **Onboarding Checklist** — Steps for new customer onboarding
13. **Onboarding Deck** — Kickoff / onboarding presentation

### Legal / Commercial
14. **Order Form Template** — Standard order form or contract template

---

## Data Model

### SalesAsset

```
SalesAsset
├── id (cuid)
├── accountId (FK → Account)
├── name (String) — "Sales Narrative", "Demo Video", etc.
├── description (String?, nullable) — optional description
├── category (String) — "messaging" | "materials" | "process" | "onboarding" | "legal" | "custom"
├── isDefault (Boolean) — true for the 14 pre-seeded slots
├── slotKey (String?, nullable) — stable key for defaults: "salesNarrative", "demoScript", etc.
├── order (Int) — display order within category
├── currentUrl (String?, nullable) — denormalized latest URL
├── currentLabel (String?, nullable) — denormalized latest label
├── currentVersionId (String?, nullable) — FK to latest version
├── versions → SalesAssetVersion[]
├── createdAt, updatedAt
@@unique([accountId, slotKey])
@@index([accountId])
@@map("sales_assets")
```

### SalesAssetVersion

```
SalesAssetVersion
├── id (cuid)
├── assetId (FK → SalesAsset)
├── url (String) — the hyperlink
├── label (String?, nullable) — e.g. "Q4 2025 version", "Post-rebrand"
├── notes (String?, nullable) — optional context about the change
├── createdByUserId (FK → User) — who made the change
├── createdByUser → User (relation)
├── createdAt
@@index([assetId, createdAt])
@@map("sales_asset_versions")
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sales-asset-library` | GET | List all assets for the account (auto-seeds defaults on first visit) |
| `/api/sales-asset-library` | POST | Create a custom asset type |
| `/api/sales-asset-library/[id]` | PATCH | Update asset name, description, order, category |
| `/api/sales-asset-library/[id]` | DELETE | Delete a custom asset (only `isDefault=false`) |
| `/api/sales-asset-library/[id]/versions` | GET | List all versions for an asset |
| `/api/sales-asset-library/[id]/versions` | POST | Create a new version (= update the URL) |

---

## UI Design

### Page: `/sales-asset-library`

```
📚 Sales Asset Library
Your team's current production GTM assets. Update links here as assets evolve.

── Messaging ──────────────────────────────────────────────────

┌─────────────────────────────────────────────────────────────┐
│ Sales Narrative                                              │
│ 🔗 https://notion.so/team/sales-narrative-v3        [Open ↗] │
│ Updated 3 days ago by Pete · 2 prior versions    [Edit] [⋯] │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Objections and FAQs                                          │
│ No URL yet                                          [+ Add]  │
└─────────────────────────────────────────────────────────────┘

── Sales Materials ────────────────────────────────────────────

┌─────────────────────────────────────────────────────────────┐
│ Sales Deck                                                   │
│ 🔗 https://gamma.app/docs/pitch-deck-v4             [Open ↗] │
│ Updated yesterday by Sarah · 5 prior versions    [Edit] [⋯] │
└─────────────────────────────────────────────────────────────┘

...

[+ Add Custom Asset]
```

### Edit Flow

1. Click "Edit" (or "+ Add" for empty slots) → modal opens
2. Modal shows:
   - Current URL (pre-filled if editing)
   - Label field (optional, e.g. "Post-rebrand version")
   - Notes field (optional, e.g. "Updated pricing section")
3. Save → creates a new `SalesAssetVersion`, updates the asset's `currentUrl`/`currentLabel`
4. The old URL stays in version history

### Version History

1. Click "X prior versions" → expandable panel showing all versions
2. Each version shows: URL (clickable), label, notes, who, when
3. "Restore" button on old versions → creates a new version pointing to that URL
4. Versions are never deleted

### Custom Assets

1. "+ Add Custom Asset" → inline form: name + category dropdown + URL
2. Creates a new `SalesAsset` with `isDefault=false`
3. Can be renamed, recategorized, or deleted
4. Default slots can be renamed but not deleted (hidden at most)

---

## Navigation

Add to the Playbook dropdown in SalesNavBar:
```
📚 Sales Asset Library
```

Route: `/sales-asset-library`

---

## Auto-Seeding Logic

On first GET for an account (no `SalesAsset` records exist):
1. Create all 14 default slots with `isDefault=true`, no URL
2. Return them in category/order

On subsequent visits: return existing records.

---

## Key Design Decisions

- **Account-scoped** — shared across the team, not per-user
- **External links only** — no overlap with in-app modules (Sales Narrative builder, ICP, etc.)
- **Version history is append-only** — every change is a new version, old URLs preserved
- **Default slots are stable** — `slotKey` ensures they survive renames
- **No file storage** — just hyperlinks. Assets live wherever the team keeps them.
- **Categories are cosmetic** — for grouping on the page, not for filtering/logic

---

## Implementation Staging

### Phase 1: Foundation (shippable)
1. DB models + migration — SalesAsset, SalesAssetVersion
2. Auto-seed logic for 14 defaults
3. Core API — GET (list + auto-seed), POST (custom asset), PATCH, DELETE
4. Version API — GET (history), POST (new version)
5. Basic page UI — category sections, asset cards, empty states
6. Nav — add to Playbook dropdown

### Phase 2: Edit & History
7. Edit modal — URL, label, notes fields
8. Version history expandable panel
9. "Restore" from old version
10. Who/when attribution on versions

### Phase 3: Polish
11. Drag-to-reorder within categories
12. Custom category creation
13. Search/filter
14. "Copy URL" button
15. Empty state with helpful onboarding copy

---

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | SalesAsset, SalesAssetVersion models |
| `src/app/sales-asset-library/page.tsx` | Main page |
| `src/app/api/sales-asset-library/route.ts` | List + create assets |
| `src/app/api/sales-asset-library/[id]/route.ts` | Update + delete asset |
| `src/app/api/sales-asset-library/[id]/versions/route.ts` | List + create versions |
| `src/lib/sales-asset-library/seed-data.ts` | Default slot definitions |
| `src/components/SalesNavBar.tsx` | Add nav link |
