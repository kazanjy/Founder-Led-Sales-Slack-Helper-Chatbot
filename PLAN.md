# Web Search Feature Plan for Mikey

## Problem Statement

Users doing pre-call planning need real-world context about the company and people they're meeting. Today, Mikey can give great *methodology* advice (from Pete's content via Chatbase) but has no way to pull in *situational* context — what the prospect's company does, recent news, the contact's LinkedIn background, etc.

The goal: let Mikey perform web searches to gather account/contact research, then synthesize that against the user's Sales Narrative, discovery questions, and pre-call planning methodology to produce actionable, personalized prep.

---

## Architecture Overview

### The Core Tension: Chatbase vs. Direct LLM

The current system routes ALL messages through Chatbase, which hosts Pete's RAG knowledge base. This is great for methodology questions but creates a challenge for web search:

**Chatbase limitations:**
- 8,000 char message limit (7,500 with buffer)
- No tool-use / function-calling capability
- Can't execute searches itself
- Designed for RAG against Pete's corpus, not for synthesizing external data

**This means web search can't live *inside* Chatbase — it needs to happen *around* it.**

### Proposed Architecture: "Orchestrator" Pattern

```
User Message
    │
    ▼
┌─────────────────────┐
│  Intent Detection    │  ← Does this need web search?
│  (lightweight LLM)   │
└────────┬────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
[Search]   [No Search → existing Chatbase flow]
    │
    ▼
┌─────────────────────┐
│  Web Search API      │  ← Brave/Tavily/SerpAPI
│  (1-3 queries)       │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Synthesis LLM       │  ← Claude/GPT-4 with:
│                       │    - Search results
│                       │    - User's Sales Narrative
│                       │    - Pete's methodology (prompt-injected)
│                       │    - User's discovery questions
└────────┬────────────┘
         │
         ▼
   Response to User
```

**Key insight:** When web search is invoked, we **bypass Chatbase** for that response and use a direct LLM call instead. We can still inject Pete's methodology as system prompt content — we just won't get the full RAG retrieval. This is fine because pre-call planning is more about *applying* known frameworks than *retrieving* obscure content.

---

## Detailed Design

### 1. Trigger Detection

**Option A: Explicit hashtag command (recommended to start)**
- `#research <company name>` or `#precall <company> <contact>`
- Fits the existing `handleCommand` pattern
- Clear user intent, no false positives
- Easy to document in `#instructions`

**Option B: LLM-based intent detection**
- Run a cheap/fast model (Haiku) to classify: "Does this message need web search?"
- More natural but adds latency and cost to every message
- Could be a Phase 2 enhancement

**Recommendation:** Start with explicit commands. Add smart detection later.

### 2. Search Execution

**Search API options:**

| API | Pros | Cons |
|-----|------|------|
| **Brave Search API** | Cheap ($0.003/query), good quality, includes snippets | Less programmatic control |
| **Tavily** | Built for AI agents, returns clean extracts | Newer, $0.01/query |
| **SerpAPI (Google)** | Best results, most complete | Expensive ($0.05/query) |

**Recommendation:** Brave Search API — best cost/quality ratio for our use case.

**Search strategy for pre-call planning:**
```
Input: #precall Acme Corp, Jane Smith VP Sales

Generated queries:
1. "Acme Corp" company overview products services
2. "Acme Corp" recent news funding announcements 2025 2026
3. "Jane Smith" "Acme Corp" LinkedIn OR role
```

The query generation should be done by a lightweight LLM call that takes the user's input and generates 2-4 targeted search queries.

### 3. Result Processing & Synthesis

After search results come back, we need to:

1. **Extract and clean** the top 3-5 results per query (titles, snippets, URLs)
2. **Optionally deep-fetch** 1-2 key pages (company About page, recent press release) for richer context
3. **Synthesize** using a direct LLM call with a structured prompt

**Synthesis prompt structure:**
```
System: You are Mikey, a founder-led sales advisor trained on Pete Kazanjy's
methodology. You're helping a founder prepare for a sales call.

Context — User's Sales Narrative:
{sales_narrative}

Context — User's Discovery Questions:
{discovery_questions}

Context — User's First Call Checklist:
{first_call_checklist}

Context — Web Research Results:
{formatted_search_results}

Task: Synthesize the research into actionable pre-call preparation. Include:
1. Company overview (what they do, size, stage, recent news)
2. Contact background (role, tenure, likely priorities)
3. Potential pain points relevant to the user's product
4. Suggested discovery questions tailored to this specific account
5. Talking points that connect the user's value prop to the prospect's situation
6. Potential objections and how to handle them
7. Recommended call structure based on the First Call Checklist
```

### 4. Integration Points

#### Slack (events.ts)
- Add `#research` and `#precall` to `handleCommand()` — but these aren't simple string responses, they need async processing
- Better: detect the command in `processMessage()` before the Chatbase call, execute the search+synthesis pipeline, and return the result directly (bypassing Chatbase for that message)

