# Pre-Call Planning Applet — Implementation Plan

## Overview

A two-part feature:
1. **Pre-Call Planning Process** — A new applet (like Sales Narrative, Discovery Questions, First Call Checklist) where users generate and version their reusable pre-call planning steps
2. **Pre-Call Research** — A web-search-powered flow that takes a specific company/contact, researches them via Brave, and synthesizes the results against the user's planning process doc

The planning process must exist before research can run. This follows the same dependency chain pattern as the existing applets:

```
Sales Narrative → Discovery Questions → First Call Checklist → Pre-Call Planning Process
                                                                        ↓
                                                              Pre-Call Research
                                                            (per-account, on demand)
```

---

## Part 1: Pre-Call Planning Process Applet

### How It Works

This follows the **First Call Checklist pattern** (generated from upstream data, editable, markdown output). It does NOT have its own Q&A wizard — it generates from the user's existing Sales Narrative + Discovery Questions + First Call Checklist.

**User journey:**
1. User navigates to `/pre-call-planning`
2. If no Sales Narrative exists → prompt to create one first
3. If no version exists → show "Generate" screen
4. Click "Generate" → GPT-5 produces a pre-call planning process document
5. View the generated process with markdown rendering
6. Edit in place if needed (markdown editor, like First Call Checklist)
7. Regenerate to create new versions
8. Version history at `/pre-call-planning/history`

### What Gets Generated

The planning process doc is a reusable template — not specific to any account. It captures the user's methodology for preparing for calls, informed by their product/narrative:

```markdown
# Pre-Call Planning Process

## 1. Account Research Checklist
- Company basics (size, stage, industry, funding)
- Recent news and announcements
- Technology stack / current solutions
- Key competitors they may be evaluating
- ...

## 2. Contact Research Checklist
- Role, tenure, reporting structure
- LinkedIn activity and interests
- Previous interactions with your company
- Likely priorities given their role
- ...

## 3. Opportunity Qualification
- How does this account map to your ICP?
- Which pain points from your narrative are most relevant?
- What's the likely buying process?
- ...

## 4. Call Preparation
- Tailored discovery questions to prioritize
- Value prop talking points for this persona
- Objection handling prep
- Desired outcomes and next steps
- ...

## 5. Post-Call Debrief Template
- What did we learn?
- How did the discovery questions land?
- Next steps and follow-up items
- ...
```

### Database Models

Following the existing pattern exactly:

```prisma
model PreCallPlanningVersion {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Link to upstream: uses all three as inputs
  salesNarrativeVersionId       String
  salesNarrativeVersion         SalesNarrativeVersion @relation(fields: [salesNarrativeVersionId], references: [id])
  discoveryQuestionsVersionId   String?
  discoveryQuestionsVersion     DiscoveryQuestionsVersion? @relation(fields: [discoveryQuestionsVersionId], references: [id])
  firstCallChecklistVersionId   String?
  firstCallChecklistVersion     FirstCallChecklistVersion? @relation(fields: [firstCallChecklistVersionId], references: [id])

  content     String   @db.Text  // Markdown string (editable, like First Call Checklist)

  // Downstream: research executions use this as their template
  researchExecutions  PreCallResearch[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId, createdAt])
  @@map("pre_call_planning_versions")
}
```

**Why no Q&A model?** The planning process is generated from existing upstream data, not from new user Q&A. Same as Discovery Questions and First Call Checklist. The "inputs" are the Sales Narrative answers + the generated outputs from Discovery Questions and First Call Checklist.

### API Routes

