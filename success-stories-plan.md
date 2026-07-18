# Quotes & Success Stories — customer proof, extracted once, published everywhere

## The idea

Customer calls are full of proof — "we cut close time from 9 days to 3",
"the team actually likes using it", "we'd never go back" — and it dies in
transcripts. This applet extracts it into durable PROOF POINTS aligned
with the founder's sales narrative, then projects those points into any
combination of publishing MEDIUM × FORMAT. Extract once; publish
everywhere.

The pipeline (each layer feeds the next; the middle layer is the asset):

```
SOURCES                    PROOF POINTS                 MEDIUMS                    FORMATS
paste transcripts     →    extracted, quoted,      →    testimonial           ×    LinkedIn post
recorder import            narrative-aligned,           blind testimonial          tweet / thread
deal timeline calls        deduped, time-arced          success story (¶s)         web / blog text
+ theme focus                                           case study (arc)           slide outline
```

## Sources — one call or many, arcs welcome

- **Paste** — a single transcript (one call where the customer rattles
  off wins) or SEVERAL calls added one at a time (title + date +
  content each). The UI copy says it explicitly: *"One call works —
  someone listing their wins. Multiple calls over time work better:
  Mikey tracks the before → after arc."*
- **Recorder import** — reuse the existing call-import widget (the
  same provider plumbing as Bulk Import Calls): list recent recorded
  calls, checkbox one or many, pull title/date/transcript in.
- **Deal import** — pick a deal, pull its call_summary/call_transcript
  entries. A closed-won deal IS a success-story source; this is also
  the natural CTA location later ("📣 Make success assets from this
  deal").
- **Theme focus (optional field)** — free text that flavors the
  extraction: *"They talked about how fast implementation was — focus
  on time-to-value and the CFO's reaction."* Appended to the backend
  prompt as a PRIORITY lens, never replacing the generic extraction.

## Layer 1 — Proof point extraction (the canonical asset)

One LLM pass over all sources + the founder's sales narrative + value
prop. Output: structured proof points, each carrying:

- `claim` — the human-readable proof statement ("Cut monthly close
  from 9 days to 3 within two months of onboarding")
- `quote` — VERBATIM supporting quote from the evidence (mandatory —
  no quote, no proof point; same discipline as outcome extraction)
- `speaker` + `role` + `date` — who said it, when
- `metric` — the number when one exists (before → after where the
  arc shows change over time)
- `narrativePillar` — which part of the founder's sales narrative
  this proves (alignment is the point: proof that doesn't ladder to
  the narrative is trivia)
- `arc` — for multi-call sources: `single` | `before_after` |
  `progression` with the date range
- `themeMatch` — whether it hits the user's theme focus

Proof points render as reviewable cards (quote + claim + metric +
pillar tag); the user can include/exclude and edit claims before
generation. Persisted on the collection so re-generation into new
formats never re-runs extraction.

## Layer 2 — Mediums (what the proof becomes)

- **Customer testimonial** — attributed first-person quote block,
  lightly polished from verbatim, with name/role/company.
- **Blind testimonial** — third-person, anonymized ("a Series B
  fintech CFO"), for when logo rights don't exist yet. Anonymization
  rules: strip names/company/identifying specifics, keep the metric.
- **Success story** — 2-4 paragraphs: situation, what changed, the
  proof. Single-call sources get "state of success" framing;
  multi-call sources get the over-time arc.
- **Case study** — the long form: situation → why they bought →
  implementation → results over time → where they're going. Wants
  multi-call sources; the UI nudges that.

## Layer 3 — Formats (where it publishes)

- **LinkedIn post** — hook line, short paragraphs, founder voice.
- **Tweet / thread** — single tweet for testimonials, thread for
  stories/case studies.
- **Web / blog text** — clean markdown, headline + subheads.
- **Slide outline** — headline-per-slide markdown; Gamma CTA reuses
  the existing business-case Gamma integration in a later phase.

Not every medium × format cell makes sense (case-study-as-single-tweet
→ auto-upgrades to thread). The generation prompt owns per-cell rules;
the UI presents medium and format as two pickers with the nonsense
combos disabled.

Every generated asset: rich-text + markdown copy buttons (existing
clipboard utility), regenerate button, kept as rows so a collection
accretes a library of assets from one extraction.

## Data model (additive, no changes to existing tables)

```prisma
model SuccessStoryCollection {
  id           String  @id @default(cuid())
  userId       String  // relation, cascade
  title        String  // "Agent Universe — success"
  customerName String?
  dealId       String? // optional deal linkage (source + future CTA)
  themeFocus   String? @db.Text
  // [{ title, date, source: "paste"|"recorder"|"deal", provider?,
  //    providerCallId?, entryId?, content }]
  sources      Json
  // [{ id, claim, quote, speaker, role?, date?, metric?,
  //    narrativePillar?, arc, themeMatch, included }]
  proofPoints  Json?
  proofPointsAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  assets SuccessAsset[]
}

model SuccessAsset {
  id           String @id @default(cuid())
  collectionId String // relation, cascade
  medium       String // testimonial | blind_testimonial | success_story | case_study
  format       String // linkedin | tweet | web | slides
  content      String @db.Text
  createdAt    DateTime @default(now())
}
```

## Page + plumbing

- `/success-stories` under the Content family nav.
- Left rail: collections (one per customer/story). Main: sources →
  theme focus → [Extract Proof Points] (demonstrative spinner) →
  proof point cards with include toggles → medium/format pickers →
  [Generate] → asset library with copy/regenerate.
- API: collections CRUD, `/extract` (proof points), `/generate`
  (medium+format → asset row). Extraction evidence budget follows the
  house rule: no arbitrary clamps; full transcripts in (600K cap,
  newest-first).
- Narrative alignment: `loadSellerContext` narrative + value prop in
  both extraction and generation prompts, so assets come out in the
  founder's language and prove the founder's claims.

## Phasing

1. **Phase 1 — the working core (M)**: schema + migration; page with
   paste-sources (multi-call), theme focus, extraction → proof point
   cards (include/exclude), generation for ALL four mediums in web
   format; copy buttons. Proves the pipeline end to end.
2. **Phase 2 — import + formats (M)**: recorder call-import widget;
   deal import (+ "📣 Success assets" CTA on closed-won deal pages);
   LinkedIn / tweet / slide-outline formats with per-cell rules;
   regenerate.
3. **Phase 3 — distribution polish (S/M)**: Gamma slide deck CTA
   (reuse business-case integration); publish-to-Collateral-Library
   bridge (audit item A7) so assets land where the team finds them;
   proof point editing.

## Open questions (flag before Phase 1 if you disagree)

- One collection per CUSTOMER (accreting calls over time) rather than
  per generation session — collections are living documents that grow
  as more calls land. Re-extraction merges: existing proof points
  keep their include/exclude decisions (carry-forward, same as
  outcome extraction).
- Blind testimonials always strip metrics' company context but KEEP
  the numbers — anonymized proof without numbers is noise.
- Slide format ships as markdown outline in Phase 1-2; Gamma render
  is Phase 3.
