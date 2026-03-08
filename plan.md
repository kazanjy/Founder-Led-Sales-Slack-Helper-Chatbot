# Sales Metrics Analyzer - Implementation Plan

## Overview
A new applet that lets users either manually fill a sales metrics questionnaire OR upload a CRM opportunity CSV to auto-populate metrics via GPT, then generates a comprehensive analysis with actionable insights. When chatting about results, both the calculated metrics AND the raw CSV data are sent as context.

---

## 1. Database Schema (Prisma)

### New Models

**`SalesMetricsQuestion`** - Seeded questionnaire (follows MaturityQuestion pattern)
```prisma
model SalesMetricsQuestion {
  id          String   @id @default(cuid())
  category    String   // "Pipeline Activity", "Conversion Rates", "Deal Metrics", "Revenue Retention", "Lead Generation"
  globalOrder Int      @unique
  question    String   @db.Text
  helpText    String?  @db.Text
  enabled     Boolean  @default(true)
  answers     SalesMetricsAnswer[]
  createdAt   DateTime @default(now())
  @@map("sales_metrics_questions")
}
```

**`SalesMetricsAnswer`** - User answers (follows MaturityAnswer pattern)
```prisma
model SalesMetricsAnswer {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(...)
  questionId   String
  question     SalesMetricsQuestion @relation(...)
  assessmentId String?
  assessment   SalesMetricsAssessment? @relation(...)
  answer       String   @db.Text
  source       String   @default("manual") // "manual" | "csv"
  createdAt    DateTime @default(now())
  @@index([userId, questionId])
  @@index([assessmentId])
  @@map("sales_metrics_answers")
}
```

**`SalesMetricsAssessment`** - Completed assessment snapshots
```prisma
model SalesMetricsAssessment {
  id               String   @id @default(cuid())
  userId           String
  user             User     @relation(...)
  title            String?
  conversationId   String?
  conversation     Conversation? @relation(...)
  csvData          String?  @db.Text    // Raw CSV stored for chat context
  csvFileName      String?
  calculatedMetrics String? @db.Text    // JSON blob of all computed fields
  analysisReport   String?  @db.Text    // Full analysis markdown
  answers          SalesMetricsAnswer[]
  completedAt      DateTime @default(now())
  @@index([userId, completedAt])
  @@map("sales_metrics_assessments")
}
```

Add relations to `User` model: `salesMetricsAnswers`, `salesMetricsAssessments`
Add relation to `Conversation` model: `salesMetricsAssessments`

### Questionnaire Fields (17 questions, seeded)

| # | Category | Question | Help Text |
|---|----------|----------|-----------|
| 1 | Pipeline Activity | How many first meetings do you have in a month? | Total new prospect first meetings per month |
| 2 | Pipeline Activity | How many total customer meetings do you have in a week? | All meetings: discovery, follow-up, demos, QBRs, etc. |
| 3 | Conversion Rates | What is your overall win rate? | Percentage of opportunities that close-won (e.g., "25%") |
| 4 | Conversion Rates | How many wins come from first meetings? | Of all your wins, how many originated from a first meeting you ran? |
| 5 | Conversion Rates | Out of 10 first meetings, how many become qualified opportunities? | Qualified = meets your qualification criteria (BANT, MEDDIC, etc.) |
| 6 | Conversion Rates | Out of 10 first meetings, how many result in a second meeting? | Prospect agreed to continue the conversation |
| 7 | Conversion Rates | Out of 10 first meetings, how many result in a POC? | POC = proof of concept, pilot, or trial |
| 8 | Conversion Rates | What is your win rate from POCs? | Of deals that go to POC, what % close-won? |
| 9 | Conversion Rates | What is your win rate from proposals? | Of deals where you sent a proposal, what % close-won? |
| 10 | Deal Metrics | How many meetings does it take to close a deal on average? | Total meetings from first meeting to close |
| 11 | Deal Metrics | What is your average selling price (ASP)? | Average deal size in dollars |
| 12 | Deal Metrics | What is your average sales cycle length? | Days from first meeting to close |
| 13 | Revenue Retention | What is your renewal rate? | Percentage of customers that renew |
| 14 | Revenue Retention | What is your Gross Revenue Retention (GRR)? | Revenue retained excluding expansion |
| 15 | Revenue Retention | What is your Net Revenue Retention (NRR)? | Revenue retained including expansion |
| 16 | Lead Generation | How many inbound demo requests do you get per month? | Inbound = prospects that come to you |
| 17 | Lead Generation | How many outbound discovery/demo meetings do you set per month? | Outbound = meetings you or your SDRs book proactively |