#### Web App (stream/route.ts)
- Detect search intent in the message before sending to Chatbase
- Execute search pipeline
- Stream the synthesis response via SSE (same pattern as Chatbase streaming, but using direct LLM streaming)

#### Conversation History
- Store the search results and synthesis as a normal assistant message
- Future messages in the thread can go back to Chatbase (the search context is now in the conversation history)

### 5. Data Flow for Slack

```
User: @Mikey #precall Acme Corp, Jane Smith

1. handleMention() → processMessage()
2. Detect #precall command → extract company/contact
3. Send "🔍 Researching Acme Corp and Jane Smith..." typing indicator
4. Generate search queries (Claude Haiku, ~200ms)
5. Execute 2-4 Brave searches in parallel (~500ms)
6. Fetch user's Sales Narrative, Discovery Questions, First Call Checklist
7. Build synthesis prompt with all context
8. Call Claude Sonnet for synthesis (~3-5s)
9. Format response for Slack
10. Send response in thread
11. Save to conversation/messages for web app access
```

### 6. Data Flow for Web App

```
User: types "#precall Acme Corp, Jane Smith" or uses a saved prompt

1. POST /api/conversations/[id]/messages/stream
2. Detect #precall in message
3. SSE event: { type: "searching", queries: [...] }
4. Execute searches
5. SSE event: { type: "search_complete", resultCount: N }
6. Stream synthesis response via SSE chunks (same as current Chatbase streaming)
7. SSE event: { type: "done" }
```

The web UI can show a nice "Searching..." state with the queries being executed.

---

## Implementation Phases

### Phase 1: Core Search Infrastructure
- [ ] Add Brave Search API integration (`src/lib/search/brave.ts`)
- [ ] Add search query generation (`src/lib/search/queries.ts`) — uses Claude Haiku
- [ ] Add result parsing/cleaning (`src/lib/search/results.ts`)
- [ ] Add synthesis prompt builder (`src/lib/search/synthesis.ts`)
- [ ] Add direct Claude API call for synthesis (we already have `openai.ts`, add `anthropic.ts` or extend it)

### Phase 2: Slack Integration
- [ ] Add `#precall` and `#research` command detection in `processMessage()`
- [ ] Wire up search pipeline in Slack message flow
- [ ] Add typing indicators during search
- [ ] Handle the Chatbase bypass (send synthesis directly, not via Chatbase)
- [ ] Store results as conversation messages

### Phase 3: Web App Integration
- [ ] Add search detection in streaming endpoint
- [ ] Add new SSE event types for search progress
- [ ] Update chat UI to show search/synthesis progress states
- [ ] Add "Pre-Call Planning" as a saved prompt template with merge fields

### Phase 4: Polish & Enhancement
- [ ] Add LLM-based intent detection (auto-detect when search would help)
- [ ] Add deep page fetching for richer context
- [ ] Add LinkedIn profile parsing (if accessible)
- [ ] Cache search results per company (avoid re-searching within 24h)
- [ ] Rate limiting per user for search queries

---

## Key Decisions to Make

1. **Search API**: Brave vs. Tavily vs. SerpAPI
   - Recommendation: Brave (cheapest, good quality)

2. **Synthesis LLM**: Claude vs. GPT-4
   - Recommendation: Claude Sonnet — you're already using OpenAI for vision, adding Anthropic for synthesis keeps costs reasonable and quality high

3. **Trigger mechanism**: Explicit command vs. auto-detect
   - Recommendation: Start with `#precall` / `#research` commands, add auto-detect later

4. **Chatbase bypass**: When search is invoked, skip Chatbase entirely?
   - Recommendation: Yes — inject Pete's key frameworks directly into the synthesis prompt instead. Chatbase's value is RAG over Pete's content, but for pre-call planning we know exactly which frameworks to apply (discovery questions, first call checklist, etc.)

5. **Cost management**: Each search invocation costs ~$0.01-0.05 (search) + ~$0.02-0.05 (synthesis LLM)
   - Consider: count search invocations separately, or just count as 1 message?
   - Recommendation: Count as 1 message for simplicity. The cost is comparable to a Chatbase call.

---

## New Files

```
src/lib/search/
  brave.ts          — Brave Search API client
  queries.ts        — Search query generation (LLM-powered)
  results.ts        — Result parsing and formatting
  synthesis.ts      — Synthesis prompt building and LLM call
  types.ts          — Shared types
```

## Modified Files

```
src/lib/slack/events.ts     — Add search detection in processMessage()
src/lib/slack/commands.ts   — Add #precall and #research help text
src/app/api/conversations/[id]/messages/stream/route.ts — Add search flow
src/app/chat/[[...id]]/page.tsx — UI for search progress states
.env.example                — Add BRAVE_API_KEY, ANTHROPIC_API_KEY
```

## Environment Variables

```
BRAVE_SEARCH_API_KEY=       — Brave Search API key
ANTHROPIC_API_KEY=          — For Claude synthesis calls (or reuse OpenAI)
```
