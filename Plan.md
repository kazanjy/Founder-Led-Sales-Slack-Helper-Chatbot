# Ongoing Context System - Design Plan

## Concept

A durable, long-running per-user context system that accumulates GTM intelligence over time. Starts with the maturity assessment, then grows with pasted meeting notes and call transcripts. Each entry is timestamped so the system understands recency. This context is injected alongside Chatbase's shared RAG (Pete's methodology) on every chat interaction.

## Technical Constraints

- **GPT-5.2 context window:** ~400K tokens via API (~300K words)
- **Chatbase:** No proprietary token limit - inherits underlying model's context window. But Chatbase manages its own conversation memory server-side, and we don't control how it truncates/summarizes as conversations grow
- **Current per-message limit:** 8,000 chars (code uses 7,500 buffer)
- **Current history:** Up to 20 previous messages sent on first Chatbase call, then relies on stored `conversationId` for continuity
- **Chatbase RAG:** Global/shared across all users (Founding Sales content). Per-user context must be handled separately

## Architecture: Hybrid Summarize + Retrieve (Recommended)

### Phase 1: Summarized Context Injection (Start Here)

**On ingest (user pastes notes/transcript):**
1. Store raw content in new `UserContext` table with timestamp and type
2. Run a summarization call to extract key GTM insights, decisions, blockers, action items
3. Store the summary alongside the raw content

**On each chat turn:**
1. Pull the user's context brief: latest assessment summary + last N context summaries, ordered by recency
2. Inject as conversation history entries (same chunked pattern used for assessment submission today)
3. Chatbase RAG handles Pete's methodology; injected context handles per-user GTM state

**Pros:** No new infrastructure beyond a summarization API call. Dramatically reduces token usage (20K transcript -> 1-2K summary). Works with existing Chatbase integration.

**Cons:** Lossy - may miss details user later asks about. Summarization adds latency on ingest.

### Phase 2: Retrieval Layer (Add Later When Context Volume Demands It)

When the user asks something that needs detail from a specific transcript or note, use retrieval to pull in relevant raw content. Can start with simple keyword/timestamp matching against the DB, then evolve to full vector search (pgvector, Pinecone, etc.) as needed.

## Data Model

```prisma
model UserContext {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])

  type        UserContextType  // ASSESSMENT, MEETING_NOTES, CALL_TRANSCRIPT
  title       String?          // User-provided or auto-generated label
  rawContent  String   @db.Text // Original pasted content
  summary     String   @db.Text // LLM-generated summary
  contextDate DateTime          // When this context is FROM (user-provided timestamp)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId, contextDate])
}

enum UserContextType {
  ASSESSMENT
  MEETING_NOTES
  CALL_TRANSCRIPT
}
```

## Implementation Steps

### Step 1: Data Model & Ingest API
- Add `UserContext` model to Prisma schema
- Create `POST /api/user-context` endpoint that accepts raw content + type + date
- Add summarization step (call LLM to extract structured GTM insights)
- Store both raw and summary

### Step 2: Context Injection into Chat
- Modify `sendToChatbase` flow to prepend user's context brief
- Build context brief: latest assessment + recent context summaries, ordered by recency
- Use existing chunking pattern (7,500 char chunks with assistant acknowledgments)
- Add token budget awareness - prioritize recent context, trim oldest if needed

### Step 3: UI for Adding Context
- New section/page for pasting meeting notes and call transcripts
- Date picker for "when did this happen"
- Type selector (meeting notes vs call transcript)
- Optional title field
- Display list of existing context entries with dates
- Ability to view/delete past entries

### Step 4: Assessment Integration
- When assessment is submitted, also create a `UserContext` entry of type `ASSESSMENT`
- When assessment is updated, create a new entry (preserves history)
- Assessment context summaries auto-generated from answers

### Step 5 (Future): Vector Retrieval
- Add pgvector extension to Postgres (or external vector DB)
- Chunk and embed raw content on ingest
- On chat, semantic search user's vectors for relevant chunks
- Inject retrieved chunks alongside rolling context brief
- Only build this when context volume makes stuffing impractical

## Key Design Decisions to Make
- **Summary format:** Structured (JSON-like categories) vs narrative? Structured is better for consistent injection
- **Context budget per chat turn:** How many tokens to allocate to user context vs leaving room for conversation? Suggest ~50K token budget for context, leaving rest for conversation + RAG
- **Staleness:** Should older context be weighted less? Or is all context equally valuable?
- **Assessment as context:** Auto-convert assessment into a UserContext entry, or keep as separate injection path?
