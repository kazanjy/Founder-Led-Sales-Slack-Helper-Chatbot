# Mikey Product Plan

---

# Mikey Apps Roadmap

Mikey is evolving from a single chat interface into a suite of interconnected "apps" - each a guided workflow that produces structured GTM artifacts. All apps share:
- Question-based wizard UX (modal step-by-step OR bulk edit mode)
- Versioned history of all inputs and outputs
- AI-generated outputs via Chatbase
- Merge variable integration for cross-app context injection
- CTAs to related apps (e.g., Sales Narrative → Discovery Questions)

## App List

| # | App | Status | Description |
|---|-----|--------|-------------|
| 1 | **General Chat** | ✅ Live | Free-form coaching conversation with Mikey |
| 2 | **GTM Maturity Assessment** | ✅ Live | 56-question assessment → AI recommendations on GTM stage |
| 3 | **Sales Narrative & Messaging** | 🔨 Next | Questionnaire → structured sales narrative + 100/50/25 word descriptions |
| 4 | **Sales Deck Outline & Script** | 📋 Planned | Guided deck structure → slide-by-slide script generation |
| 5 | **Discovery Questions** | 📋 Planned | Generate tailored discovery questions based on ICP + value prop |
| 6 | **First Call Checklist** | 📋 Planned | Customized checklist for first sales calls |
| 7 | **Ideal Customer Profile Documentation** | 📋 Planned | Structured ICP worksheet → documentation |
| 8 | **Sales Playbook Construction** | 📋 Planned | Aggregates outputs from other apps into comprehensive playbook |

## Cross-App Integration

Apps feed into each other:
```
GTM Maturity Assessment
         ↓
Sales Narrative & Messaging ←→ Ideal Customer Profile
         ↓
   Discovery Questions
         ↓
   First Call Checklist
         ↓
Sales Deck Outline & Script
         ↓
   Sales Playbook (aggregates all)
```

Each app's outputs become available as merge variables (e.g., `{{SALES_NARRATIVE}}`, `{{ICP_SUMMARY}}`, `{{VALUE_PROP_100W}}`) for use in prompts and other apps.

---

# Sales Narrative & Messaging App - Design

## Overview

A guided questionnaire that helps founders articulate their sales narrative following the Founding Sales methodology. Produces:
1. **Full Sales Narrative** - Structured narrative document
2. **100-word description** - Product marketing summary
3. **50-word description** - Elevator pitch
4. **25-word description** - Tagline/one-liner

All outputs are versioned and saved. Latest versions become merge variables.

## User Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    ENTRY POINTS                             │
│  • Sidebar nav "Sales Narrative"                            │
│  • CTA from GTM Assessment completion                       │
│  • CTA from chat when discussing positioning                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 QUESTIONNAIRE PHASE                         │
│  Mode A: Modal wizard (question-by-question)                │
│  Mode B: Bulk edit (all questions on one page)              │
│  • ~10-15 questions (TBD - user will provide)               │
│  • Auto-save on 2-sec debounce                              │
│  • Can save & exit, resume later                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  GENERATION PHASE                           │
│  User clicks "Generate Sales Narrative"                     │
│  • Answers sent to Chatbase with generation prompt          │
│  • Returns: narrative + 100w + 50w + 25w descriptions       │
│  • All saved as SalesNarrativeVersion                       │
│  • User can regenerate (creates new version)                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   OUTPUT DISPLAY                            │
│  • Full narrative (collapsible/expandable)                  │
│  • 100w / 50w / 25w tabs or cards                           │
│  • Copy buttons for each                                    │
│  • "Regenerate" button                                      │
│  • "Edit Answers" to go back and refine                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      CTAs                                   │
│  • "Create Discovery Questions" → Discovery Questions app   │
│  • "Build Your ICP" → ICP Documentation app                 │
│  • "Chat about your narrative" → General Chat w/ context    │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

