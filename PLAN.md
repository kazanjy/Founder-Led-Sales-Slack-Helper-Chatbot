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

**Slack:** `#precall` or `#callprep` followed by freeform info (names, URLs, notes — any order)
**Web App:** Dedicated UI within the pre-call planning applet page with structured fields

### User Input — Flexible & Forgiving

Users can provide input in any messy combination. A GPT-5 "input parsing" step makes sense of it.

**Web App form fields** (all optional except Company Name):
- Company Name (required)
- Company Website URL
- LinkedIn Company Page URL
- Crunchbase URL
- Contact First Name
- Contact Last Name
- Contact Title / Role
- Contact LinkedIn Profile URL
- Additional Notes (freeform)

**Slack examples** (freeform, parsed by GPT-5):
```
#precall Acme Corp, Jane Smith VP Sales
#precall Acme Corp https://acme.com Jane Smith https://linkedin.com/in/janesmith
#callprep company: Acme Corp, contact: Jane Smith, VP Sales, linkedin.com/in/janesmith, crunchbase.com/organization/acme
#precall Meeting with Jane Smith at Acme Corp tomorrow, she's VP Sales. Their site is acme.com and they just raised a Series B
```

All of these should work. The input parser extracts structured data from whatever the user provides.

### Data Flow

```
User Input (freeform or structured)
    │
    ▼
┌──────────────────────────────────┐
│ Step 0: Parse Input (GPT-5)      │
│ Extract: company, contact, role, │
│ URLs (LinkedIn, website, CB),    │
│ any extra context/notes          │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Step 1: Search Plan (GPT-5)      │
│ Generate targeted queries using  │
│ parsed fields + known URL targets│
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Step 2: Execute Searches         │
│ A) Brave Search (generated Qs)   │
│ B) Direct fetch user-provided    │
│    URLs (website, LinkedIn, CB)  │
│ Both in parallel                 │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Step 3: Parse Results (GPT-5)    │
│ Extract & organize key facts     │
│ from all sources                 │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Step 4: Synthesize (GPT-5)       │
│ Merge research against:          │
│ - Pre-Call Planning Process      │
│ - Sales Narrative                │
│ - Discovery Questions            │
│ - First Call Checklist           │
│ → Produce account-specific       │
│   pre-call brief                 │
└──────────────────────────────────┘
```

### Search Targets — What We Look For

**For the Account:**
| Target | How | Priority |
|--------|-----|----------|
| LinkedIn Company Page | User-provided URL OR Brave: `"Company Name" site:linkedin.com/company` | High |
| Company Website | User-provided URL OR Brave: `"Company Name" official website` | High |
| Crunchbase | User-provided URL OR Brave: `"Company Name" site:crunchbase.com` | Medium |
| Recent News | Brave: `"Company Name" news funding announcement {current_year}` | High |
| Industry/Competitive | Brave: `"Company Name" competitors market {industry}` | Medium |

**For the Contact:**
| Target | How | Priority |
|--------|-----|----------|
| LinkedIn Profile | User-provided URL OR Brave: `"First Last" "Company Name" site:linkedin.com/in` | High |
| Professional Background | Brave: `"First Last" "Company Name" {role}` | Medium |
| Public Content | Brave: `"First Last" conference talk podcast interview` | Low |

**Direct URL fetching:** When the user provides a URL (LinkedIn profile, company website, Crunchbase), we fetch the page content directly (in addition to Brave searches). This gives us richer data than search snippets alone. These fetches run in parallel with the Brave queries.

**LinkedIn note:** LinkedIn pages often require authentication for full content. The Brave search *for* LinkedIn will return the public snippet (title, headline, summary). If the user provides a LinkedIn URL directly, we can attempt to fetch the public view — if blocked, we fall back to the Brave snippet. This is good enough for pre-call prep; we're not trying to scrape full profiles.

### Database Model

