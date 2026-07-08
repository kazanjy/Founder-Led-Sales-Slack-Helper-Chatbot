# Business Cases Suite — Discovery Summary · ROI Model · Business Case

## Concept

Three sibling artifact types that turn the founder's playbook + deal evidence into
customer-facing (or internal-champion-facing) documents:

1. **Discovery Summary** — "here's the opportunity as we understand it today":
   situation, pains, quantified impact, stakeholders, decision process, open gaps.
   The persisted, versioned sibling of Deal Chat's "🔎 Synthesize Discovery"
   (which stays — chat is for thinking, this is for producing the artifact).
2. **ROI Model** — an economic model of what the product delivers, derived from
   the sales narrative's value argument: value drivers → assumptions → math →
   annual value, against cost → payback period / ROI multiple.
3. **Business Case** — the composed document a champion can carry to their
   economic buyer: exec summary, current state (← discovery summary), proposed
   solution, economics (← ROI model), risks, implementation, recommendation.

Each type follows the same two-layer lifecycle:

- **Template** (per user, authored once, versioned): generated from playbook
  assets — SALES_NARRATIVE, VALUE_PROP_100W, discovery questions, first-call
  checklist, ICP — then edited by the founder until it reflects THEIR economic
  argument and THEIR discovery structure. This is the "draft ROI model from the
  sales narrative" step.
- **Instance** (per deal / per run): the template filled in from real evidence —
  call transcripts, deal timeline, participants — then edited by the founder.

## Data model — one spine, not six tables

The audit flagged the 6 near-identical persona Version tables as accreted
redundancy. These three types share structure, so they get ONE discriminated
pair from day one:

```prisma
// Per-user template, versioned by row (newest = current), same pattern as
// DiscoveryQuestionsVersion but shared across the three types.
model BusinessCaseTemplate {
  id      String @id @default(cuid())
  userId  String
  user    User   @relation(...)
  type    String // "discovery_summary" | "roi_model" | "business_case"
  content String @db.Text // markdown, with {{PLACEHOLDER}} slots for instance fill
  // Provenance: which playbook inputs seeded the generation (ids + labels),
  // so "regenerate template" can diff/refresh when the narrative changes.
  sourceInputs Json?
  createdAt DateTime @default(now())
  @@index([userId, type, createdAt(sort: Desc)])
  @@map("business_case_templates")
}

// A generated + user-edited artifact. dealId null = ad-hoc run (pasted
// transcripts / picked calls with no deal attached).
model BusinessCaseInstance {
  id         String  @id @default(cuid())
  userId     String
  user       User    @relation(...)
  type       String  // same discriminator
  templateId String? // template version used at generation time
  dealId     String?
  deal       Deal?   @relation(...)
  title      String  // e.g. "Acme Corp — Discovery Summary"
  content    String  @db.Text // markdown; editable in place
  // What we fed the model (transcript titles/dates, deal snapshot summary) —
  // for regeneration and "what was this based on?" display.
  sourceContext String? @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([userId, type, createdAt(sort: Desc)])
  @@index([dealId, type])
  @@map("business_case_instances")
}
```

Edits update `content` in place (updatedAt tracks it); "Regenerate" creates a
new instance so nothing is lost. Both tables land in ONE additive migration.

## Generation flows

### Template authoring (applet page, per type)

"Generate from my playbook" → server assembles SALES_NARRATIVE + VALUE_PROP_100W
+ latest discovery questions + first-call checklist (+ ICP for business case) →
type-specific prompt → markdown template → editable in RichTextEditor, saved as
a new template row.

- **Discovery Summary template**: section skeleton mirroring the founder's own
  discovery framework — their question categories become the summary's sections,
  with guidance per section on what evidence fills it. (Falls back to a
  situation/pain/impact/stakeholders/process/gaps default when they haven't
  authored discovery questions.)
- **ROI Model template**: extract the VALUE ARGUMENT from the narrative →
  enumerate value drivers (cost saved / revenue gained / risk reduced / time
  saved), each as: driver → input assumptions ({{PLACEHOLDER}} slots) →
  calculation → annual value. Then cost side (price, implementation, ramp) →
  payback period + ROI multiple. Markdown tables, math shown inline.
- **Business Case template**: composition skeleton referencing the other two
  ("Current state — from Discovery Summary", "Economics — from ROI Model") plus
  exec summary / solution / risks / implementation / recommendation sections.

