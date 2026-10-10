# Blog Post Generator — Implementation Plan

## Overview

A founder-voice blog post generator that takes a content brief from the SEO Planner (or a custom topic) and drafts a full, publish-ready article. The key differentiator: it writes in the **founder's authentic voice** using the Sales Narrative as the voice/perspective source, and structures the content for **SEO performance** using the keyword cluster data.

## Why This Matters

Founders know they should blog but:
1. They don't have time to write 1,200-word articles
2. They don't know what to write about (SEO Planner solves this)
3. Generic AI content sounds like generic AI content
4. They need content that ranks AND converts

The Blog Generator solves all four: topics come from the SEO Planner, voice comes from the Sales Narrative, structure comes from the content brief, and the output is optimized for both search and conversion.

## Input Sources

| Source | What It Provides | Required? |
|--------|-----------------|-----------|
| Content Brief (from SEO Planner) | Target keyword, outline, word count, CTA, founder angle | Option A |
| Custom Topic | Freeform topic input | Option B |
| Sales Narrative | Founder's voice, value prop, problem framing | Yes (auto-loaded) |
| ICP | Who the article is for | Optional (enriches) |
| Gold Standard Examples | Example blog posts the founder likes | Optional |

## Output

A complete, publish-ready blog post including:

- **SEO-optimized title** (with target keyword)
- **Meta description** (155 chars, keyword-rich)
- **Full article** (markdown, 800-2000 words depending on brief)
  - Strong hook/intro that makes the reader feel understood
  - H2/H3 structure matching the content brief outline
  - Founder perspective woven throughout (not generic advice)
  - Data points, examples, and specifics (not platitudes)
  - Natural keyword placement (not stuffing)
  - CTA section at the end
- **Social promotion snippets** — 2-3 ready-to-post LinkedIn/Twitter teasers for the article
- **Internal linking suggestions** — where to link to other content

## Voice Calibration

The generator uses the Sales Narrative to calibrate voice:

```
Analyze the founder's Sales Narrative for:
- Tone (technical vs. conversational, formal vs. casual)
- Perspective (first-person founder, company "we", thought leader)
- Industry jargon level (heavy vs. accessible)
- Storytelling style (data-driven, anecdotal, contrarian)

Then write the blog post matching these characteristics.
```

If the user provides Gold Standard example posts, those override/supplement the voice calibration.

## Data Model

```prisma
model BlogPostVersion {
  id String @id @default(cuid())

  userId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Source references
  salesNarrativeVersionId String
  salesNarrativeVersion   SalesNarrativeVersion @relation(fields: [salesNarrativeVersionId], references: [id], onDelete: Cascade)

  seoStrategyVersionId String?  // optional link to SEO Planner
  contentBriefIndex    Int?     // which brief from the strategy (if from SEO Planner)

  // Input
  topic           String         // the topic/title being written about
  targetKeyword   String?        // primary SEO keyword
  relatedKeywords String[]       // secondary keywords
  outline         String? @db.Text  // content outline (from brief or custom)
  wordCountTarget Int     @default(1200)
  tone            String  @default("founder-voice") // "founder-voice" | "technical" | "casual" | "thought-leadership"
  customGuidance  String? @db.Text  // additional user instructions

  // Output
  title           String          // SEO-optimized article title
  metaDescription String?         // 155-char meta description
  content         String  @db.Text // full article (markdown)
  socialSnippets  String? @db.Text // JSON: array of social post teasers
  wordCount       Int?

  // Metadata
  conversationId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@map("blog_post_versions")
}
```

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/blog-generator/latest` | Get latest blog post |
| GET | `/api/blog-generator/versions/[id]` | Get specific version |
| POST | `/api/blog-generator/generate` | Generate blog post (SSE streaming) |
| PATCH | `/api/blog-generator/versions/[id]` | Edit title/content |
| DELETE | `/api/blog-generator/versions/[id]` | Delete version |
| POST | `/api/blog-generator/iterate` | Iterate with feedback |
| GET | `/api/blog-generator/history` | List all versions |

## Generation Flow

### From SEO Planner (primary flow)

```
Content Brief (keyword, outline, CTA, founder angle)
  + Sales Narrative (voice, perspective, value prop)
  + ICP (audience context)
  → LLM generates full article
  → Stream via SSE
  → Save with link back to SEO strategy
```

### From Custom Topic

```
User enters topic + optional keyword
  + Sales Narrative (voice)
  → LLM generates outline first (quick call)
  → User can edit outline
  → LLM generates full article from outline
  → Stream via SSE
```

## Prompt Structure

```
You are ghostwriting a blog post for a B2B founder. 

## VOICE REFERENCE (write like this person):
[Sales Narrative excerpt — 500 words]

## ARTICLE BRIEF:
- Topic: [topic]
- Target Keyword: [keyword]
- Related Keywords: [list]
- Target Audience: [ICP summary]
- Word Count: [target]
- Tone: [tone]

## OUTLINE:
[H2/H3 structure from content brief]

## FOUNDER ANGLE:
[specific angle from content brief]