```prisma
model PreCallResearch {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Link to the planning process used
  planningVersionId  String
  planningVersion    PreCallPlanningVersion @relation(fields: [planningVersionId], references: [id])

  // Parsed input (structured from freeform or form input)
  companyName           String
  companyWebsiteUrl     String?
  companyLinkedInUrl    String?
  companyCrunchbaseUrl  String?
  contactFirstName      String?
  contactLastName       String?
  contactRole           String?
  contactLinkedInUrl    String?
  userNotes             String?   @db.Text  // Extra context the user provided
  rawInput              String?   @db.Text  // Original freeform input (Slack)

  // Search data (for audit/debugging)
  searchQueries   String   @db.Text  // JSON: string[]
  searchResults   String   @db.Text  // JSON: condensed results
  fetchedUrls     String?  @db.Text  // JSON: URLs directly fetched + status

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

**Step 0: Input Parsing (GPT-5)**

This is the "make sense of it" step. Takes whatever the user typed and extracts structured fields.

```typescript
// src/lib/search/input-parser.ts

interface ParsedResearchInput {
  companyName: string;
  companyWebsiteUrl?: string;
  companyLinkedInUrl?: string;
  companyCrunchbaseUrl?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactRole?: string;
  contactLinkedInUrl?: string;
  userNotes?: string;
}

// For Slack — freeform text after #precall
async function parseResearchInput(rawInput: string): Promise<ParsedResearchInput> {
  const prompt = `Extract structured information from this sales research request.
The user is preparing for a sales call and provided the following:

"${rawInput}"

Extract into JSON:
{
  "companyName": "...",           // required
  "companyWebsiteUrl": "...",     // if a company website URL was provided
  "companyLinkedInUrl": "...",    // if a LinkedIn company page URL was provided
  "companyCrunchbaseUrl": "...", // if a Crunchbase URL was provided
  "contactFirstName": "...",
  "contactLastName": "...",
  "contactRole": "...",           // title, role, department
  "contactLinkedInUrl": "...",    // if a LinkedIn profile URL was provided
  "userNotes": "..."              // any additional context that doesn't fit above
}

Rules:
- Detect URLs by domain: linkedin.com/in/... → contactLinkedInUrl,
  linkedin.com/company/... → companyLinkedInUrl, crunchbase.com → companyCrunchbaseUrl,
  anything else → companyWebsiteUrl
- If just a name and company are given, that's fine — leave URL fields null
- Be generous in interpretation — "she's VP Sales" → contactRole: "VP Sales"

Return only valid JSON.`;

  // GPT-5 call, parse JSON response
}

// For Web App — already structured from form, no parsing needed
// Just pass the form fields directly to the research pipeline
```

**Step 1: Search Plan Generation (GPT-5)**

Takes the parsed input and generates targeted Brave queries. Knows which URLs the user already provided (so it doesn't waste queries searching for those).

```typescript
// src/lib/search/queries.ts

interface SearchPlan {
  braveQueries: string[];           // 3-6 queries for Brave
  directFetchUrls: string[];        // User-provided URLs to fetch directly
}

