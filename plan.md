# Cold Call Script Creator — Implementation Plan

## Overview

New applet following the exact same architecture as Email Sequence and LinkedIn Sequence. Generates two script types: **Outbound Cold Call** and **Inbound Lead Response**. Each includes a pattern-interrupt opener, elevator pitch, meeting close, and top 10 objection handles.

---

## Files to Create / Modify

### 1. Database — `prisma/schema.prisma`

Add `ColdCallScriptVersion` model (follows EmailSequenceVersion pattern exactly):

```prisma
model ColdCallScriptVersion {
  id                          String   @id @default(cuid())
  userId                      String
  user                        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  salesNarrativeVersionId     String
  salesNarrativeVersion       SalesNarrativeVersion @relation(...)

  firstCallChecklistVersionId String?
  firstCallChecklistVersion   FirstCallChecklistVersion? @relation(...)

  // Persona configuration
  orgPersona                  String   @db.Text
  humanPersona                String   @db.Text
  specialNotes                String?  @db.Text

  // "outbound" or "inbound"
  scriptType                  String   @default("outbound")

  // Generated output
  content                     String   @db.Text

  // Linked chat thread
  conversationId              String?

  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt

  @@index([userId, createdAt])
  @@map("cold_call_script_versions")
}
```

Also update the `User`, `SalesNarrativeVersion`, and `FirstCallChecklistVersion` models to add the reverse relation.

Then run: `npx prisma migrate dev --name add_cold_call_script`

### 2. API Routes (6 files — mirrors email-sequence structure)

#### `src/app/api/cold-call-script/generate/route.ts` (POST)
- Accepts: `orgPersona`, `humanPersona`, `specialNotes`, `scriptType` ("outbound" | "inbound"), `includeFirstCallChecklist`
- Fetches latest SalesNarrativeVersion (required) + optional FirstCallChecklistVersion
- Sends to Chatbase with script-type-specific prompt (see prompts below)
- Saves ColdCallScriptVersion to DB
- Creates linked Conversation via `createSequenceConversation`
- Upserts GTM variable `COLD_CALL_SCRIPT`

#### `src/app/api/cold-call-script/latest/route.ts` (GET)
- Returns latest version + `hasColdCallScript` boolean + `hasSalesNarrative` check

#### `src/app/api/cold-call-script/history/route.ts` (GET)
- Lists all versions for user (id, orgPersona, humanPersona, scriptType, createdAt)

#### `src/app/api/cold-call-script/versions/[id]/route.ts` (GET + PATCH)
- GET: Fetch specific version with userId check
- PATCH: Update content, upsert GTM variable

#### `src/app/api/cold-call-script/prefill-personas/route.ts` (POST)
- Identical to email-sequence prefill — sends narrative to Chatbase, returns `{ orgPersona, humanPersona }`

### 3. Frontend Pages (2 files)

#### `src/app/cold-call-script/page.tsx`
Same pattern as `email-sequence/page.tsx` with these differences:
- **Script type selector**: Toggle between "Outbound Cold Call" and "Inbound Lead Response" (radio buttons or tabs above the form)
- Form fields: `orgPersona`, `humanPersona`, `specialNotes`, `includeChecklist`, `scriptType`
- Auto-prefill personas on mount (same useEffect pattern)
- GeneratingOverlay with phone-themed emojis: `["📞", "🎯", "💬"]`
- Rotating messages: "Analyzing your sales narrative", "Crafting pattern interrupt opener", "Building elevator pitch", "Developing objection handles", "Scripting the close"

#### `src/app/cold-call-script/history/page.tsx`
Same pattern as `email-sequence/history/page.tsx` — lists versions with persona badges + script type badge ("Outbound" / "Inbound")

### 4. Navigation — `src/components/SalesNavBar.tsx`

Add to `topLevelItems` array:
```ts
{ href: "/cold-call-script", label: "📞 Cold Call", statusKey: "coldCallScript" }
```

Update existing Call Review to use a different icon (since 📞 is reused):
```ts
{ href: "/call-review", label: "🎧 Call Review", statusKey: "callReview" }
```

Add status fetch in the `Promise.all`:
```ts
fetch("/api/cold-call-script/latest").then(r => r.ok ? r.json() : null).catch(() => null)
```

Add to status object:
```ts
coldCallScript: !!coldCallScriptRes?.hasColdCallScript,
```

### 5. Sequence Conversation Helper — `src/lib/sequences/sequence-conversation.ts`

Add `"cold-call"` as a valid `sequenceType` (or just pass it through — check if the helper is generic enough already).

---

## AI Prompts

### Outbound Cold Call Script Prompt