```prisma
// Questions (seeded, like MaturityQuestion)
model SalesNarrativeQuestion {
  id          String   @id @default(cuid())
  category    String   // e.g., "Problem", "Solution", "Differentiation", "Proof"
  globalOrder Int      @unique
  question    String
  helpText    String?  // Optional guidance for answering
  enabled     Boolean  @default(true)

  answers     SalesNarrativeAnswer[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Answers (append-only for history, like MaturityAnswer)
model SalesNarrativeAnswer {
  id          String   @id @default(cuid())
  userId      String
  questionId  String
  versionId   String?  // Links to snapshot when narrative generated

  answer      String   @db.Text

  user        User     @relation(fields: [userId], references: [id])
  question    SalesNarrativeQuestion @relation(fields: [questionId], references: [id])
  version     SalesNarrativeVersion? @relation(fields: [versionId], references: [id])

  createdAt   DateTime @default(now())

  @@index([userId, questionId])
  @@index([versionId])
}

// Generated outputs (versioned)
model SalesNarrativeVersion {
  id          String   @id @default(cuid())
  userId      String

  // Snapshot of answers at generation time
  answers     SalesNarrativeAnswer[]

  // Generated outputs
  narrative       String   @db.Text  // Full sales narrative
  description100w String   @db.Text  // 100-word description
  description50w  String   @db.Text  // 50-word description
  description25w  String   @db.Text  // 25-word tagline

  // Optional: conversation for follow-up chat
  conversationId  String?

  user        User     @relation(fields: [userId], references: [id])

  createdAt   DateTime @default(now())

  @@index([userId, createdAt])
}
```

## API Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sales-narrative/questions` | GET | Fetch all questions with user's latest answers, grouped by category |
| `/api/sales-narrative/answers/[questionId]` | POST | Save answer (creates new row) |
| `/api/sales-narrative/answers/[questionId]` | GET | Get answer history for question |
| `/api/sales-narrative/generate` | POST | Submit answers → Chatbase → return generated outputs |
| `/api/sales-narrative/versions` | GET | List all versions for history view |
| `/api/sales-narrative/versions/[id]` | GET | Get specific version with answers and outputs |
| `/api/sales-narrative/latest` | GET | Get latest version (for merge variables) |

## Pages & Components

| Path | Component | Purpose |
|------|-----------|---------|
| `/sales-narrative` | `SalesNarrativePage` | Main page - shows current state (in-progress or latest version) |
| `/sales-narrative/edit` | `SalesNarrativeEditPage` | Bulk edit mode for all questions |
| `/sales-narrative/history` | `SalesNarrativeHistoryPage` | View all past versions |
| Modal | `SalesNarrativeWizardModal` | Step-by-step question flow |

## Merge Variables

When a SalesNarrativeVersion is generated, create/update merge variables:

| Merge Field | Source |
|-------------|--------|
| `{{SALES_NARRATIVE}}` | Full narrative text |
| `{{VALUE_PROP_100W}}` | 100-word description |
| `{{VALUE_PROP_50W}}` | 50-word description |
| `{{VALUE_PROP_25W}}` | 25-word tagline |

These can be used in:
- General chat prompts
- Other app generation prompts (e.g., Discovery Questions uses `{{VALUE_PROP_100W}}`)
- Saved prompt templates

## Chatbase Prompt (Generation)

```
You are helping a founder create their sales narrative following the Founding Sales methodology.

Based on the following questionnaire answers, generate:

1. A SALES NARRATIVE - A structured narrative document that follows this format:
   [USER WILL PROVIDE FORMAT EXAMPLE]

2. A 100-WORD DESCRIPTION - A product marketing summary suitable for a website or pitch deck

3. A 50-WORD DESCRIPTION - An elevator pitch that can be spoken in ~20 seconds

4. A 25-WORD DESCRIPTION - A tagline or one-liner for the product

## Questionnaire Answers:

[CHUNKED ANSWERS HERE]

---

Please respond in the following JSON format:
{
  "narrative": "...",
  "description100w": "...",
  "description50w": "...",
  "description25w": "..."
}
```

## Implementation Steps

### Phase 1: Data Model & Seeding
- [ ] Add Prisma models (SalesNarrativeQuestion, SalesNarrativeAnswer, SalesNarrativeVersion)
- [ ] Run migration
- [ ] Create seed script with questions (user to provide questions)
- [ ] Run seed

### Phase 2: API Endpoints
- [ ] `GET /api/sales-narrative/questions` - fetch questions + latest answers
- [ ] `POST /api/sales-narrative/answers/[questionId]` - save answer
- [ ] `POST /api/sales-narrative/generate` - generate narrative via Chatbase
- [ ] `GET /api/sales-narrative/versions` - list versions
- [ ] `GET /api/sales-narrative/versions/[id]` - get version detail
- [ ] `GET /api/sales-narrative/latest` - get latest for merge vars

### Phase 3: Bulk Edit Page
- [ ] Create `/sales-narrative/edit` page (copy pattern from `/assessment/bulk`)
- [ ] Question display grouped by category
- [ ] Auto-save on debounce
- [ ] Progress indicator
- [ ] "Generate Narrative" button

### Phase 4: Output Display
- [ ] Results view with narrative + descriptions
- [ ] Copy buttons
- [ ] Regenerate button
- [ ] Edit answers button