### Instance generation — 4 entry points, ONE input shape

All four triggers normalize to the same payload before hitting one endpoint:

```
POST /api/business-cases/generate
{ type, dealId?, title?, transcripts?: [{title, date, content}], extraText? }
```

1. **Deal page** — "Generate Discovery Summary" (etc.) in the deal header /
   Business Case section: server pulls the deal's full timeline (transcripts,
   notes, emails), participants, latest analysis. Richest path.
2. **Applet page → live deal picker** — dropdown of active deals (same list the
   nav's deal search uses); server assembles identical deal context.
3. **Applet page → paste transcripts** — textarea; becomes `extraText`.
4. **Applet page → call importer** — embed `MeetingRecorderPanel` with the
   existing `onSelectCalls` multi-select (already returns
   `{transcript, summary, title, date, attendees}[]`); becomes `transcripts`.

Server-side assembly for every path: current template (of that type) + seller
context (loadSellerContext — narrative default-on invariant) + evidence →
gpt-5.5 → instance saved → user lands in the editor.

**Composition rule**: generating a Business Case for a deal first looks for that
deal's latest Discovery Summary + ROI Model instances and feeds them as primary
inputs (compose, don't re-derive). Missing pieces → generate from raw evidence
and note it.

## UI

- **Route**: `/business-cases` with three tabs: Discovery Summary · ROI Models ·
  Business Cases. Each tab: template card on top (view / edit / regenerate),
  instance list below (grouped: by deal, then ad-hoc), each instance → editor
  view with Copy (copyMarkdownAsRichText, same as coaching synthesis) and
  "Chat About This" (DIRECT mode).
- **Nav**: add to `callExecutionItems`-adjacent position as a standalone item —
  "💼 Business Cases" (statusKey: businessCases).
- **Deal page**: "Business Case" card in the right rail (or below analysis):
  lists this deal's instances by type + generate buttons per type. Generated
  artifacts deep-link to `/business-cases?instance=<id>`.

## Agent / platform integration (rides existing rails)

- **Deal agent tools**: `getBusinessCaseArtifacts(dealId)` → instances feed deal
  conversations; `buildDealChatContext` gains a "Business case artifacts" section
  listing titles + links (not full content — the tool fetches on demand).
- **Attachment picker + share**: register the three artifact types wherever the
  9-attachment catalog is defined (or fold into A3's registry if built by then).
- **Slack**: "generate a discovery summary for Acme" routes through the deal
  agent → new tool `generateBusinessCaseArtifact(dealId, type)`. Phase 3.

## Phasing — Discovery Summary first

**Phase 1 — Discovery Summary end-to-end (M/L, ~2-3 days)**
1. Migration: both tables (one migration, even though ROI/BC wait).
2. Template: generate route + prompt (discovery-framework-shaped), applet page
   with template card + editor.
3. Instance: `/api/business-cases/generate` with all 4 entry points' input
   normalization; deal-context assembly server-side.
4. UI: `/business-cases` route (tabs scaffolded, only tab 1 live), deal-page
   generate button + instance list, editor + Copy + Chat About This.
5. Nav item + deal agent `getBusinessCaseArtifacts` tool.

**Phase 2 — ROI Model (M)**
Template prompt (value-driver extraction), instance fill (numbers from
transcripts where quoted, {{PLACEHOLDER}} slots left visible where unknown —
never invent customer numbers), tab 2 live.

**Phase 3 — Business Case + distribution (M)**
Composition generation (discovery summary + ROI model as inputs), tab 3 live,
attachment-picker registration, Slack generation tool, share-page support.

## Design decisions (made — flag if you disagree)

- **ROI model format: markdown tables, not a calc engine.** The LLM shows its
  math inline; the founder edits numbers in the editor. A structured
  spreadsheet-lite (recompute on assumption change) is a later enhancement ONLY
  if real usage demands it — it roughly doubles Phase 2.
- **Instances edit in place; Regenerate creates a new instance.** No draft/final
  state machine in v1.
- **Never invent customer numbers.** Instance fill quotes evidence for every
  number it places ("~$40K/yr — 'we spend about 40 grand on that tool'"); slots
  without evidence stay as visible {{PLACEHOLDERS}} for the founder to fill.
- **Synthesize Discovery button on Deal Chat stays** — chat exploration and
  artifact generation are different jobs; the artifact CTA lives next to it.