Following the exact existing pattern:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/pre-call-planning/generate` | POST | Generate from latest upstream data |
| `/api/pre-call-planning/latest` | GET | Get latest version + dependency flags |
| `/api/pre-call-planning/versions` | GET | List all versions for history |
| `/api/pre-call-planning/versions/[id]` | GET | Get specific version |
| `/api/pre-call-planning/versions/[id]` | PATCH | Save manual edits |

### Generation Prompt Strategy

The generate endpoint:
1. Fetches latest `SalesNarrativeVersion` (with Q&A answers)
2. Fetches latest `DiscoveryQuestionsVersion` (parsed JSON categories)
3. Fetches latest `FirstCallChecklistVersion` (markdown content)
4. Builds a prompt asking GPT-5 to synthesize a reusable pre-call planning process
5. Stores result as markdown + upserts GTM variable `PRE_CALL_PLANNING`

**LLM choice:** This is the first place we use a **direct LLM call** (not Chatbase). Chatbase is for Pete's RAG knowledge base — here we need structured generation from user-specific data. Use OpenAI GPT-5 via the existing `openai.ts` module (already configured for vision).

### Pages

| Page | Path | Description |
|------|------|-------------|
| View/Edit | `/pre-call-planning` | View latest or `?version=id`, edit in place |
| History | `/pre-call-planning/history` | Version list with timestamps |

No separate `/edit` page needed — unlike Sales Narrative, there's no Q&A wizard. Generation is one-click from the main page.

### GTM Variable

```
Merge field: PRE_CALL_PLANNING
Name: "Pre-Call Planning Process"
```

Updated on generate and on manual edit (if latest version).

---

## Part 2: Pre-Call Research (Web Search)

### How It Works

Once the planning process exists, users can run research for a specific account:

**Slack:** `#precall Acme Corp, Jane Smith VP Sales` or `#callprep Acme Corp`
**Web App:** Dedicated UI within the pre-call planning applet page

### Data Flow

```
User Input: "Acme Corp, Jane Smith VP Sales"
    │
    ▼
┌──────────────────────────────┐
│ Step 1: Search Plan (GPT-5)  │
│ Generate 3-5 targeted queries │
│ based on company + contact   │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ Step 2: Brave Search API     │
│ Execute queries in parallel  │
│ Top 5 results per query      │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ Step 3: Parse Results (GPT-5)│
│ Extract & clean key facts    │
│ from search snippets/pages   │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ Step 4: Synthesize (GPT-5)   │
│ Merge research against:      │
│ - Pre-Call Planning Process   │
│ - Sales Narrative             │
│ - Discovery Questions         │
│ - First Call Checklist        │
│ → Produce account-specific   │
│   pre-call brief             │
└──────────────────────────────┘
```

### Database Model

```prisma
model PreCallResearch {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Link to the planning process used
  planningVersionId  String
  planningVersion    PreCallPlanningVersion @relation(fields: [planningVersionId], references: [id])

  // Input
  companyName   String
  contactName   String?
  contactRole   String?
  userNotes     String?   @db.Text  // Any extra context the user provided

  // Search data (for audit/debugging)
  searchQueries   String   @db.Text  // JSON: string[]
  searchResults   String   @db.Text  // JSON: condensed results

  // Output
  brief           String   @db.Text  // The final synthesized pre-call brief (markdown)

  // Metadata
  source          String   @default("web")  // "web" or "slack"
  conversationId  String?  // Link to conversation if created via Slack

  createdAt   DateTime @default(now())

  @@index([userId, createdAt])
  @@index([userId, companyName])
  @@map("pre_call_research")
}
```

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/pre-call-planning/research` | POST | Execute research for a company/contact |
| `/api/pre-call-planning/research/history` | GET | List past research briefs |
| `/api/pre-call-planning/research/[id]` | GET | Get specific research brief |

### Research Execution — Detailed Steps

**Step 1: Search Plan Generation**
```typescript
// src/lib/search/queries.ts
// Uses GPT-5 to generate targeted search queries

const prompt = `Given this company and contact, generate 3-5 web search queries
that would help a salesperson prepare for a first call.

Company: ${companyName}
Contact: ${contactName}, ${contactRole}

Generate queries to find:
1. Company overview, products, services, stage
2. Recent news, funding, announcements
3. Contact's professional background
4. Industry trends relevant to the company
5. Competitive landscape

Return as JSON array of strings.`;

const queries: string[] = await generateSearchQueries(companyName, contactName);
```

**Step 2: Brave Search Execution**
```typescript
// src/lib/search/brave.ts
// Brave Web Search API client

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;  // Snippet
  age?: string;          // "2 days ago", etc.
}

async function braveSearch(query: string): Promise<BraveSearchResult[]> {
  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
    {
      headers: {
        "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY!,
        "Accept": "application/json",
      },
    }
  );
  const data = await response.json();
  return data.web?.results?.map(r => ({
    title: r.title,
    url: r.url,
    description: r.description,
    age: r.age,
  })) || [];
}