### Phase 5: History Page
- [ ] Create `/sales-narrative/history` page
- [ ] List of versions with dates
- [ ] Detail view showing answers + outputs

### Phase 6: Merge Variable Integration
- [ ] On generate, upsert merge variables (SALES_NARRATIVE, VALUE_PROP_*)
- [ ] Ensure merge variables available in chat context expansion

### Phase 7: Navigation & CTAs
- [ ] Add to sidebar navigation
- [ ] Add CTAs from GTM Assessment completion
- [ ] Add CTAs to other apps (Discovery Questions, ICP)

## Questions Needed From User

1. **Questions list** - The ~10-15 questions for the questionnaire, organized by category
2. **Narrative format example** - What the output Sales Narrative should look like (structure, sections, style)
3. **Navigation placement** - Where in the sidebar/app should this live?

---

# User-to-User Chat Sharing - Design

## Overview

Allow users to share a conversation with another Mikey user by email. The shared chat appears in the recipient's account, giving them read access (and optionally write access) to the conversation.

**Distinct from existing public sharing:**
- **Public share** (`/share/[code]`): Anyone with the link can view, no account needed, read-only
- **User share** (this feature): Specific user by email, must have Mikey account, shows in their sidebar, configurable permissions

## User Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    SHARER INITIATES                         │
│  • Click "Share" on conversation (existing button)          │
│  • Modal shows: Public link + NEW "Share with user" section │
│  • Enter email address                                      │
│  • Select permission: "Can view" or "Can view & reply"      │
│  • Click "Share"                                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    SYSTEM PROCESSES                         │
│  • Look up user by email (any of: email, slackEmail)        │
│  • If found: Create ConversationShare record                │
│  • If not found: Show error "No Mikey user with this email" │
│  • Optional: Send email notification to recipient           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  RECIPIENT EXPERIENCE                       │
│  • "Shared with me" section in sidebar (or tab/filter)      │
│  • Shows who shared it and when                             │
│  • Can view full conversation                               │
│  • If "Can reply": Can add messages (continues same thread) │
│  • Cannot delete or share further (owner only)              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   MANAGEMENT                                │
│  • Owner sees list of users they've shared with             │
│  • Can revoke access (delete ConversationShare)             │
│  • Can change permissions                                   │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

```prisma
model ConversationShare {
  id              String   @id @default(cuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  // Who shared it
  sharedByUserId  String
  sharedBy        User     @relation("SharedByUser", fields: [sharedByUserId], references: [id])

  // Who it's shared with
  sharedWithUserId String
  sharedWithUser   User     @relation("SharedWithUser", fields: [sharedWithUserId], references: [id])

  // Permissions
  canReply        Boolean  @default(false)  // false = view only, true = can add messages

  // Tracking
  viewedAt        DateTime?  // When recipient first viewed
  createdAt       DateTime @default(now())

  @@unique([conversationId, sharedWithUserId])  // Can only share once per user
  @@index([sharedWithUserId])  // For fetching "shared with me"
  @@index([conversationId])    // For fetching "who has access"
}
```

**Changes to Conversation model:**
```prisma
model Conversation {
  // ... existing fields ...

  shares          ConversationShare[]  // Add relation
}
```

**Changes to User model:**
```prisma
model User {
  // ... existing fields ...

  sharedByMe      ConversationShare[] @relation("SharedByUser")
  sharedWithMe    ConversationShare[] @relation("SharedWithUser")
}
```

## API Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /api/conversations/[id]/share-with-user` | POST | Share conversation with a user by email |
| `GET /api/conversations/[id]/shares` | GET | List all users this conversation is shared with |
| `DELETE /api/conversations/[id]/shares/[shareId]` | DELETE | Revoke a share |
| `PATCH /api/conversations/[id]/shares/[shareId]` | PATCH | Update permissions (canReply) |
| `GET /api/conversations/shared-with-me` | GET | List conversations shared with current user |

## Access Control Changes

**Current:** Conversation access checks `conversation.userId === currentUser.id`

**New:** Must also check for share access:
```typescript
async function canAccessConversation(userId: string, conversationId: string): Promise<{
  canAccess: boolean;
  canReply: boolean;
  isOwner: boolean;
}> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      shares: {
        where: { sharedWithUserId: userId }
      }
    }
  });

  if (!conversation) return { canAccess: false, canReply: false, isOwner: false };

  // Owner has full access
  if (conversation.userId === userId) {
    return { canAccess: true, canReply: true, isOwner: true };
  }

  // Check for share
  const share = conversation.shares[0];
  if (share) {
    return { canAccess: true, canReply: share.canReply, isOwner: false };
  }

  return { canAccess: false, canReply: false, isOwner: false };
}
```