```
You are an expert B2B cold calling coach helping a founder create a cold call script.

## INSTRUCTIONS:

Generate a complete outbound cold call script targeting the specified persona.

The script MUST include these sections in order:

### 1. PATTERN INTERRUPT OPENER
- A disarming, unexpected opening line that breaks the prospect out of "salesperson filter" mode
- NOT "How are you today?" or "Did I catch you at a bad time?"
- Should acknowledge the cold call honestly and create curiosity
- Include 2-3 opener variations the caller can rotate

### 2. QUICK ELEVATOR PITCH (15-20 seconds max)
- One sentence on who you help
- One sentence on the specific pain you solve
- One sentence on the outcome/result
- Must be conversational, not robotic

### 3. QUALIFYING QUESTIONS (2-3 questions)
- Questions to confirm fit and uncover pain
- Open-ended, not yes/no
- Designed to get the prospect talking

### 4. CLOSE FOR MEETING
- Transition from qualifying to booking
- Specific ask for 15-20 minute meeting
- Include the "give to get" — what they'll learn/get from the meeting
- Handle the calendar logistics naturally

### 5. TOP 10 OBJECTION HANDLES
For each objection, provide:
- The exact objection the prospect says
- The recommended response (conversational, empathetic, redirect)

Must include these common objections:
1. "I'm not interested"
2. "Send me an email"
3. "We already have a solution for that"
4. "I don't have time right now"
5. "What's this about?" / "Who are you?"
6. "How did you get my number?"
7. "We don't have the budget"
8. "I need to talk to my team"
9. "Call me back later" / "Now's not a good time"
10. "We're locked into a contract"

### 6. VOICEMAIL SCRIPT
- 20-30 second voicemail script
- Pattern interrupt + one pain point + soft CTA
- Include a follow-up voicemail for attempt #2

## TARGET PERSONA:
- Organization type: ${orgPersona}
- Target role: ${humanPersona}
${specialNotes ? `- Special notes: ${specialNotes}` : ""}

## TONE:
- Conversational, founder-to-executive
- Confident but not pushy
- Curious and consultative
- Never salesy or scripted-sounding

## OUTPUT FORMAT:
Return clean markdown (NO code blocks). Use headers, bold text, and clear structure.
```

### Inbound Lead Response Script Prompt

```
You are an expert B2B sales coach helping a founder create an inbound lead response script.

## INSTRUCTIONS:

Generate a complete inbound lead response call script for when a prospect has shown interest (downloaded content, requested a demo, filled out a form, etc.).

The script MUST include these sections in order:

### 1. OPENING / PATTERN INTERRUPT
- Acknowledge their action/interest immediately
- Create rapport quickly — they reached out, honor that
- Transition from "thanks for reaching out" to qualifying
- Include 2-3 opener variations based on lead source (demo request, content download, referral)

### 2. QUICK ELEVATOR PITCH (10-15 seconds)
- Shorter than outbound — they already know something about you
- Focus on confirming what they think you do and expanding it
- Bridge to discovery

### 3. QUALIFICATION FRAMEWORK (BANT-style)
- 4-6 qualifying questions to assess fit
- Questions about: current situation, pain severity, timeline, decision process, budget
- Designed to determine if this is a real opportunity
- Open-ended, gets prospect talking about their problems

### 4. CLOSE FOR NEXT STEP
- If qualified: Book a deeper discovery/demo call
- If not qualified: Graceful off-ramp with nurture path
- Specific ask with clear value proposition for the next meeting
- Handle calendar logistics

### 5. TOP 10 OBJECTION HANDLES
For each objection, provide:
- The exact objection
- The recommended response

Must include these inbound-specific objections:
1. "I was just looking / browsing"
2. "Can you just send me some info?"
3. "I'm not the decision maker"
4. "We're just starting to research"
5. "Your pricing seems high"
6. "How are you different from [competitor]?"
7. "We need to see a demo first"
8. "I need to loop in my team before we go further"
9. "We're not ready to buy right now"
10. "I downloaded [content] but I'm not really in-market"

### 6. FOLLOW-UP CADENCE
- What to do if they don't answer (timing, channels)
- Voicemail script for follow-up
- Text/email follow-up templates (1-2 sentences each)

## TARGET PERSONA:
- Organization type: ${orgPersona}
- Target role: ${humanPersona}
${specialNotes ? `- Special notes: ${specialNotes}` : ""}

## TONE:
- Warm, consultative, appreciative of their interest
- Confident but not assumptive
- Qualifying without interrogating
- Founder-to-executive peer conversation

## OUTPUT FORMAT:
Return clean markdown (NO code blocks). Use headers, bold text, and clear structure.
```

---

## Implementation Order

1. **Schema** — Add Prisma model + migrate
2. **API routes** — generate, latest, history, versions/[id], prefill-personas (copy from email-sequence, modify)
3. **Frontend page** — cold-call-script/page.tsx (copy email-sequence, add script type toggle)
4. **History page** — cold-call-script/history/page.tsx
5. **Nav update** — Add to SalesNavBar
6. **Type-check + test** — `npx tsc --noEmit`
7. **Commit + push**

---

## Key Differences from Email/LinkedIn Sequence

| Aspect | Email/LinkedIn | Cold Call Script |
|--------|---------------|-----------------|
| Script types | Single output | Two types: outbound + inbound |
| Extra form field | — | Script type radio/tabs |
| DB field | — | `scriptType` column |
| Content structure | Emails/messages | Opener → Pitch → Qualify → Close → Objections |
| GTM variable | `EMAIL_SEQUENCE` / `LINKEDIN_SEQUENCE` | `COLD_CALL_SCRIPT` |
| Nav icon | 📧 / 💼 | 📞 Cold Call |