// Execute all queries in parallel
const allResults = await Promise.all(queries.map(q => braveSearch(q)));
```

**Step 3: Result Parsing**
```typescript
// src/lib/search/results.ts
// Uses GPT-5 to extract and organize key facts

const parsePrompt = `You are a sales research assistant. Given these raw search results
about ${companyName}, extract and organize the key facts into a structured research summary.

Search Results:
${formattedResults}

Extract:
- Company: what they do, size, stage, funding, key products
- People: ${contactName}'s role, background, tenure
- News: recent announcements, press, events
- Industry: relevant market trends, competitive dynamics
- Red flags or notable items

Be factual. Cite sources with URLs. Flag anything uncertain.`;

const parsedResearch = await parseSearchResults(formattedResults, companyName, contactName);
```

**Step 4: Synthesis**
```typescript
// src/lib/search/synthesis.ts
// Uses GPT-5 to produce the final pre-call brief

const synthesisPrompt = `You are Mikey, a founder-led sales advisor.
A founder is preparing for a sales call. Synthesize the research
against their pre-call planning process to produce an actionable brief.

## User's Pre-Call Planning Process
${preCallPlanningContent}

## User's Sales Narrative
${salesNarrative}

## User's Discovery Questions
${discoveryQuestions}

## User's First Call Checklist
${firstCallChecklist}

## Research on ${companyName}
${parsedResearch}

Produce a pre-call brief that follows the user's planning process structure,
populated with the research findings. Include:
- Account overview with key facts
- How this maps to ICP and which pain points are most relevant
- Tailored discovery questions for this specific account
- Talking points connecting the user's value prop to this prospect's situation
- Potential objections specific to this account and how to handle them
- Recommended call structure and desired outcomes
- Sources with URLs for key claims`;

