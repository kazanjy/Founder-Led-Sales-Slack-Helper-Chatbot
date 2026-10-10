# Email Sequence & LinkedIn Sequence Apps - Implementation Plan

## Overview

Two new sales tools that generate outreach sequences (email and LinkedIn) using the sales narrative and optionally first call checklist as context. Each has a persona configuration UI with AI-powered prefill, generates content via Chatbase RAG, and creates a linked Chat thread.

---

## 1. Database Schema (Prisma)

### New Models

```prisma
model EmailSequenceVersion {
  id                          String   @id @default(cuid())
  userId                      String
  user                        User     @relation(...)
  salesNarrativeVersionId     String
  salesNarrativeVersion       SalesNarrativeVersion @relation(...)
  firstCallChecklistVersionId String?
  firstCallChecklistVersion   FirstCallChecklistVersion? @relation(...)
  orgPersona                  String   @db.Text    // e.g. "Series B SaaS company" or "Generic"
  humanPersona                String   @db.Text    // e.g. "VP of Sales" or "Generic"
  specialNotes                String?  @db.Text    // optional context (conference, offer, etc.)
  content                     String   @db.Text    // generated markdown
  conversationId              String?              // linked chat thread
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt
  @@index([userId, createdAt])
  @@map("email_sequence_versions")
}

model LinkedInSequenceVersion {
  id                          String   @id @default(cuid())
  userId                      String
  user                        User     @relation(...)
  salesNarrativeVersionId     String
  salesNarrativeVersion       SalesNarrativeVersion @relation(...)
  firstCallChecklistVersionId String?
  firstCallChecklistVersion   FirstCallChecklistVersion? @relation(...)
  orgPersona                  String   @db.Text
  humanPersona                String   @db.Text
  specialNotes                String?  @db.Text
  content                     String   @db.Text    // generated markdown
  conversationId              String?              // linked chat thread
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt
  @@index([userId, createdAt])
  @@map("linkedin_sequence_versions")
}
```

### Migration SQL
- `CREATE TABLE email_sequence_versions` with all fields, indexes, and FKs
- `CREATE TABLE linkedin_sequence_versions` with all fields, indexes, and FKs
- Add relations to User, SalesNarrativeVersion, FirstCallChecklistVersion in schema.prisma

---

## 2. API Routes

### Email Sequence

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/email-sequence/latest` | GET | Get latest version + `hasEmailSequence` flag |
| `/api/email-sequence/generate` | POST | Generate via Chatbase with persona + context |
| `/api/email-sequence/versions/[id]` | GET | Get specific version |
| `/api/email-sequence/versions/[id]` | PATCH | Edit/save content |
| `/api/email-sequence/history` | GET | List all versions |
| `/api/email-sequence/prefill-personas` | POST | AI call to prefill org/human persona from sales narrative |

### LinkedIn Sequence

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/linkedin-sequence/latest` | GET | Get latest version + `hasLinkedInSequence` flag |
| `/api/linkedin-sequence/generate` | POST | Generate via Chatbase with persona + context |
| `/api/linkedin-sequence/versions/[id]` | GET | Get specific version |
| `/api/linkedin-sequence/versions/[id]` | PATCH | Edit/save content |
| `/api/linkedin-sequence/history` | GET | List all versions |
| `/api/linkedin-sequence/prefill-personas` | POST | AI call to prefill org/human persona from sales narrative |

### Shared Prefill Endpoint (alternative)
Could use one shared endpoint `/api/sequences/prefill-personas` since both need the same logic.

### Updates to Existing APIs
- `/api/documents/clone` — Add `emailSequence` and `linkedInSequence` cases
- `/api/documents/share` — Add to `validTypes` array

---

## 3. Generate API Pattern

### `/api/email-sequence/generate` (POST)
```
Input: { orgPersona, humanPersona, specialNotes?, includeFirstCallChecklist? }

1. Auth check
2. Fetch latest SalesNarrativeVersion (required)
3. Optionally fetch latest FirstCallChecklistVersion
4. Build Chatbase prompt:
   - System: "You are an expert B2B outbound sales copywriter helping a founder
     create a cold email sequence..."
   - Context: Sales narrative text + optional first call checklist
   - Persona: "Target organization: {orgPersona}. Target buyer: {humanPersona}."
   - Special notes: if provided
   - Instructions: AI decides number of emails and structure based on product/persona.
     Each email should have: Subject line, Body, Send timing note.
   - Output: Clean markdown
5. Call sendToChatbase() (with chunking if context is large)
6. Parse/clean response (strip code blocks)
7. Save EmailSequenceVersion to DB (with orgPersona, humanPersona, specialNotes)
8. Create Chat conversation (like research-conversation pattern):
   - USER msg: "Generate an email sequence targeting {orgPersona} / {humanPersona}..."
   - ASSISTANT msg: "[View full Email Sequence](link)\n\n{content}"
   - Title: "Email Sequence: {orgPersona} — {humanPersona}"
9. Update GTM variable: EMAIL_SEQUENCE
10. Return version + conversationId
```