## RULES:
1. Write in first person as the founder — share real perspectives, not generic advice
2. Open with a hook that makes the reader think "this person gets my problem"
3. Include specific examples, numbers, or anecdotes (invent plausible ones if needed)
4. Place the target keyword naturally in the title, first paragraph, one H2, and conclusion
5. NO filler paragraphs, NO "in today's fast-paced world", NO corporate clichés
6. End with a clear CTA: [CTA from brief]
7. Keep paragraphs short (2-3 sentences max for web readability)
8. Total word count: approximately [target] words

## OUTPUT FORMAT:
Return markdown with:
1. Title (H1)
2. Meta description (in a comment: <!-- meta: ... -->)
3. Full article with H2/H3 headings
4. After the article, add: ## Social Snippets with 2-3 LinkedIn/Twitter teasers
```

## UI Design

### Page Layout (`/blog-generator`)

```
Blog Post Generator
━━━━━━━━━━━━━━━━━━━

[Two entry points:]

┌─────────────────────────┐  ┌─────────────────────────┐
│  📝 From SEO Planner    │  │  ✨ Custom Topic         │
│                         │  │                         │
│  Pick a content brief   │  │  Enter any topic and    │
│  from your SEO strategy │  │  we'll draft it in your │
│  and we'll draft it.    │  │  founder voice.         │
│                         │  │                         │
│  [Select Brief ▾]       │  │  [Topic input...]       │
└─────────────────────────┘  └─────────────────────────┘
```

### Generation View (streaming)

```
┌─ Article ──────────────────────────────────────────────────┐
│                                                             │
│  # Why AP Accruals Are a Missing Data Problem               │
│                                                             │
│  <!-- meta: Stop treating AP accruals as an accounting      │
│  problem. Here's why it's actually a data problem — and     │
│  how to fix it. -->                                         │
│                                                             │
│  Every month-end, your accounting team does the same        │
│  thing: they open a spreadsheet, pull up last month's       │
│  accruals, and start guessing...                            │
│  [streaming in...]                                          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Word count: 1,247 · Reading time: ~5 min                   │
│  Target keyword: "AP accrual automation"                    │
│                                                             │
│  [📋 Copy]  [✏️ Edit]  [🔄 Iterate]  [📱 Social Snippets] │
└─────────────────────────────────────────────────────────────┘

┌─ Social Snippets ──────────────────────────────────────────┐
│                                                             │
│  LinkedIn:                                    [📋 Copy]     │
│  "Your AP team isn't 'doing accruals.'                      │
│  They're assembling evidence from 5 different               │
│  sources to book a defensible number for spend              │
│  that hasn't shown up as an invoice yet.                    │
│                                                             │
│  That's not an accounting problem.                          │
│  That's a missing-data problem. 🧵"                         │
│                                                             │
│  Twitter/X:                                   [📋 Copy]     │
│  "Hot take: AP accruals aren't an accounting                │
│  problem. They're a data problem.                           │
│                                                             │
│  New post on why and what to do about it →"                 │
└─────────────────────────────────────────────────────────────┘
```

### Right Sidebar

```
┌─ Iterate ──────────────────┐
│                             │
│  Describe changes...        │
│  [textarea]                 │
│                             │
│  [Apply Changes]            │
└─────────────────────────────┘

┌─ Article Stats ────────────┐
│  Words: 1,247               │
│  Reading time: ~5 min       │
│  Keyword density: 1.2%      │
│  Headings: 5 H2s            │
│  Paragraphs: 18             │
│  Avg sentence length: 14w   │
└─────────────────────────────┘
```

## Integration Points

### 1. SEO Planner → Blog Generator
- "Draft This Article" button on each content brief
- Pre-fills: topic, keyword, outline, CTA, founder angle
- Links back to the strategy version

### 2. Blog Generator → Social Posts
- "Generate Social Posts" button uses the article as source content
- Pre-fills social content generator with `topicSource: "content"` and the article text

### 3. Sales Readiness
- Links to "Social Posting Capability" and "Search Engine Marketing" readiness items

### 4. Navigation
- Add under Content dropdown: "📝 Blog Posts"
- Or group with SEO Planner under a new "Content Marketing" section

### 5. Export
- Copy as markdown
- Copy as HTML (for CMS paste)
- Download as .md file

## Implementation Phases

### Phase 1: Core Generation
- Schema + migration
- Generate endpoint (SSE streaming) with Sales Narrative voice calibration
- Custom topic flow (topic → outline → article)
- Page UI with streaming view
- Copy, edit, delete

### Phase 2: SEO Planner Integration
- "Draft This Article" button on SEO Planner content briefs
- Pre-fill from content brief data
- Link blog posts back to their source brief/strategy

### Phase 3: Social Snippets + Polish
- Auto-generate LinkedIn/Twitter teasers with each article
- Article stats sidebar (word count, reading time, keyword density)
- Iterate widget
- History/versioning

### Phase 4: Content Pipeline
- Content calendar view (blog + social combined)
- Export as HTML for CMS
- Track which briefs have been written vs. pending
- Auto-update SEO Planner to mark "drafted" briefs