async function generateSearchPlan(input: ParsedResearchInput): Promise<SearchPlan> {
  // Collect user-provided URLs for direct fetching
  const directFetchUrls: string[] = [];
  if (input.companyWebsiteUrl) directFetchUrls.push(input.companyWebsiteUrl);
  if (input.companyLinkedInUrl) directFetchUrls.push(input.companyLinkedInUrl);
  if (input.companyCrunchbaseUrl) directFetchUrls.push(input.companyCrunchbaseUrl);
  if (input.contactLinkedInUrl) directFetchUrls.push(input.contactLinkedInUrl);

  // GPT-5 generates Brave queries — skipping targets we already have URLs for
  const prompt = `Generate web search queries to research this company and contact
for a sales call preparation.

Company: ${input.companyName}
Contact: ${input.contactFirstName} ${input.contactLastName}, ${input.contactRole}

URLs already provided by the user (do NOT search for these — we'll fetch them directly):
${directFetchUrls.map(u => `- ${u}`).join('\n') || '(none)'}

Generate 3-6 Brave search queries to find what we DON'T already have:
${!input.companyLinkedInUrl ? '- LinkedIn company page: "Company Name" site:linkedin.com/company' : ''}
${!input.companyWebsiteUrl ? '- Company website and overview' : ''}
${!input.companyCrunchbaseUrl ? '- Crunchbase profile: "Company Name" site:crunchbase.com' : ''}
${!input.contactLinkedInUrl ? '- Contact LinkedIn: "First Last" "Company" site:linkedin.com/in' : ''}
- Recent news, funding, announcements (always search for this)
- Industry context, competitive landscape (always search for this)

Return as JSON array of query strings.`;

  const braveQueries = await callGPT5(prompt); // parse JSON array
  return { braveQueries, directFetchUrls };
}
```

**Step 2: Search + Fetch Execution (parallel)**

Two things happen at the same time:
- Brave Search API for the generated queries
- Direct HTTP fetch for any user-provided URLs

```typescript
// src/lib/search/brave.ts — Brave Web Search API client
// src/lib/search/fetcher.ts — Direct URL page fetcher

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

interface FetchedPage {
  url: string;
  title: string;
  content: string;   // Cleaned text, truncated to ~5000 chars
  success: boolean;
  error?: string;
}

async function executeSearchPlan(plan: SearchPlan): Promise<{
  braveResults: BraveSearchResult[][];
  fetchedPages: FetchedPage[];
}> {
  // Run ALL searches and fetches in parallel
  const [braveResults, fetchedPages] = await Promise.all([
    // Brave queries
    Promise.all(plan.braveQueries.map(q => braveSearch(q))),
    // Direct URL fetches (with timeout, HTML→text conversion)
    Promise.all(plan.directFetchUrls.map(url => fetchAndCleanPage(url))),
  ]);

  return { braveResults, fetchedPages };
}

// fetchAndCleanPage: fetch URL, strip HTML, extract readable text
// Handles: timeouts, blocked pages (LinkedIn), error gracefully
// For LinkedIn: if blocked (302/403), still useful — Brave snippet covers it
```

**Step 3: Result Parsing (GPT-5)**

Now has both search snippets AND full page content from direct fetches.

```typescript
// src/lib/search/results.ts