### `/api/linkedin-sequence/generate` (POST)
Same pattern but prompt specifies:
- Connection request note (max ~300 chars, LinkedIn limit)
- 2 follow-up messages after connecting
- 1 breakup message
- Each touchpoint: Message text, Timing note, Character count for connection request
- Output: Clean markdown

---

## 4. Persona Prefill API

### `/api/email-sequence/prefill-personas` (POST)
(Same logic for LinkedIn — could be one shared endpoint)

```
1. Fetch latest sales narrative
2. Send to Chatbase:
   "Based on this sales narrative, suggest the most likely:
   1. Organizational persona — the type of company they sell to
      (e.g. 'Series B SaaS company', 'Enterprise manufacturing firm')
   2. Human persona — the buyer role they should target
      (e.g. 'VP of Sales', 'Head of Engineering')

   Sales Narrative:
   {narrative text}

   Respond in JSON: { "orgPersona": "...", "humanPersona": "..." }"
3. Parse JSON response
4. Return { orgPersona, humanPersona }
```

Auto-called on page mount. User can edit before generating.

---

## 5. Chat Thread Creation

### New file: `src/lib/sequences/sequence-conversation.ts`

Follows the `createResearchConversation` pattern from `src/lib/search/research-conversation.ts`:

```typescript
export async function createSequenceConversation(params: {
  userId: string;
  sequenceType: "email" | "linkedin";
  sequenceId: string;
  orgPersona: string;
  humanPersona: string;
  specialNotes?: string;
  content: string;
  reportUrl: string;
}) {
  const typeLabel = sequenceType === "email" ? "Email Sequence" : "LinkedIn Sequence";

  // Build USER message
  const inputLines = [`Generate a ${typeLabel.toLowerCase()} for:`];
  inputLines.push(`- Organization: ${orgPersona}`);
  inputLines.push(`- Target Role: ${humanPersona}`);
  if (specialNotes) inputLines.push(`- Special Notes: ${specialNotes}`);
  const userMessage = inputLines.join("\n");

  // Build ASSISTANT message with report link
  const assistantMessage = `[View full ${typeLabel}](${reportUrl})\n\n${content}`;

  // Title
  const title = `${typeLabel}: ${orgPersona} — ${humanPersona}`;

  return prisma.conversation.create({
    data: {
      userId,
      source: "WEB",
      title,
      firstMessagePreview: userMessage.substring(0, 100),
      messageCount: 2,
      lastMessageAt: new Date(),
      messages: {
        create: [
          { userId, role: "USER", content: userMessage },
          { role: "ASSISTANT", content: assistantMessage },
        ],
      },
    },
  });
}
```

---

## 6. Frontend Pages

### Email Sequence Page: `/email-sequence/page.tsx`

**Page States:**

1. **Loading** — Spinner with SalesNavBar
2. **No sales narrative** — Gate: "Sales Narrative Required" with link to create one
3. **No version yet** — Persona configuration form + Generate button (see below)
4. **Has version** — Display generated sequence with header buttons

**State 3: Persona Configuration Form**
```
┌─────────────────────────────────────────────────┐
│ 📧 Generate Email Sequence                       │
│                                                   │
│ Organizational Persona                            │
│ ┌───────────────────────────────────────────────┐ │
│ │ Series B SaaS company               [AI ↻]   │ │
│ └───────────────────────────────────────────────┘ │
│                                                   │
│ Target Role / Human Persona                       │
│ ┌───────────────────────────────────────────────┐ │
│ │ VP of Sales                          [AI ↻]   │ │
│ └───────────────────────────────────────────────┘ │
│                                                   │
│ Special Notes (optional)                          │
│ ┌───────────────────────────────────────────────┐ │
│ │ We're attending SaaStr Annual next month,     │ │
│ │ mention the conference...                      │ │
│ └───────────────────────────────────────────────┘ │
│                                                   │
│ ☐ Include First Call Checklist context            │
│                                                   │
│        [ ⚡ Generate Email Sequence ]              │
└─────────────────────────────────────────────────┘
```

- On mount: auto-call `/api/email-sequence/prefill-personas` to fill persona fields from sales narrative
- User can edit both fields before generating
- "AI ↻" refresh button re-runs prefill for individual fields
- Special Notes is a textarea for freeform context
- Checkbox to optionally include First Call Checklist as additional context

**State 4: Generated View**
- Header with: Copy / Link (share) / Edit / History / Clone / Regenerate buttons
- RichTextEditor in edit mode, ReactMarkdown in view mode
- Persona badges at top showing org + human persona used
- "Generated From" section showing linked sales narrative
- "Chat About It" link to the auto-created conversation

**Regenerate flow:** When clicking Regenerate on an existing version, show the persona form again (prefilled with current values) so user can adjust before regenerating.