---

## 2. API Routes

### `GET /api/sales-metrics/questions`
Returns all enabled questions grouped by category + user's latest answers per question.

### `POST /api/sales-metrics/answers/[questionId]`
Save individual answer (auto-save on blur/debounce). Same pattern as maturity/answers.

### `POST /api/sales-metrics/parse-csv` ⭐ Key endpoint
- Accepts multipart form data with CSV file
- Parses with PapaParse
- Sends to **GPT 5.2 direct** (not Chatbase) with structured prompt:
  - "Here is a CSV of CRM opportunity data. Analyze it and calculate these 17 sales metrics..."
  - Lists all 17 questions with their globalOrder
  - Asks for JSON response: `{ prefillAnswers: { [globalOrder]: { value: string, explanation: string } }, additionalInsights: { winRateBySource: {...}, trendAnalysis: {...}, repBreakdown: {...}, ... } }`
- Returns pre-filled answers + additional insights
- Stores raw CSV text in session/memory for later submission
- **120s timeout** (maxDuration = 120)

### `POST /api/sales-metrics/submit` ⭐ Key endpoint
- Accepts: `{ answers: Record<questionId, string>, csvData?: string, csvFileName?: string, csvInsights?: object }`
- Builds comprehensive prompt for GPT 5.2:
  - All 17 Q&A pairs (manual + CSV-derived)
  - If CSV provided: raw CSV data included for deeper analysis
  - Requests structured analysis (see output format below)
- Creates `SalesMetricsAssessment` with all data
- Creates linked `Conversation` with full context
- Sends initial analysis to Chatbase to prime the conversation
- Returns: assessment ID, conversation ID, analysis report

**Analysis Output Format (from GPT):**
```json
{
  "top3Strengths": [{ "title": "...", "detail": "..." }],
  "top3Improvements": [{ "title": "...", "detail": "..." }],
  "workOnNext": { "title": "...", "detail": "...", "actionSteps": ["..."] },
  "metricsTable": { "questionOrder": { "value": "...", "benchmark": "...", "rating": "good|ok|needs_work" } },
  "generalAnalysis": "markdown narrative...",
  "csvInsights": {
    "winRateBySource": { "source": "rate" },
    "winRateTrend": [{ "period": "...", "rate": "..." }],
    "aspTrend": [...],
    "cycleLengthTrend": [...],
    "oppCreationRate": [...],
    "repPerformance": [{ "rep": "...", "metrics": {...} }],
    "otherInsights": "markdown..."
  }
}
```

### `POST /api/sales-metrics/chat`
- Start/continue chat with assessment context
- Loads: assessment answers + raw CSV data + calculated metrics + analysis report
- Chunks for Chatbase (same 7500 char limit pattern)
- Key: the raw CSV data goes into the context so the LLM can answer detailed questions about individual deals

### `GET /api/sales-metrics/latest`
Returns most recent assessment with analysis report.

### `GET /api/sales-metrics/history`
Returns list of past assessments (id, title, completedAt).

---

## 3. Frontend Pages

### `/sales-metrics/page.tsx` - Main Page

**Three states: Input → Processing → Results**

**Input State:**

1. **Header**: "Sales Metrics Analyzer" with subtitle "Upload your CRM data or fill in your metrics manually to get a comprehensive analysis of your sales performance."

2. **CSV Upload Zone** (prominent card at top):
   - Drag-and-drop area with upload icon
   - Accept: `.csv` files only
   - Guidance text (always visible):
     > "Export your opportunity/deal data from your CRM (Salesforce, HubSpot, Pipedrive, Close, etc.) or a spreadsheet."
     >
     > **Recommended fields:** Opportunity Name, Close Date, Created Date, Amount/Value, Stage, Win/Loss Status, Lead Source, Owner/Rep, Account Name, Deal Type (New/Renewal/Expansion), Number of Meetings, POC/Trial indicator, Proposal Sent date
     >
     > **The more fields the better.** The AI will work with whatever columns you provide.
     >
     > **Tip:** To analyze a specific time period, just limit the rows in your CSV to that date range.
   - Upload state: spinner + "Analyzing your opportunity data..."
   - Success state: green banner "X of 17 metrics auto-filled from your CSV data"
   - Error state: red banner with message

3. **Questionnaire** (grouped by category, accordion or all-visible):
   - Each question: label + helpText + text input
   - Pre-filled fields show a small blue "CSV" chip/badge next to the input
   - Empty fields show lighter placeholder "Enter value or leave blank"
   - Auto-save on blur with 1s debounce
   - Category headers with filled/total count: "Conversion Rates (5/7)"