const parsePrompt = `You are a sales research assistant. Given these search results
and fetched page content about ${input.companyName}, extract and organize key facts.

## Brave Search Results
${formattedBraveResults}

## Directly Fetched Pages
${formattedFetchedPages}

Extract and organize:
- **Company**: what they do, size, stage, funding, key products/services, tech stack
- **People**: ${input.contactFirstName} ${input.contactLastName}'s role, background,
  tenure, LinkedIn headline, recent activity
- **Funding/Growth**: recent funding, revenue signals, hiring activity
- **News**: recent announcements, press releases, product launches
- **Industry**: market trends, competitive dynamics, adjacent players
- **Red Flags**: anything concerning (layoffs, lawsuits, leadership changes)

Be factual. Cite sources with URLs. Flag anything uncertain or unverified.
Distinguish between confirmed facts and inferences.`;
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
// Detect #precall or #callprep command — everything after the hashtag is freeform input
const precallMatch = finalText.match(/#(?:precall|callprep)\s+([\s\S]+)/i);
if (precallMatch) {
  const rawInput = precallMatch[1].trim();

  // Check user has a planning process set up
  const planningVersion = await getLatestPlanningVersion(user.id);
  if (!planningVersion) {
    await sendSlackMessage(client, channel,
      "You need to set up your Pre-Call Planning Process first! " +
      "Head to the Mikey web app → Pre-Call Planning to get started.", threadTs);
    return;
  }

  // Step 0: Parse freeform input via GPT-5
  const parsed = await parseResearchInput(rawInput);

  // Send status message
  const contactDisplay = [parsed.contactFirstName, parsed.contactLastName].filter(Boolean).join(' ');
  await sendSlackMessage(client, channel,
    `Researching ${parsed.companyName}${contactDisplay ? ` and ${contactDisplay}` : ''}...`, threadTs);

  // Steps 1-4: Execute research pipeline (bypasses Chatbase entirely)
  const brief = await executePreCallResearch(user.id, parsed, planningVersion);

  const slackBrief = markdownToSlack(brief);
  await sendSlackMessage(client, channel, slackBrief, threadTs);

  // Save as conversation message for web app access
  await saveResearchToConversation(conversation, user, rawInput, brief);
  return;
}
```

**Slack examples that all work:**
```
@Mikey #precall Acme Corp, Jane Smith VP Sales
@Mikey #callprep Acme Corp https://acme.com Jane Smith https://linkedin.com/in/janesmith
@Mikey #precall Meeting with Jane Smith tomorrow at Acme Corp. She's their VP Sales.
       Their website is acme.com. Found her on linkedin.com/in/janesmith.
       They just raised Series B according to crunchbase.com/organization/acme
```

### Web App Integration

Add a "Research" tab or section to the `/pre-call-planning` page:

```
┌──────────────────────────────────────────────────────────┐
│ Pre-Call Planning                                         │
│                                                           │
│ [Planning Process] [Run Research] [Research History]       │
│                                                           │
│ ┌── Account ───────────────────────────────────────────┐  │
│ │ Company Name*:     [Acme Corp                      ] │  │
│ │ Company Website:   [https://acme.com               ] │  │
│ │ LinkedIn Company:  [linkedin.com/company/acme      ] │  │
│ │ Crunchbase:        [crunchbase.com/organization/...] │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                           │
│ ┌── Contact ───────────────────────────────────────────┐  │
│ │ First Name:        [Jane                           ] │  │
│ │ Last Name:         [Smith                          ] │  │
│ │ Title / Role:      [VP Sales                       ] │  │
│ │ LinkedIn Profile:  [linkedin.com/in/janesmith      ] │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                           │
│ ┌── Additional Context ────────────────────────────────┐  │
│ │ [Met at SaaStr last week. She mentioned they're    ] │  │
│ │ [evaluating new sales tools. Series B company.     ] │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                           │
│ [Run Research]                                            │
│                                                           │
│ ┌─ Progress ───────────────────────────────────────────┐  │
│ │ ✓ Parsed input: Acme Corp + Jane Smith (VP Sales)    │  │
│ │ ✓ Generated 4 search queries                         │  │
│ │ ✓ Fetched: https://acme.com (company website)        │  │
│ │ ✓ Fetched: linkedin.com/in/janesmith                 │  │
│ │ ✓ Searched: "Acme Corp" funding news 2026            │  │
│ │ ✓ Searched: "Acme Corp" competitors market           │  │
│ │ ● Parsing and organizing research...                 │  │
│ │ ○ Synthesizing pre-call brief...                     │  │
│ └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
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
- [ ] Types and interfaces (`src/lib/search/types.ts`)
- [ ] Input parser — GPT-5 freeform → structured (`src/lib/search/input-parser.ts`)
- [ ] Brave Search API client (`src/lib/search/brave.ts`)
- [ ] Direct URL page fetcher with HTML→text (`src/lib/search/fetcher.ts`)
- [ ] Search plan generation — queries + direct URLs (`src/lib/search/queries.ts`)
- [ ] Result parsing (`src/lib/search/results.ts`)
- [ ] Synthesis engine (`src/lib/search/synthesis.ts`)

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
  fetcher.ts        — Direct URL page fetcher (HTML→text)
  input-parser.ts   — GPT-5 freeform input → structured fields
  queries.ts        — Search plan generation (GPT-5)
  results.ts        — Result parsing and formatting (GPT-5)
  synthesis.ts      — Final brief synthesis (GPT-5)
  types.ts          — Shared types (ParsedResearchInput, SearchPlan, etc.)

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
