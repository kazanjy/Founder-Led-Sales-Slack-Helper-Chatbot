# Projects (Chat Folders) Feature — Implementation Plan

**STATUS: COMPLETED**

## Overview

Add "Projects" capability to the chat sidebar, allowing users to organize conversations into named folders. Projects can represent deals, marketing campaigns, research threads, or any grouping the user wants.

**Tagline for empty state:** "Bundle your Mikey chats for a deal, a marketing project, or anything else you're working on."

---

## Data Model

### New: Project

```
Project
├── id (cuid)
├── userId (FK → User)
├── name (String) — e.g., "Founder Led Sales Factory Assets"
├── description (String?, text) — AI-generated or user-edited
├── order (Int) — sidebar display order
├── createdAt, updatedAt
```

### Modified: Conversation

```
Conversation (add field)
├── projectId (String?, FK → Project) — null = unfiled
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/projects` | GET | List user's projects with conversation counts |
| `/api/projects` | POST | Create project (name, optional description) |
| `/api/projects/[id]` | PATCH | Update name, description, order |
| `/api/projects/[id]` | DELETE | Delete project (conversations become unfiled) |
| `/api/projects/[id]/describe` | POST | AI-generate description from conversation titles |
| `/api/conversations/[id]` | PATCH | Add `projectId` to existing update fields |
| `/api/conversations/search` | Extend | Include project names/descriptions in search results |

---

## Sidebar UI Structure

```
[+ New Chat]  [🔍]

Projects ▾
  [+ New project]
  📁 Founder Led Sales Factory A...     ← click → project page
  📁 MikeyBot Founder Led Sales ...
  📁 Michael Tutoring
  📁 Taxes 2026
  📁 Founder Led Sales Discovery...
  ••• More                              ← expand to see rest

Recents                                 ← unfiled conversations
  Ski Helmet Sizing Explained
  100m World Records
  ...
```

- **Projects section** is collapsible with a header toggle
- Shows top 5 projects by most recent activity, "More" expands all
- Clicking a project navigates to `/chat?project={id}` which shows a project detail view
- Projects section comes before the Recents conversation list

---

## Project Detail View (in-page, not a new route)

When a project is selected in the sidebar:

- **Header**: Project name (editable inline), description below it
- **"Describe" button**: Calls AI to generate description from the conversation titles/previews in the project
- **Chat list**: All conversations in the project, sorted by lastMessageAt
- **"New chat in {project}"**: Creates a conversation pre-assigned to this project
- **Empty state**: "Add chats to this project using the ⋯ menu on any conversation"

---

## Adding Chats to Projects

Three entry points:

1. **Three-dot menu on conversations** (sidebar) → "Move to Project" → submenu with project list + "New Project"
2. **From within a chat** → Header area shows project badge if assigned, or "Add to Project" action
3. **From project detail view** → Existing chats can be removed with an "×" or via their three-dot menu

---

## Search Integration

- Project names and descriptions are included in `/api/conversations/search` results
- Project results appear as a separate group: "📁 Project Name" with chat count
- Clicking a project result navigates to the project view

---

## AI Description Generation

When user clicks "Describe" on a project:

1. Collect all conversation titles + first message previews in the project
2. Send to GPT-5.2: "Based on these conversation topics, write a 1-2 sentence description of what this project is about"
3. Save to project description field

---

## Empty State / Onboarding

First time the Projects section shows (0 projects), display:

> **Projects** — Bundle your Mikey chats for a deal, a marketing project, or anything else you're working on.
> [+ Create your first project]

---

## Key Design Decisions

- **User-scoped, not account-scoped**: Projects belong to individual users (unlike readiness which is account-scoped). Different team members may organize differently.
- **Conversations can be in 0 or 1 project**: No multi-project assignment to keep it simple.
- **Deleting a project doesn't delete conversations**: They just become unfiled again.
- **Order is manual**: User can reorder projects (drag or up/down). Default order is creation order.
- **No nesting**: Flat project list only, no sub-folders.

---

## Implementation Order

1. ~~**DB**: Add Project model + projectId on Conversation + migration~~ ✅
2. ~~**API**: CRUD for projects, update conversation PATCH, AI describe~~ ✅
3. ~~**Sidebar**: Projects section with list, "New project", "More" toggle~~ ✅
4. ~~**Project view**: Detail page shown when project selected~~ ✅
5. ~~**Three-dot menu**: "Move to Project" submenu on conversations~~ ✅
6. ~~**Chat header**: Project badge + "Add to Project"~~ ✅
7. ~~**Search**: Extend to include project names/descriptions~~ ✅

## Future / Phase 2

- **Share projects**: Email-based sharing (same pattern as Share Chat). Sharing a project implicitly shares all conversations in it.
- **Drag-and-drop**: Reorder projects in sidebar, drag conversations between projects.
- **Project search results in UI**: Surface project matches in the search modal (API returns them, UI doesn't render yet).

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add Project model, projectId on Conversation |
| `src/app/chat/[[...id]]/page.tsx` | Sidebar projects section, project detail view, three-dot menu submenu, chat header badge |
| `src/app/api/projects/route.ts` | GET (list) + POST (create) |
| `src/app/api/projects/[id]/route.ts` | PATCH (update) + DELETE |
| `src/app/api/projects/[id]/describe/route.ts` | POST (AI description) |
| `src/app/api/conversations/[id]/route.ts` | Add projectId to PATCH handler |
| `src/app/api/conversations/route.ts` | Include projectId in GET response |
| `src/app/api/conversations/search/route.ts` | Extend search to include project names/descriptions |
