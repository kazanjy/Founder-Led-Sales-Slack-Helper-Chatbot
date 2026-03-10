# Coaching History Feature — Implementation Plan

## Overview
New "Coaching History" page where users create coaching sessions (date, notes, transcript), browse history, and chat with individual sessions, selected subsets, or all sessions combined.

---

## 1. Database Schema

Add `CoachingSession` model to `prisma/schema.prisma`:

```prisma
model CoachingSession {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  title       String                // e.g. "Weekly Coaching — Mar 3"
  sessionDate DateTime              // Date picker value
  notes       String   @db.Text     // Notes stored as markdown
  transcript  String?  @db.Text     // Optional pasted transcript

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId, sessionDate(sort: Desc)])
  @@map("coaching_sessions")
}
```

Add relation on `User` model: `coachingSessions CoachingSession[]`

Run `npx prisma db push` to apply.

---

## 2. API Routes

### `src/app/api/coaching-sessions/route.ts`
- **GET**: List all sessions for current user, ordered by `sessionDate desc`
- **POST**: Create new session `{ title, sessionDate, notes, transcript }`

### `src/app/api/coaching-sessions/[id]/route.ts`
- **GET**: Fetch single session
- **PUT**: Update session
- **DELETE**: Delete session

---

## 3. Page: `/coaching-history`

### `src/app/coaching-history/page.tsx`

**Layout:**
- SalesNavBar at top
- Left panel: Session list (date, title, preview) with "New Session" button at top
- Right panel: Selected session detail OR create/edit form

**Session List:**
- Cards sorted by date descending
- Each card: date, title, first ~100 chars of notes
- Click to view/edit
- Multi-select checkboxes for "Chat with selected"

**Create/Edit Form:**
- Title input
- Date picker (`<input type="date">`)
- Notes: `<textarea>` for markdown
- Transcript: Separate `<textarea>` with "Paste transcript" placeholder
- Save / Cancel buttons

**Action Buttons (when viewing a session):**
- "Chat About This Session" — ChatAboutButton for single session
- "Chat About All Sessions" — ChatAboutButton with all sessions concatenated
- "Chat About Selected" — Appears when checkboxes are checked, concatenates selected sessions

---

## 4. Chat Context Formatting

When sending coaching sessions to chat, format as:

```
## Coaching History

### Session: [Title] — [Date as MMM D, YYYY]
#### Notes
[notes content]

#### Call Transcript
[transcript content if present]

---

### Session: [Title] — [Date as MMM D, YYYY]
...
```

Sessions ordered chronologically (oldest first) so the LLM sees progression.

---

## 5. Chat Integration — Attachment Picker

Add `coachingHistory` as an attachment type:

**`src/app/api/attachments/available/route.ts`:**
- Add `coachingHistory` check: query `CoachingSession.count()` for user
- Return availability info with `appUrl: "/coaching-history"`

**`src/components/AttachmentPicker.tsx`:**
- Add metadata entry for `coachingHistory`

**`src/app/api/conversations/[id]/messages/stream/route.ts`:**
- Add `"coachingHistory"` to valid attachments
- In `fetchAttachmentContent()`, query all coaching sessions, format per section 4

---

## 6. Navigation

**`src/components/SalesNavBar.tsx`:**
- Add to playbook items: `{ href: "/coaching-history", label: "🎓 Coaching History", statusKey: "coachingHistory" }`

---

## 7. Implementation Order

1. Schema + migration
2. API routes (CRUD)
3. Frontend page (list + create/edit + detail)
4. Chat integration (ChatAboutButton + attachment picker + stream route)
5. Navigation
6. Type-check + push

---

## Files

**New (5):**
1. `src/app/coaching-history/page.tsx`
2. `src/app/api/coaching-sessions/route.ts`
3. `src/app/api/coaching-sessions/[id]/route.ts`
4. (schema changes in existing file)

**Modified (4):**
5. `prisma/schema.prisma` — Add CoachingSession model + User relation
6. `src/components/SalesNavBar.tsx` — Add nav item
7. `src/app/api/attachments/available/route.ts` — Add coachingHistory availability
8. `src/components/AttachmentPicker.tsx` — Add coachingHistory metadata
9. `src/app/api/conversations/[id]/messages/stream/route.ts` — Add coachingHistory attachment