const brief = await synthesizePreCallBrief(...);
```

### Slack Integration

In `processMessage()` (src/lib/slack/events.ts), before the Chatbase call:

```typescript
// Detect #precall or #callprep command
const precallMatch = finalText.match(/#(?:precall|callprep)\s+(.+)/i);
if (precallMatch) {
  const input = precallMatch[1].trim();
  // Parse "Company, Contact Name Role" format
  const { company, contact, role } = parsePrecallInput(input);

  // Check user has a planning process set up
  const planningVersion = await getLatestPlanningVersion(user.id);
  if (!planningVersion) {
    await sendSlackMessage(client, channel,
      "You need to set up your Pre-Call Planning Process first! " +
      "Head to the Mikey web app → Pre-Call Planning to get started.", threadTs);
    return;
  }

  // Send typing indicator
  await sendSlackMessage(client, channel,
    `Researching ${company}${contact ? ` and ${contact}` : ''}...`, threadTs);

  // Execute research pipeline
  const brief = await executePreCallResearch(user.id, company, contact, role, planningVersion);

  // Send result (bypasses Chatbase entirely)
  const slackBrief = markdownToSlack(brief);
  await sendSlackMessage(client, channel, slackBrief, threadTs);

  // Save as conversation message for web app access
  await saveResearchToConversation(conversation, user, brief);
  return;
}
```

### Web App Integration

Add a "Research" tab or section to the `/pre-call-planning` page:

```
┌─────────────────────────────────────────────────┐
│ Pre-Call Planning                                │
│                                                  │
│ [Planning Process] [Run Research] [History]       │
│                                                  │
│ ┌─────────────────────────────────────────────┐  │
│ │ Company: [Acme Corp                       ] │  │
│ │ Contact: [Jane Smith                      ] │  │
│ │ Role:    [VP Sales                        ] │  │
│ │ Notes:   [Met at SaaStr, interested in... ] │  │
│ │                                             │  │
│ │ [Run Research]                              │  │
│ └─────────────────────────────────────────────┘  │
│                                                  │
│ ┌─ Status ─────────────────────────────────────┐ │
│ │ ✓ Generated 4 search queries                 │ │
│ │ ✓ Searched: "Acme Corp overview products"    │ │
│ │ ✓ Searched: "Acme Corp funding news 2026"    │ │
│ │ ● Searching: "Jane Smith Acme Corp LinkedIn" │ │
│ │ ○ Synthesizing pre-call brief...             │ │
│ └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

Research uses SSE streaming (same pattern as chat) with new event types:
- `event: search_status` — progress updates for each step
- `event: chunk` — streaming brief text
- `event: done` — final result with metadata

---

## Implementation Phases

### Phase 1: Pre-Call Planning Process Applet
- [ ] Prisma migration: `PreCallPlanningVersion` model
- [ ] API routes: generate, latest, versions, versions/[id] (GET + PATCH)
- [ ] Generate endpoint: fetch upstream data, build prompt, call GPT-5, store
- [ ] GTM variable: `PRE_CALL_PLANNING` merge field
- [ ] Page: `/pre-call-planning` (view/edit, markdown rendering)
- [ ] Page: `/pre-call-planning/history` (version list)
- [ ] Homepage: add CTA card for Pre-Call Planning
- [ ] Attachments: add to attachment picker for chat context

### Phase 2: Search Infrastructure
- [ ] Brave Search API client (`src/lib/search/brave.ts`)
- [ ] Query generation (`src/lib/search/queries.ts`)
- [ ] Result parsing (`src/lib/search/results.ts`)
- [ ] Synthesis engine (`src/lib/search/synthesis.ts`)
- [ ] Types (`src/lib/search/types.ts`)

### Phase 3: Research Integration
- [ ] Prisma migration: `PreCallResearch` model
- [ ] API route: `/api/pre-call-planning/research` (POST with SSE)
- [ ] API route: `/api/pre-call-planning/research/history` (GET)
- [ ] API route: `/api/pre-call-planning/research/[id]` (GET)
- [ ] Web UI: Research form + progress + brief display on `/pre-call-planning`
- [ ] Slack: `#precall` / `#callprep` command in processMessage()
- [ ] Commands: add to `#instructions` help text

### Phase 4: Polish
- [ ] Research history: browseable past briefs
- [ ] Deep page fetch: optionally scrape 1-2 pages for richer data
- [ ] Caching: don't re-search the same company within 24h
- [ ] Rate limiting: cap searches per user per day
- [ ] "Chat about this brief" — send brief context to a Chatbase conversation

---

## New Files

```
prisma/migrations/YYYYMMDD_add_pre_call_planning/migration.sql
scripts/seed-pre-call-planning.ts              (if we add seeded questions later)

src/lib/search/
  brave.ts          — Brave Search API client
  queries.ts        — Search query generation (GPT-5)
  results.ts        — Result parsing and formatting (GPT-5)
  synthesis.ts      — Final brief synthesis (GPT-5)
  types.ts          — Shared types

src/app/pre-call-planning/
  page.tsx           — Main view/edit + research UI
  history/page.tsx   — Version history

src/app/api/pre-call-planning/
  generate/route.ts              — Generate planning process
  latest/route.ts                — Get latest version
  versions/route.ts              — List versions
  versions/[id]/route.ts         — Get/edit specific version
  research/route.ts              — Execute research (SSE)
  research/history/route.ts      — List past research
  research/[id]/route.ts         — Get specific research brief
```

## Modified Files

```
prisma/schema.prisma                — New models + User relations
src/lib/slack/events.ts             — #precall/#callprep detection in processMessage()
src/lib/slack/commands.ts           — Add to #instructions help text
src/app/page.tsx                    — Homepage CTA card
src/app/api/attachments/available/route.ts  — Add preCallPlanning attachment
src/app/api/attachments/content/[type]/route.ts — Fetch content
.env.example                        — BRAVE_SEARCH_API_KEY
```

## Environment Variables

```
BRAVE_SEARCH_API_KEY=    — Brave Search API key ($3/1000 queries)
```

## Cost Estimate Per Research Execution

| Step | Cost |
|------|------|
| Query generation (GPT-5, ~500 tokens) | ~$0.01 |
| Brave Search (3-5 queries) | ~$0.01-0.02 |
| Result parsing (GPT-5, ~2000 tokens) | ~$0.03 |
| Synthesis (GPT-5, ~3000 tokens out) | ~$0.05 |
| **Total per research** | **~$0.10** |

Compare to: Chatbase message ~$0.01-0.03. Research is ~3-5x more expensive, but it's a high-value action. Counting it as 1 message toward limits is reasonable.