### LinkedIn Sequence Page: `/linkedin-sequence/page.tsx`
Same structure as email, different:
- Emoji: 💼 instead of 📧
- Title: "LinkedIn Sequence"
- Prompt tailored for LinkedIn format (connection request + 2 messages + breakup)

### History Pages
- `/email-sequence/history/page.tsx`
- `/linkedin-sequence/history/page.tsx`
- Follow existing history page pattern
- Show org persona + human persona in each history item
- SalesNavBar at top

---

## 7. SalesNavBar Updates

### Add two new nav items:
```typescript
const navItems: NavItem[] = [
  { href: "/chat", label: "💬 Chat", statusKey: "chat" },
  { href: "/assessment/bulk", label: "📊 GTM Assessment", statusKey: "assessment" },
  { href: "/sales-narrative", label: "📖 Sales Narrative", statusKey: "salesNarrative" },
  { href: "/discovery-questions", label: "🔍 Discovery Questions", statusKey: "discoveryQuestions" },
  { href: "/first-call-checklist", label: "✅ First Call Checklist", statusKey: "firstCallChecklist" },
  { href: "/pre-call-planning", label: "📋 Pre-Call Checklist", statusKey: "preCallPlanning" },
  { href: "/pre-call-planning/research", label: "🔬 Pre-Call Research", statusKey: "preCallResearch" },
  // NEW:
  { href: "/email-sequence", label: "📧 Email Sequence", statusKey: "emailSequence" },
  { href: "/linkedin-sequence", label: "💼 LinkedIn Sequence", statusKey: "linkedInSequence" },
];
```

### Add status fetching (parallel with existing calls):
```typescript
fetch("/api/email-sequence/latest").then(...)   → emailSequence: !!res?.hasEmailSequence
fetch("/api/linkedin-sequence/latest").then(...) → linkedInSequence: !!res?.hasLinkedInSequence
```

### Update `isActive` for new routes.

---

## 8. Clone & Share Updates

### Clone API (`/api/documents/clone`)
Add two new cases copying all fields (orgPersona, humanPersona, specialNotes, content, salesNarrativeVersionId, firstCallChecklistVersionId).

### Share API (`/api/documents/share`)
Add `"emailSequence"` and `"linkedInSequence"` to `validTypes` array.

---

## 9. Files to Create

| # | File | Purpose |
|---|------|---------|
| 1 | `prisma/migrations/YYYYMMDD_add_sequence_models/migration.sql` | DB migration |
| 2 | `src/lib/sequences/sequence-conversation.ts` | Chat thread creation helper |
| 3 | `src/app/api/email-sequence/latest/route.ts` | Latest version API |
| 4 | `src/app/api/email-sequence/generate/route.ts` | Generate via Chatbase |
| 5 | `src/app/api/email-sequence/versions/[id]/route.ts` | Get/edit version |
| 6 | `src/app/api/email-sequence/history/route.ts` | List versions |
| 7 | `src/app/api/email-sequence/prefill-personas/route.ts` | AI persona prefill |
| 8 | `src/app/api/linkedin-sequence/latest/route.ts` | Latest version API |
| 9 | `src/app/api/linkedin-sequence/generate/route.ts` | Generate via Chatbase |
| 10 | `src/app/api/linkedin-sequence/versions/[id]/route.ts` | Get/edit version |
| 11 | `src/app/api/linkedin-sequence/history/route.ts` | List versions |
| 12 | `src/app/api/linkedin-sequence/prefill-personas/route.ts` | AI persona prefill |
| 13 | `src/app/email-sequence/page.tsx` | Main email sequence page |
| 14 | `src/app/email-sequence/history/page.tsx` | Email sequence history |
| 15 | `src/app/linkedin-sequence/page.tsx` | Main LinkedIn sequence page |
| 16 | `src/app/linkedin-sequence/history/page.tsx` | LinkedIn sequence history |

## 10. Files to Modify

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 2 new models + relations on User, SalesNarrativeVersion, FirstCallChecklistVersion |
| `src/components/SalesNavBar.tsx` | Add 2 nav items + status fetching + isActive rules |
| `src/app/api/documents/clone/route.ts` | Add `emailSequence` and `linkedInSequence` cases |
| `src/app/api/documents/share/route.ts` | Add to `validTypes` array |

---

## 11. Implementation Order

1. **Schema + Migration** — Prisma models + SQL migration file
2. **Shared helper** — `sequence-conversation.ts` for chat thread creation
3. **Email Sequence APIs** — latest, generate, versions/[id], history, prefill-personas
4. **Email Sequence Pages** — main page (all 4 states) + history page
5. **LinkedIn Sequence APIs** — same set (very similar to email, different prompt)
6. **LinkedIn Sequence Pages** — main page + history page
7. **Nav bar + Clone + Share** — Update SalesNavBar, clone API, share API
8. **Type check** — Verify everything compiles with `npx tsc --noEmit`
