# SEO Planner Applet — Implementation Plan

## Overview

A sales-driven SEO planning tool that generates keyword strategies and content briefs based on the founder's Sales Narrative and ICP. Unlike generic SEO tools, this focuses on **buyer-intent keywords** — the terms prospects search when they have the problem the founder solves.

## Why This Matters for Founder-Led Sales

Most founders either ignore SEO entirely or waste time on vanity keywords. The SEO Planner bridges the gap between "what we sell" (Sales Narrative) and "what buyers Google" by:

1. Extracting pain points from the narrative and mapping them to search queries
2. Identifying bottom-of-funnel terms where prospects are actively looking for solutions
3. Generating content briefs founders can actually execute on (blog posts, landing pages, comparison pages)
4. Prioritizing by buyer intent, not just search volume

## Input Sources

| Source | What It Provides | Required? |
|--------|-----------------|-----------|
| Sales Narrative | Problem description, value prop, differentiation, target market | Yes |
| ICP | Who's searching — titles, industries, company types | Yes |
| Discovery Questions | Pain points and objections buyers have | Optional (enriches) |
| First Call Checklist | Competitive landscape, buyer journey stages | Optional (enriches) |
| Competitor URLs | What competitors rank for (gap analysis) | Optional |

## Output: SEO Strategy Document

### 1. Keyword Clusters

Grouped by buyer intent stage:

**Problem-Aware** (top-of-funnel)
- "how to reduce [pain point]"
- "[industry] challenges with [problem]"
- "why does [problem] happen"

**Solution-Aware** (mid-funnel)
- "[category] software"
- "best [solution type] for [industry]"
- "how to fix [problem]"

**Product-Aware** (bottom-of-funnel)
- "[competitor] alternative"
- "[product category] comparison"
- "[your brand] vs [competitor]"
- "[product category] pricing"

### 2. Content Briefs (per keyword cluster)

For each priority cluster, generate:
- **Target keyword** + related terms
- **Search intent** (informational / commercial / transactional)
- **Suggested title** (SEO-optimized)
- **Content outline** (H2/H3 structure)
- **Word count target**
- **CTA suggestion** (what action should the reader take?)
- **Internal linking** opportunities (to other planned content)
- **Founder angle** — how to inject authentic founder perspective

### 3. Prioritization Matrix

Each keyword cluster scored on:
- **Buyer Intent** (1-5): How likely is the searcher to become a customer?
- **Estimated Volume** (1-5): Relative search volume
- **Competition** (1-5): How hard is it to rank?
- **Founder Fit** (1-5): Can the founder authentically write about this?
- **Priority Score**: Weighted combination

### 4. Content Calendar

- Suggested publishing order (high-priority, low-competition first)
- Recommended frequency
- Pillar vs. supporting content structure

## Data Model

```prisma
model SeoStrategyVersion {
  id String @id @default(cuid())

  userId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Source references
  salesNarrativeVersionId String
  salesNarrativeVersion   SalesNarrativeVersion @relation(fields: [salesNarrativeVersionId], references: [id], onDelete: Cascade)

  icpVersionId String?
  icpVersion   IcpVersion? @relation(fields: [icpVersionId], references: [id], onDelete: SetNull)

  // Input
  competitorUrls String[] // optional competitor URLs for gap analysis
  additionalContext String? @db.Text // any extra guidance from user

  // Output
  title   String
  content String @db.Text // full strategy document (markdown)

  // Structured data (JSON)
  keywordClusters String? @db.Text // JSON: array of cluster objects
  contentBriefs   String? @db.Text // JSON: array of brief objects
  priorityMatrix  String? @db.Text // JSON: scored/ranked clusters

  // Metadata
  conversationId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@map("seo_strategy_versions")
}
```

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/seo-planner/latest` | Get latest strategy version |
| GET | `/api/seo-planner/versions/[id]` | Get specific version |
| POST | `/api/seo-planner/generate` | Generate new strategy (SSE streaming) |
| PATCH | `/api/seo-planner/versions/[id]` | Update/edit content |
| DELETE | `/api/seo-planner/versions/[id]` | Delete version |
| POST | `/api/seo-planner/iterate` | Iterate on existing strategy |
| GET | `/api/seo-planner/history` | List all versions |

## Generation Flow

### Step 1: Gather Context
```
Sales Narrative → extract problem, value prop, market, differentiation
ICP → extract target titles, industries, company types
Discovery Questions → extract pain points, objections
First Call Checklist → extract competitive landscape
```

### Step 2: Generate Keyword Clusters (LLM Call 1)
```
Prompt: "Given this B2B product/market context, generate keyword clusters
organized by buyer intent stage (problem-aware, solution-aware, product-aware).
For each cluster: primary keyword, related terms, estimated intent strength,
and why this matters for this specific product."
```

### Step 3: Generate Content Briefs (LLM Call 2)
```
Prompt: "For each of these keyword clusters, create a content brief:
title, outline, word count, CTA, founder angle. Prioritize by
buyer intent × founder authenticity."
```

### Step 4: Score & Prioritize (LLM Call 3 or algorithmic)
```
Score each cluster on intent/volume/competition/fit dimensions.
Generate priority matrix and recommended content calendar.
```

### Step 5: Stream Results
- Stream the full strategy document via SSE
- Save structured data (clusters, briefs, matrix) as JSON alongside markdown

## UI Design

### Page Layout (`/seo-planner`)

```
SEO Strategy Planner
Generated from your Sales Narrative + ICP