**Endpoints to update:**
- `GET /api/conversations/[id]` - Allow if shared
- `GET /api/conversations/[id]/messages` - Allow if shared
- `POST /api/conversations/[id]/messages` - Allow if shared AND canReply
- `PATCH /api/conversations/[id]` - Owner only (rename, archive)
- `DELETE /api/conversations/[id]` - Owner only

## UI Components

### Share Modal Enhancement

Current modal shows public share link. Add a new section:

```
┌─────────────────────────────────────────────────┐
│  Share Conversation                             │
├─────────────────────────────────────────────────┤
│  PUBLIC LINK                                    │
│  [https://mikey.../share/abc123    ] [Copy]     │
│  Anyone with this link can view                 │
├─────────────────────────────────────────────────┤
│  SHARE WITH MIKEY USER                          │
│  Email: [_________________________]             │
│  Permission: (•) Can view  ( ) Can view & reply │
│  [Share]                                        │
│                                                 │
│  Shared with:                                   │
│  • pete@example.com (can reply) [Revoke]        │
│  • jane@example.com (view only) [Revoke]        │
└─────────────────────────────────────────────────┘
```

### Sidebar "Shared with me" Section

Option A: **Separate section** below "Your conversations"
```
YOUR CONVERSATIONS
  • Discovery call prep
  • ICP brainstorm

SHARED WITH ME
  • Sales narrative review (from pete@...)
  • Comp plan discussion (from jane@...)
```

Option B: **Filter/tab** at top of conversation list
```
[My Chats] [Shared with Me]
```

Option C: **Mixed list** with visual indicator (badge/icon)
```
• Discovery call prep
• ICP brainstorm
• 🔗 Sales narrative review (shared by Pete)
```

**Recommendation:** Option A (separate section) - clearest UX, easy to implement

### Shared Chat Indicators

When viewing a shared conversation:
- Banner at top: "Shared by pete@example.com • View only" or "Shared by pete@example.com • You can reply"
- If view-only: Input field disabled or hidden
- Owner indicator removed (show "Shared with you" instead)

## Email Notifications (Optional)

When a chat is shared, optionally send email to recipient:

**Subject:** "Pete shared a Mikey conversation with you"

**Body:**
```
Pete Kazanjy shared a conversation with you on Mikey.

"Sales narrative brainstorm"

You can view (and reply to) this conversation in your Mikey account.

[View Conversation]
```

**Implementation:** Use existing email infrastructure (if any) or add SendGrid/Resend integration.

## Implementation Steps

### Phase 1: Data Model
- [ ] Add ConversationShare model to Prisma schema
- [ ] Add relations to Conversation and User models
- [ ] Run migration

### Phase 2: API Endpoints
- [ ] `POST /api/conversations/[id]/share-with-user` - create share
- [ ] `GET /api/conversations/[id]/shares` - list shares
- [ ] `DELETE /api/conversations/[id]/shares/[shareId]` - revoke
- [ ] `GET /api/conversations/shared-with-me` - list shared with current user

### Phase 3: Access Control
- [ ] Create `canAccessConversation()` helper
- [ ] Update conversation GET endpoint
- [ ] Update messages GET endpoint
- [ ] Update messages POST endpoint (check canReply)
- [ ] Ensure owner-only actions remain protected

### Phase 4: UI - Share Modal
- [ ] Add "Share with user" section to existing share modal
- [ ] Email input + permission selector
- [ ] List of current shares with revoke buttons
- [ ] Error handling for unknown emails

### Phase 5: UI - Sidebar
- [ ] Add "Shared with me" section to sidebar
- [ ] Fetch shared conversations on load
- [ ] Visual distinction from owned conversations

### Phase 6: UI - Shared Chat View
- [ ] Banner showing who shared and permissions
- [ ] Disable input if view-only
- [ ] Hide owner-only actions (delete, archive, share further)

### Phase 7: Notifications (Optional)
- [ ] Email notification on share
- [ ] In-app notification badge (if notification system exists)

## Design Decisions to Make

1. **Can recipients share further?** Recommend: No, owner only
2. **Can recipients archive/hide shared chats?** Recommend: Yes, just hides from their view
3. **What happens if owner deletes conversation?** Recommend: Cascade delete shares, disappears from recipients
4. **Notification preference?** Recommend: Start without email, add later based on demand
5. **Sidebar placement?** Recommend: Separate "Shared with me" section

---

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
