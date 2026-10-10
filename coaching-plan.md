# Coaching App — Enhancement Plan

## Current State (Implemented)

### Core Features
- Coaching sessions with rich-text notes, transcripts, recording URLs
- Auto-save on create (draft created immediately on "New Session")
- Session lifecycle: New → In Progress (Sprint) → Locked
- Auto-generated session titles from notes content
- "Chat About This" / "Chat All Sessions" with linked AI conversations
- Account-wide visibility (team members see each other's sessions)

### Coaching Framework (per-session modules)
- **Sales Maturity Stage** — dropdown selector, persists across sessions
- **Metrics** — editable name/definition, numeric value input, +/- since last session, archive/unarchive, add custom metrics, default "Customer Count" + "ARR"
- **Goals & Tasks** — inline-editable titles/descriptions, status dropdowns (Active/Done/Not Doing/Deprioritized), delete from dropdown, drag-and-drop reordering, anchor links for sharing, clickable URLs via Linkify
- **Task Descriptions** — expandable rich text area, click-to-edit with linkified display, auto-save with debounce

### UX
- Coaching modules appear at top of edit/create forms
- Session form gated on draft creation (no pop-in)
- All fields auto-save (1.5-2s debounce)
- Drag-and-drop for goal and task reordering

---

## Planned: "Up Next" Queue (Future Goals & Tasks)

### Concept
A revolving backlog of goals and tasks that the user plans to tackle after current items are completed. These live outside any specific session — they're a persistent queue that feeds into new sessions.

### Data Model

```prisma
model CoachingNextGoal {
  id          String  @id @default(cuid())
  userId      String
  user        User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  title       String
  description String? @db.Text
  order       Int     @default(0)

  tasks CoachingNextTask[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@map("coaching_next_goals")
}

model CoachingNextTask {
  id          String  @id @default(cuid())
  userId      String
  user        User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  goalId      String
  goal        CoachingNextGoal @relation(fields: [goalId], references: [id], onDelete: Cascade)

  title       String
  description String? @db.Text
  order       Int     @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([goalId])
  @@map("coaching_next_tasks")
}
```

### API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/coaching/next-goals` | List all next goals with tasks |
| POST | `/api/coaching/next-goals` | Create a next goal |
| PATCH | `/api/coaching/next-goals/[id]` | Update title, description, order |
| DELETE | `/api/coaching/next-goals/[id]` | Delete a next goal and its tasks |
| POST | `/api/coaching/next-goals/[id]/tasks` | Create a task under a next goal |
| PATCH | `/api/coaching/next-tasks/[id]` | Update a next task |
| DELETE | `/api/coaching/next-tasks/[id]` | Delete a next task |
| POST | `/api/coaching/next-goals/[id]/promote` | Promote a next goal → active coaching goal in current session |

### UI Design

#### Location
New section in CoachingFramework, below Goals & Tasks:

```
[Goals & Tasks]        ← existing, session-scoped
  ...

[Up Next]              ← new, user-scoped (not session-specific)
  Goal: "Build outbound motion"
    Task: "Research ICP verticals"
    Task: "Draft cold email sequence"
    + Add a task...
  Goal: "Hire first SDR"
    Task: "Write job description"
    + Add a task...
  + Add Next Goal
```

#### Behavior
- **Always visible** on every session (since it's user-scoped, not session-scoped)
- Same editing UX as Goals & Tasks: inline-editable titles/descriptions, drag-and-drop reorder, delete from dropdown, anchor links
- **No status dropdown** — these are future items, not yet active
- **"Promote to Session" button** on each goal — moves it (and its tasks) into the current session's Goals & Tasks as an active goal
  - On promote: creates a CoachingGoal + CoachingTasks in the current session, deletes the CoachingNextGoal + CoachingNextTasks
- Visual distinction: slightly different styling (dashed border or muted background) to differentiate from active goals
- Drag-and-drop reordering (same as active goals)
- Tasks within next goals also support descriptions, linkified URLs

#### Promote Flow
1. User clicks "Promote" on a next goal
2. System creates a new CoachingGoal in the current session with matching title/description
3. System creates CoachingTasks under that goal for each CoachingNextTask
4. System deletes the CoachingNextGoal and its tasks
5. UI optimistically moves the goal card from "Up Next" to "Goals & Tasks"

### Implementation Phases

#### Phase 1: Schema & API
- Add `CoachingNextGoal` and `CoachingNextTask` models to Prisma schema
- Create migration SQL
- Build CRUD API routes
- Build promote endpoint

#### Phase 2: UI
- Add "Up Next" section to CoachingFramework
- Reuse existing goal/task card components with modified styling
- Add promote button
- Add drag-and-drop reordering
- Auto-save with debounce

#### Phase 3: Polish
- Carry-forward: when creating a new session, "Up Next" items persist (they're user-scoped)
- Consider: auto-suggest promoting items when starting a new sprint
- Consider: count badge showing number of queued items