4. **Action Bar** (sticky bottom or after form):
   - Primary: "Analyze My Metrics" button (enabled if >= 1 answer exists)
   - Secondary: "Skip to Chat" if they just want to chat with raw CSV data
   - Disabled state with tooltip if no answers

**Processing State:**
- Full-screen overlay with fun rotating messages (same pattern as assessment/bulk)
- Messages: "Crunching your numbers", "Benchmarking your metrics", "Identifying trends", "Finding your strengths", "Spotting opportunities", "Calculating conversion funnels", "Analyzing deal velocity"

**Results State:**

1. **Summary Cards Row:**
   - Card: "Overall Win Rate: X%"
   - Card: "Avg Deal Size: $X"
   - Card: "Avg Cycle: X days"
   - (Show key metrics at a glance)

2. **Top 3 Strengths** (green cards/list with check icons)

3. **Top 3 Areas for Improvement** (amber cards/list with arrow icons)

4. **#1 Priority** (prominent callout card):
   - Title + detail + action steps

5. **All Metrics Table:**
   - Question | Your Value | Benchmark Range | Rating (color-coded)

6. **General Analysis** (markdown rendered)

7. **CSV Deep Dive** (only if CSV was uploaded):
   - Win Rate by Lead Source (table or simple bar)
   - Trend charts described in text (win rate over time, ASP trend, etc.)
   - Rep performance breakdown (if multiple owners)
   - Opportunity creation velocity
   - Other AI-surfaced insights

8. **Action Buttons:**
   - "Chat About These Results" → creates conversation with full context and navigates to chat
   - "Download Report" (stretch goal — not MVP)
   - "Run New Analysis" → resets form

### `/sales-metrics/history/page.tsx`
- Table of past assessments: date, title (AI-generated), key metrics summary
- Click to view results or chat
- Same pattern as call-review/history

---

## 4. Lib Files

### `src/lib/sales-metrics/prompts.ts`
- `getCSVParsePrompt(csvText, questions[])` — System prompt for extracting 17 metrics from raw CSV
- `getAnalysisPrompt(answers, csvText?, csvInsights?)` — System prompt for comprehensive analysis
- Prompt engineering: be explicit about JSON output format, include benchmark ranges for context

### `src/lib/sales-metrics/seed.ts`
- Seeds the 17 `SalesMetricsQuestion` records
- Called from prisma/seed.ts or standalone script

---

## 5. Navigation

### `src/components/SalesNavBar.tsx`
Add to nav items:
```ts
{ href: "/sales-metrics", label: "📊 Sales Metrics", statusKey: "salesMetrics" }
```
Add status fetch for `/api/sales-metrics/latest` in the Promise.all.

---

## 6. Implementation Order

1. **Schema + Migration** — Add 3 Prisma models, update User + Conversation, migrate
2. **Seed Questions** — Create seed script for 17 questions, run it
3. **API: questions + answers** — GET questions, POST answers (copy maturity pattern)
4. **API: parse-csv** — CSV upload + GPT 5.2 parsing endpoint
5. **API: submit** — Full analysis generation endpoint
6. **API: chat + latest + history** — Chat context, latest, history endpoints
7. **Frontend: Main page** — CSV upload + questionnaire + results (biggest piece)
8. **Frontend: History page**
9. **Navigation** — Add to SalesNavBar
10. **Build check** — `npx next build`

---

## 7. Key Design Decisions

- **GPT 5.2 direct** for CSV parsing and analysis (need structured JSON output + large context window for CSV data). NOT Chatbase.
- **Chatbase** for follow-up chat conversations (consistent with app patterns, leverages knowledge base).
- **Raw CSV stored** on the assessment record so follow-up chat can reference individual deals/opportunities.
- **No rigid CSV schema** — The LLM dynamically identifies columns. Works with any CRM export format.
- **Partial submission OK** — User can submit with just CSV-derived fields, just manual, or a mix.
- **Time period = user responsibility** — They limit their CSV export rows. We document this in guidance rather than building date pickers.
- **`source` field on answers** — Tracks whether each answer came from CSV parsing or manual entry (for the "CSV" badge in UI).
- **Analysis report stored as markdown** — Rendered in the results section and included in chat context.
- **Chat gets everything** — When user clicks "Chat About This", the conversation context includes: all Q&A pairs, the analysis report, AND the raw CSV data (chunked as needed). This lets the LLM answer questions like "show me my worst-performing lead source" or "which rep has the longest cycle time."