[Tabs: Strategy Overview | Keyword Clusters | Content Briefs | Calendar]

┌─────────────────────────────────────────────────────────────┐
│ Strategy Overview                                            │
│                                                              │
│ Based on your sales narrative for [product], targeting       │
│ [ICP titles] at [ICP companies], here are the search terms  │
│ your buyers are using and content you should create.         │
│                                                              │
│ Quick Stats:                                                 │
│ • 12 keyword clusters identified                             │
│ • 8 content briefs generated                                 │
│ • 3 high-priority "quick win" opportunities                  │
│ • Estimated 6-month content calendar                         │
└─────────────────────────────────────────────────────────────┘
```

### Keyword Clusters Tab

```
┌─ PROBLEM-AWARE (Top of Funnel) ──────────────────────────┐
│                                                            │
│  🔴 High Priority                                         │
│  "how to reduce AP accrual errors"                        │
│  Related: accrual automation, month-end close errors       │
│  Intent: Informational → Commercial                        │
│  Buyer Fit: ★★★★★                                         │
│  [Generate Content Brief →]                                │
│                                                            │
│  🟡 Medium Priority                                        │
│  "accounts payable automation software"                    │
│  Related: AP workflow, invoice processing automation       │
│  Intent: Commercial                                        │
│  Buyer Fit: ★★★★☆                                         │
│  [Generate Content Brief →]                                │
└────────────────────────────────────────────────────────────┘
```

### Content Brief Detail

```
┌─ Content Brief: "Why AP Accruals Are a Data Problem" ─────┐
│                                                             │
│  Target Keyword: AP accrual automation                      │
│  Word Count: 1,200-1,500                                    │
│  Content Type: Blog post                                    │
│  Search Intent: Problem-aware → Solution-aware              │
│                                                             │
│  Outline:                                                   │
│  H1: Why AP Accruals Are a Missing Data Problem (Not an     │
│      Accounting Problem)                                    │
│  H2: The Real Cost of Manual Accruals                       │
│  H2: Why Spreadsheets Can't Fix This                        │
│  H2: What Modern AP Automation Actually Does                │
│  H2: How [Your Product] Approaches This Differently         │
│  H2: Getting Started                                        │
│                                                             │
│  Founder Angle: Write from experience — share a specific    │
│  customer story where they discovered the data problem      │
│                                                             │
│  CTA: "See how [product] automates AP accruals →"          │
│                                                             │
│  [📱 Generate Social Posts from This Topic]                  │
│  [✍️ Draft This Article with AI]                            │
└─────────────────────────────────────────────────────────────┘
```

## Integration Points

### 1. Sales Readiness Checklist
- "Search Engine Marketing" readiness item links to → `/seo-planner`
- Auto-mark as "in_progress" when first strategy is generated

### 2. Social Posts
- "Generate Social Posts from This Topic" button on each content brief
- Pre-fills the social content generator with the keyword/topic

### 3. Content Pipeline
- Content briefs can be exported as a CSV/spreadsheet
- Each brief links back to the keyword cluster that inspired it

### 4. Coaching Context
- Include SEO strategy summary in coaching chat context
- "You have 3 high-priority content topics waiting to be written"

### 5. Ad Creator
- Keyword clusters inform ad targeting
- Content briefs suggest ad angles

## Implementation Phases

### Phase 1: Core Generation
- Schema + migration
- Generate endpoint (streaming SSE)
- Basic strategy document with keyword clusters + content briefs
- Page UI with strategy overview

### Phase 2: Structured Output
- Parse keyword clusters into structured JSON
- Priority matrix with scoring
- Tabs: Overview / Clusters / Briefs
- Iterate widget (refine strategy based on feedback)

### Phase 3: Content Calendar + Integration
- Calendar view with recommended publishing order
- Social posts integration (generate from topic)
- Export to CSV
- Sales Readiness auto-status
- History / versioning

### Phase 4: Competitor Analysis (Optional)
- Accept competitor URLs
- Crawl and analyze what they rank for
- Identify content gaps
- "They rank for X, you should write about Y"
