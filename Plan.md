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
| 3 | **Sales Narrative & Messaging** | ✅ Live | Questionnaire → structured sales narrative + 100/50/25 word descriptions |
| 4 | **Discovery Questions** | ✅ Live | Generate tailored discovery questions based on sales narrative |
| 5 | **Sales Deck Outline & Script** | 📋 Planned | Guided deck structure → slide-by-slide script generation |
| 6 | **First Call Checklist** | ✅ Live | Customized checklist for first discovery calls |
| 7 | **Ideal Customer Profile Documentation** | 📋 Planned | Structured ICP worksheet → documentation |
| 8 | **Sales Playbook Construction** | 📋 Planned | Aggregates outputs from other apps into comprehensive playbook |

## TODO / Known Issues

- [ ] **First Call Checklist: Better rich text editor** - Current MDEditor shows ugly markdown/preview side-by-side. Need a true WYSIWYG editor (e.g., TipTap, Lexical, or Plate) that feels like editing in Notion/Google Docs rather than raw markdown.

---

# Prompt Attachments Feature

## Overview

Allow users to attach context from completed apps (Sales Narrative, GTM Assessment, Discovery Questions, First Call Checklist) to their chat messages. Attachments provide rich context to the AI without requiring users to copy/paste or use merge field syntax.

**Key insight:** Attachments only matter for the **first message** of a new conversation. After that, Chatbase has the context in its memory via `conversationId`.

## UX Design

### UI Components

```
┌─────────────────────────────────────────────────────────────┐
│ 📎 Sales Narrative  ✕  │  📎 GTM Assessment  ✕              │  ← Attachment chips
├─────────────────────────────────────────────────────────────┤
│ Type your message...                                   [📎] │  ← Paperclip picker button
└─────────────────────────────────────────────────────────────┘
```

### Paperclip Picker (Multi-select dropdown)

```
┌─────────────────────────────────────────┐
│ Attach Context                          │
├─────────────────────────────────────────┤
│ ☑ Sales Narrative          ✓ Ready     │
│ ☐ GTM Assessment           ✓ Ready     │
│ ☐ Discovery Questions      ✓ Ready     │
│ ☐ First Call Checklist     → Start     │  ← Incomplete, links to app
└─────────────────────────────────────────┘
```

### States

1. **New conversation, no attachments selected:** Show paperclip button, apply defaults
2. **Attachments selected:** Show chips above input with ✕ to remove
3. **After first message sent:** Chips show "✓ Included" (read-only), paperclip hidden for that conversation
4. **Incomplete attachment clicked:** Opens the relevant app to complete it

## Behavior Rules

### Defaults
- **Sales Narrative:** Default ON for new conversations if user has completed one
- **Others:** Default OFF

### Persistence
- Attachment preferences are **sticky** across conversations
- If user removes an attachment, it stays OFF for **24 hours** (per-attachment)
- After 24 hours, defaults re-apply

### First Message Only
- Attachments are appended to the **first message** of a conversation only
- After sending, Chatbase has the context via `conversationId`
- UI shows attachments as "included" (read-only) for remainder of conversation

## Data Model

### New: User Attachment Preferences

```prisma
model UserAttachmentPreference {
  id        String   @id @default(cuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // JSON structure for flexibility
  // {
  //   "salesNarrative": { "enabled": true, "disabledUntil": null },
  //   "gtmAssessment": { "enabled": false, "disabledUntil": "2024-02-24T10:00:00Z" },
  //   "discoveryQuestions": { "enabled": false, "disabledUntil": null },
  //   "firstCallChecklist": { "enabled": false, "disabledUntil": null }
  // }
  preferences Json    @default("{}")

  updatedAt DateTime @updatedAt

  @@map("user_attachment_preferences")
}
```

### Track Attachments on Conversation

```prisma
model Conversation {
  // ... existing fields ...

  // Track which attachments were included in first message
  attachmentsIncluded Json?  // ["salesNarrative", "gtmAssessment"]
}
```

## Content Sources

| Attachment | Source | Content |
|------------|--------|---------|
| Sales Narrative | `GtmVariable` where `mergeField = 'SALES_NARRATIVE'` | Full narrative + 100w/50w/25w descriptions |
| GTM Assessment | `MaturityAssessment` + `MaturityAnswer` | All Q&A pairings formatted as markdown |
| Discovery Questions | `GtmVariable` where `mergeField = 'DISCOVERY_QUESTIONS'` | Full generated questions |
| First Call Checklist | `GtmVariable` where `mergeField = 'FIRST_CALL_CHECKLIST'` | Full markdown checklist |

### Future Apps Integration

When building the remaining planned apps, ensure they integrate with the attachment system:

| Future App | Merge Field | Attachment Type | Notes |
|------------|-------------|-----------------|-------|
| **Sales Deck Outline & Script** | `SALES_DECK` | `salesDeck` | Slide-by-slide script, deck structure |
| **Ideal Customer Profile** | `ICP_SUMMARY` | `icpDocumentation` | Full ICP worksheet/documentation |
| **Sales Playbook** | `SALES_PLAYBOOK` | `salesPlaybook` | Aggregated playbook content |

**Implementation checklist for each new app:**
1. Store output in `GtmVariable` with the appropriate merge field
2. Add to `DEFAULT_PREFERENCES` in `/api/attachments/preferences/route.ts` (default OFF)
3. Add case to switch statement in `/api/attachments/content/[type]/route.ts`
4. Add to `GET /api/attachments/available` endpoint
5. Add to `validAttachments` array in PATCH handler
6. Update TypeScript types (`AttachmentPreferences` interface)

## API Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/attachments/available` | GET | List available attachments with completion status |
| `GET /api/attachments/preferences` | GET | Get user's attachment preferences |
| `PATCH /api/attachments/preferences` | PATCH | Update preferences (enable/disable) |
| `GET /api/attachments/content/[type]` | GET | Fetch content for a specific attachment type |

## Message Injection

When attachments are included, append to user's message:

```
[User's original message]

---

**The following context was attached by the user to provide background:**

## Sales Narrative
[Full sales narrative content...]

## GTM Assessment (Q&A)
**Q1: Which executive is responsible for revenue?**
A: [Answer...]

**Q2: What is your current revenue status?**
A: [Answer...]
[... etc ...]
```

## Implementation Steps

### Phase 1: Data Model & API
- [ ] Add `UserAttachmentPreference` model to Prisma schema
- [ ] Add `attachmentsIncluded` to Conversation model
- [ ] Run migration
- [ ] Create `GET /api/attachments/available` endpoint
- [ ] Create `GET/PATCH /api/attachments/preferences` endpoints
- [ ] Create `GET /api/attachments/content/[type]` endpoint

### Phase 2: Content Fetching
- [ ] Implement Sales Narrative content fetcher (from GtmVariable)
- [ ] Implement GTM Assessment content fetcher (format Q&A from MaturityAssessment)
- [ ] Implement Discovery Questions content fetcher (from GtmVariable)
- [ ] Implement First Call Checklist content fetcher (from GtmVariable)

### Phase 3: Chat UI
- [ ] Add paperclip button to chat input area
- [ ] Create attachment picker dropdown (multi-select)
- [ ] Show attachment chips above input when selected
- [ ] Handle "incomplete" attachments → link to app
- [ ] Apply default preferences on new conversation

### Phase 4: Message Sending
- [ ] Modify chat send flow to check for attachments
- [ ] Fetch attachment content and append to message
- [ ] Save `attachmentsIncluded` to conversation on first message
- [ ] Update UI to show "included" state after send

### Phase 5: Preference Logic
- [ ] Implement 24-hour disable timer
- [ ] Apply defaults respecting disable timers
- [ ] Persist preference changes

## Relationship to Existing Merge Fields

**Merge fields** (`{{SALES_NARRATIVE}}`) remain for:
- Power users who want inline variable insertion in saved prompts
- Template-based prompt construction

**Attachments** are for:
- Simple, UI-driven context inclusion
- Ad-hoc chat without needing to know syntax
- First-message context injection

Both use the same underlying data from `GtmVariable` / app outputs.

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

## App Navigation Design

**Approach: App Switcher Dropdown + Persistent "New Chat"**

The sidebar gets an app selector dropdown that shows which app you're in and allows switching. "+ New Chat" remains always visible regardless of which app is active.

### Default State (Chat App)
```
┌─────────────────────────────────┐
│  [Mikey Logo]                   │
│  Pete Kazanjy | Founding...     │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 💬 Chat               ▼   │  │  ← App selector dropdown
│  └───────────────────────────┘  │
│                                 │
│  [        + New Chat         ]  │  ← Always visible
│                                 │
│  [🔍 Search               ⌘K]  │
│                                 │
│  ─── RECENT CHATS ───           │
│  • Discovery call prep          │
│  • ICP brainstorm               │
│                                 │
└─────────────────────────────────┘
```

### Dropdown Menu (Click to expand)
```
┌───────────────────────────────┐
│ 💬 Chat                    ✓  │  ← Current app indicated
│ 📊 GTM Assessment             │
│ 📝 Sales Narrative            │
│ 🎯 Discovery Questions        │
│ 📋 First Call Checklist       │
│ 👤 Ideal Customer Profile     │
│ 📚 Sales Playbook             │
└───────────────────────────────┘
```

### When in Sales Narrative App
```
┌─────────────────────────────────┐
│  [Mikey Logo]                   │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 📝 Sales Narrative    ▼   │  │  ← Shows current app
│  └───────────────────────────┘  │
│                                 │
│  [        + New Chat         ]  │  ← Still available!
│                                 │
│  [     Edit Narrative        ]  │  ← App-specific primary action
│                                 │
│  ─── VERSIONS ───               │  ← App-specific content
│  • v3 - Feb 21, 2026            │
│  • v2 - Feb 14, 2026            │
│                                 │
└─────────────────────────────────┘
```

### Design Principles
1. **Clear context** - Dropdown always shows which app you're in
2. **Easy switching** - One click to see all apps, one more to switch
3. **Chat always accessible** - "+ New Chat" stays prominent regardless of app
4. **Scalable** - Works for 3 apps or 10 apps
5. **Minimal UI change** - Adds one element, sidebar content adapts per app

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

## Questions (8 Total)

| # | Category | Question | Help Text |
|---|----------|----------|-----------|
| 1 | Problem | What is the problem? | |
| 2 | Problem | Who has the problem? | Break out on a per-organizational persona (org type), and per human persona (human type) within those organizational personas. |
| 3 | Problem | What are the costs associated with the problem? | |
| 4 | Problem | How do people currently solve this problem, and how do those solutions fall down? | Break out on a per-organizational persona, and per human persona within those organizational personas. |
| 5 | Solution | What has changed enabling a new solution? | |
| 6 | Solution | How does the new solution work? | |
| 7 | Proof | How do you know it's better? (Quantitative, Qualitative) | |
| 8 | Business | What does it cost? How is it paid? | |

## Narrative Format Examples

The generated sales narrative should be a flowing prose document (not bullet points) that weaves the answers into a cohesive, persuasive story with specific metrics and proof points.

### Example 1: TalentBin Narrative

> **What's the problem?** Technical recruiting is really hard! Finding software-engineering talent that has the skills that your organization requires, and then engaging with them to get them to consider your organization, is a tough problem.
>
> **Who has the problem? What's the cost of not solving the problem?** It's something that makes the lives of technical sourcers, recruiters, and recruiting managers rough, particularly because if they don't solve the problem, they may have to pay large sums of money to recruiting agencies—25% of a first-year salary of $125,000 or more. Otherwise they don't hire on schedule, and that impacts the ability of their organizations to ship software on time, and make revenue!
>
> **How is this currently solved? Why doesn't that work?** Yes, you can use things like job boards or LinkedIn, but the problem is that unemployment is so low in software engineering that very few engineers are actively looking for jobs. And because most people don't really pay attention to LinkedIn or update their profiles, software-engineering profiles have a tendency not to exist, or to be missing the skill information that indicates that the engineer in question would be a good fit. Not to mention the fact that there are hundreds of thousands of recruiters on LinkedIn messaging every engineer they can find, and that creates tons of noise to cut through.
>
> **What has changed?** But the good news is, the Internet has undergone some amazing changes of late to help make finding and engaging with these potential hires much easier and more effective. Because people are spending so much more time online, day in and out, on social sites like Twitter, Facebook, and Meetup and professional networks like GitHub and Stack Overflow—and because of the general move toward the digitization of work materials—there are reams and reams of information available. If properly leveraged, that material can help recruiters find talented individuals based on the activity they engage in online—for instance, tweeting about iOS development, being a member of an Android Meetup, participating in email lists about Java, and so on. **(How does it work?)** TalentBin scoops up all the information that individuals leave as digital fingerprints of their professional selves, analyzes it, and turns it into profiles for these individuals, with skill details and contact information. Then we let recruiters search and review the profiles and reach out to folks.
>
> **How do you know it's better?** Because TalentBin makes use of these mountains of "implicit" professional activity, it solves the problem of finding individuals who are not searching for jobs, not present in job board resume databases, and undiscoverable on LinkedIn due to their thin profiles. For instance, for a typical search like "Ruby on Rails" in the San Francisco Bay Area, TalentBin returns 5x the number of results compared to LinkedIn Recruiter. Moreover, 60% of these profiles have personal email addresses, which are so, so much better for engaging candidates. Recruiter open, click, and response rates using TalentBin provided personal email addresses are 3x-5x better than generic InMail outreach. And while the raw statistics tell the story, the hundreds of customers TalentBin has amassed—who have hired thousands of technical staff with the solution—tell the story even better. Not to mention the awards, press, and analyst accolades TalentBin has won since entering the market.
>
> And all of this is available to you for **$6,000 per user, per year**. That includes unlimited requisitions, searches, and profile views, and unlimited email sends. Compare this to $8,000 for a LinkedIn Recruiter account with inferior technical candidate search recall, capped at a hundred InMails a month. It's a total steal!

### Example 2: Salesforce Narrative

> **What is the problem? Who has it?** Being a B2B sales rep is tough! You have to manage dozens of concurrent conversations, follow up at the right time, and not drop any balls. So too with being a sales manager. You have to make sure that your team is engaging in high activity—but also the right activity—and keep track of potential issues, while forecasting how your revenue achievement will end up for the quarter.
>
> **What is the cost of the issue?** And this is serious business. If a rep drops a ball, forgetting to follow up with a prospect at the right time or neglecting to send a proposal as promised, it can mean tens or hundreds of thousands of dollars of lost revenue. Moreover, from an efficiency standpoint, if reps aren't sufficiently productive, they're missing out on potential deals and conversations. And for sales managers, not being able to manage the activity levels of staff, identify weaknesses, and forecast accurately could mean leaving problems unaddressed, which can turn into hundreds of thousands of dollars of short fallen targets. And that could mean missed quarters and stock impacts. It's no joke.
>
> **How is this currently solved?** For how important customer-relationship tracking and management is, it's amazing how poorly it's generally done. You have reps either living out of their email and calendars or using ancient, clunky contact managers like Act! or GoldMine, or last-generation CRMs made by Siebel that look like something out of Tron.
>
> **Why don't current solutions work?** The problem with these approaches is that email and calendars are not designed for tracking customer relationships, and make it more likely for very costly balls to be dropped. Last-generation CRM systems require reps to be in front of their computers, dialed into a VPN. And even if they are, those systems are extremely clunky and hard to use—creating more time and bookkeeping overhead rather than actually enabling reps to sell more, faster.
>
> **What has changed?** However, with the rise of the Internet, now the power of modern, usable, always-accessible CRM can be available to reps wherever they are, whenever.
>
> **How does it work?** Salesforce provides a modern, next-generation CRM that is accessed through the browser, connecting reps to their important deal information quickly and easily. And because it's software delivered as a service, the latest and greatest innovations in rep-efficiency features are available to all users, all at once, rather than requiring IT to upgrade the on-premise CRM system. And because web technologies make for easy interoperability, Salesforce has a massive partner ecosystem of amazing add-on tools that offer all manner of efficiency benefits.
>
> **How do you know it's better?** Because the software is available to reps wherever and whenever via a browser, and is much more usable, you get reps who are logging in and updating opportunities and pipelines as much as 3x–10x as often as on traditional systems. That not only reduces the potential for dropped balls—as you can see by the 20%–50% increase in win rates for reps who adopt Salesforce—but also makes for more accurate forecasts on a rep and sales manager basis. We've seen a 30%–50% reduction in missed forecasts for managers whose teams use Salesforce. All of which has resulted in Salesforce being the most lauded CRM solution on the market, consistently in Gartner's Magic Quadrant for CRM, and gaining tens of thousands of customers.

## Chatbase Prompt (Generation)

```
You are helping a founder create their sales narrative following the Founding Sales methodology by Pete Kazanjy.

Based on the questionnaire answers below, generate a compelling sales narrative and product descriptions.

## FORMAT REQUIREMENTS

1. **SALES NARRATIVE** - A flowing prose document (NOT bullet points) that weaves the answers into a cohesive, persuasive story. Follow this structure:
   - Open with the problem (make it visceral and relatable)
   - Identify who has the problem and the specific personas affected
   - Quantify the costs of not solving the problem (dollars, time, opportunity cost)
   - Describe how people currently solve it and why those solutions fall short
   - Explain what has changed that enables a new solution
   - Describe how your solution works
   - Provide proof it's better (specific metrics, customer results, social proof)
   - End with pricing positioned as compelling value vs. alternatives

   Use an engaging, conversational tone with urgency around the problem. Include specific numbers and metrics throughout.

2. **100-WORD DESCRIPTION** - A product marketing summary suitable for a website or pitch deck. Covers problem, solution, and key differentiator.

3. **50-WORD DESCRIPTION** - An elevator pitch that can be spoken in ~20 seconds. Problem + solution + why it's better.

4. **25-WORD DESCRIPTION** - A tagline or one-liner that captures the essence.

## QUESTIONNAIRE ANSWERS:

[CHUNKED ANSWERS HERE]

---

Respond in this exact JSON format:
{
  "narrative": "The full sales narrative as flowing prose...",
  "description100w": "The 100-word description...",
  "description50w": "The 50-word description...",
  "description25w": "The 25-word tagline..."
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

---

# Visual/Image Attachments - Design Plan

## Overview

Allow users to attach images to chat messages (both via web UI and Slack). Since Chatbase is not multimodal, images are processed through a vision AI to extract text descriptions, which are then injected into the Chatbase prompt.

## Processing Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Image Input   │────▶│  Vision API     │────▶│   Text Output   │
│  (Web or Slack) │     │  (GPT-4o/Claude)│     │   + User Msg    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                                ┌─────────────────┐
                                                │    Chatbase     │
                                                │   (text only)   │
                                                └─────────────────┘
```

## Design Decisions

### Vision API Provider Options

| Provider | Model | Pros | Cons |
|----------|-------|------|------|
| **OpenAI** | GPT-4o / GPT-4 Vision | Battle-tested, great at structured extraction | Cost (~$0.01-0.03 per image) |
| **Anthropic** | Claude 3.5 Sonnet | Excellent reasoning | Similar cost |
| **Google** | Gemini Pro Vision | Cheaper, good quality | Less proven |

### Image Storage Strategy

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **In-memory only** | Process and discard | Simple, no storage cost | Can't re-process |
| **Temporary (24h)** | Store briefly, auto-delete | Allows re-processing | Some storage overhead |
| **Permanent** | Store in Supabase Storage/S3 | Full history | More complexity, storage costs |

**Recommendation:** Start with in-memory processing, add temporary storage later if needed.

### Extraction Prompt Strategy

- **Generic:** "Describe this image in detail"
- **Sales-context aware:** "Extract sales-relevant information: product screenshots, competitive materials, org charts, meeting notes, etc."
- **User-guided:** Let user add a note like "This is our competitor's pricing page"

**Recommendation:** Sales-context aware by default, with optional user note.

## Proposed API

```typescript
// POST /api/vision/extract
Request: {
  image: string;        // base64 or URL
  context?: string;     // user hint: "competitor pricing page"
  extractionType?: "general" | "sales" | "document";
}

Response: {
  description: string;  // Extracted text/description
  metadata: {
    type: "screenshot" | "document" | "photo" | "chart";
    confidence: number;
  }
}
```

## Message Injection Format

When an image is processed, the description is prepended to the user's message:

```
[Image attached: The image shows a competitor's pricing page with three tiers: Starter ($29/mo), Pro ($99/mo), and Enterprise (custom). Key features listed include...]

{user's original message}
```

## Implementation Phases

### Phase 1: Vision API Integration
- [ ] Create `/api/vision/extract` endpoint
- [ ] Integrate with OpenAI GPT-4o Vision (or chosen provider)
- [ ] Define extraction prompts (generic + sales-focused)
- [ ] Handle base64 and URL inputs

### Phase 2: Web UI Upload
- [ ] Add file input to chat (📎 button or drag-drop)
- [ ] Show image preview before sending
- [ ] Display extraction status ("Analyzing image...")
- [ ] Inject description into message before sending to Chatbase

### Phase 3: Slack Integration
- [ ] Detect files[] in Slack events
- [ ] Download image from Slack's servers (requires auth)
- [ ] Process through vision extraction pipeline
- [ ] Include description in Chatbase context

### Phase 4: Storage & History (Optional)
- [ ] Add image storage (Supabase Storage or S3)
- [ ] Link images to conversations
- [ ] Show image thumbnails in conversation history

## Slack-Specific Considerations

When a user sends an image via Slack:
1. Slack provides a `url_private` for the file
2. Need to fetch with Slack bot token: `Authorization: Bearer xoxb-...`
3. Image is downloaded server-side, sent to vision API
4. Description injected into the message before Chatbase call

## Cost Considerations

- GPT-4o Vision: ~$0.01-0.03 per image (depending on size/detail)
- Storage (if implemented): ~$0.02/GB/month (S3/Supabase)
- Consider rate limiting or usage caps per user

---

# Account Model — Multi-User Shared Context

## Problem

Today every GTM artifact (sales narrative, discovery questions, objection library, etc.) is scoped to a single `userId`. When multiple people at the same company use Mikey, each starts from scratch — there's no way to share the sales narrative one person built with their teammates. We need a shared boundary so that multiple users see and build on the same GTM context.

## Design Principles

1. **Account is the shared boundary.** Multiple Users belong to one Account. GTM artifacts are accessible at the Account level.
2. **Artifacts stay owned by the user who created them.** `userId` stays on every artifact. But when the system needs "the sales narrative," it queries for the most recent one from **any user on the same account**.
3. **Only GTM artifacts are shared.** The structured/generated content that defines the company's sales approach is account-scoped. User-authored items stay private per-user.
4. **Backwards compatible.** Users without an `accountId` (legacy solo users) continue to work exactly as before — queries fall back to `userId`-only scoping.

## What's Shared vs. Private

### Shared at Account Level (GTM Artifacts)
These are the structured, generated artifacts that define the company's GTM strategy. Anyone on the account can see the latest version from any team member:
- Sales Narrative & Messaging (SalesNarrativeVersion)
- GTM Maturity Assessment (MaturityAssessment)
- Discovery Questions (DiscoveryQuestionsVersion)
- First Call Checklist (FirstCallChecklistVersion)
- Email Sequence (EmailSequenceVersion)
- LinkedIn Sequence (LinkedInSequenceVersion)
- Cold Call Script (ColdCallScriptVersion)
- Sales Deck (SalesDeckVersion)
- Objection Library (ObjectionEntry)
- Ad Creator (AdCreatorVersion)
- GtmVariables (merge fields)

### Private per-User (NOT shared)
These are user-authored, user-specific items. They stay scoped to the individual:
- **Chat conversations** — private coaching sessions
- **Call Reviews** — individual's recorded call analysis
- **Pre-Call Research** — user's specific prospect research
- **Pre-Call Planning** — user's specific call prep
- **Coaching Sessions** — individual coaching interactions
- **Sales Metrics** — individual's pipeline/activity data
- **User Files** — uploaded documents
- **Saved Prompts** — personal prompt shortcuts

### Context Injection into Chat
When a user chats with Mikey, the context injection (attachments, merge variables) pulls from **account-scoped** GTM artifacts — so User B's chat benefits from the sales narrative User A built. But the chat conversation itself is private to User B.

## Data Model

### New: `Account` model

```prisma
model Account {
  id          String   @id @default(cuid())
  name        String   // Company/team name (e.g., "Acme Corp")

  // Email domain used for auto-grouping (e.g., "acme.com")
  emailDomain String?  @unique

  users       User[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("accounts")
}
```

### Modified: `User` model

```prisma
model User {
  // ... existing fields ...

  // Account membership (null for legacy solo users)
  accountId   String?
  account     Account? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  // Role within the account
  accountRole AccountRole @default(MEMBER)

  // ... rest of existing fields ...
}

enum AccountRole {
  OWNER    // Created the account, can manage members + billing
  ADMIN    // Can invite/remove members, edit all artifacts
  MEMBER   // Can create artifacts, view all account artifacts
}
```

### No changes to artifact models

`SalesNarrativeVersion`, `DiscoveryQuestionsVersion`, `GtmVariable`, `ObjectionEntry`, etc. all keep their existing `userId` FK. No new columns needed on artifact tables.

## Query Pattern: "Latest for my Account"

The key change is how we resolve "give me the latest sales narrative." Today:

```typescript
// Current: per-user only
const latest = await prisma.salesNarrativeVersion.findFirst({
  where: { userId: currentUser.id },
  orderBy: { createdAt: 'desc' },
});
```

New pattern:

```typescript
// New: account-scoped with user fallback
async function getLatestForAccount<T>(
  model: PrismaModel,
  userId: string,
  accountId: string | null,
  orderBy = { createdAt: 'desc' as const }
): Promise<T | null> {
  if (accountId) {
    // Find latest from ANY user on this account
    const accountUserIds = await prisma.user.findMany({
      where: { accountId },
      select: { id: true },
    });
    return model.findFirst({
      where: { userId: { in: accountUserIds.map(u => u.id) } },
      orderBy,
    });
  }
  // Fallback: solo user, query by userId only
  return model.findFirst({ where: { userId }, orderBy });
}
```

This helper gets used everywhere we currently do `findFirst({ where: { userId } })` for artifacts.

### Optimization: Cache account user IDs

Since account membership changes rarely, cache the `accountUserIds` array per-request (or in a short TTL cache) to avoid N+1 queries.

## What Changes per Layer

### API Routes (artifact queries)
Every route that fetches "latest" or "list" of artifacts needs to use the account-scoped query:
- `/api/sales-narrative/latest`
- `/api/discovery-questions/latest`
- `/api/first-call-checklist/latest`
- `/api/email-sequence/latest`
- `/api/linkedin-sequence/latest`
- `/api/cold-call-script/latest`
- `/api/objection-library/entries`
- `/api/attachments/content` (context injection into chat)
- All "history" endpoints — show all versions from anyone on the account
- `GtmVariable` lookups (merge fields) — resolve from account, not just user

### API Routes (writes stay per-user)
Create/update operations still use `userId` — the person who generates a new narrative owns it. No change needed.

### Chat Context Injection
When building the context brief for a chat message, resolve attachments and merge variables through the account. If User A built the sales narrative and User B asks Mikey a question with the Sales Narrative attachment, User B gets User A's narrative.

### SalesNavBar (status indicators)
Nav status checks ("has sales narrative?") should reflect account-level status, not just the current user. If anyone on the account has a narrative, show it as complete.

### New: Auto-Grouping by Email Domain
When a user signs up or logs in, extract the domain from their email (e.g., `jane@acme.com` → `acme.com`). If an Account already exists for that domain, auto-link the user to it. If not, create a new Account with that domain. First user on a domain becomes OWNER.

**Excluded domains:** Common free email providers (`gmail.com`, `yahoo.com`, `hotmail.com`, `outlook.com`, `icloud.com`, `aol.com`, `protonmail.com`, etc.) are excluded from auto-grouping — users with these domains stay solo unless manually invited to an account.

### New: Account Management UI
- **Account settings:** Company name, member list, roles.
- **Invite members:** By email (for edge cases where someone uses a different domain).
- **Member list:** Show who's on the account + their roles.
- **Leave account:** User can detach themselves from an account.

### New: Account API Routes
- `POST /api/account` — Create account
- `GET /api/account` — Get current user's account + members
- `POST /api/account/invite` — Invite by email
- `PATCH /api/account/members/[id]` — Change role
- `DELETE /api/account/members/[id]` — Remove member

## Migration Strategy

### Phase 1: Schema + backward compat
1. Add `Account` model to Prisma schema
2. Add `accountId` + `accountRole` to User (nullable)
3. Run migration — all existing users have `accountId = null` (solo mode)
4. Build the `getLatestForAccount` helper
5. No behavior change yet — null accountId means queries fall back to userId-only

### Phase 2: Account creation + auto-grouping by email domain
1. Build email domain extraction + auto-grouping logic (on signup/login)
2. Maintain excluded domains list (gmail.com, yahoo.com, etc.)
3. Backfill: group existing users by email domain into accounts
4. Build manual invite flow for edge cases (different domain teammates)

### Phase 3: Roll out account-scoped queries
1. Update artifact query routes to use `getLatestForAccount`
2. Update chat context injection
3. Update SalesNavBar status checks
4. Update merge variable resolution

### Phase 4: Account management UI
1. Settings page: account name, member list, roles
2. Invite by email
3. Transfer ownership

## Edge Cases

- **Solo user (no account):** Everything works exactly as today. `accountId` is null, all queries use `userId`.
- **User switches accounts:** Artifacts they created stay owned by them. If they leave, the account loses access to those artifacts (or: transfer ownership on leave — TBD).
- **Conflicting edits:** Two users edit the sales narrative simultaneously. Since each "edit" creates a new version, the latest version wins. No merge conflicts — just version history. UI could show "Updated by [name] 5 min ago."
- **Role permissions:** For Phase 1, all members can read + write all artifacts. Role-based restrictions (e.g., only OWNER/ADMIN can edit narrative) can come later.

## Files to Create
| File | Purpose |
|------|---------|
| `prisma/migrations/YYYYMMDD_add_account_model/migration.sql` | DB migration |
| `src/lib/account/get-latest-for-account.ts` | Shared account-scoped query helper |
| `src/app/api/account/route.ts` | Create + get account |
| `src/app/api/account/invite/route.ts` | Invite member by email |
| `src/app/api/account/members/[id]/route.ts` | Manage member roles |
| `src/app/settings/account/page.tsx` | Account management UI |

## Files to Modify
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add Account model, accountId + accountRole on User |
| Every `/api/*/latest/route.ts` | Use `getLatestForAccount` instead of userId-only query |
| Every `/api/*/history/route.ts` | Query by account user IDs |
| `src/lib/attachments/` | Resolve attachment content through account |
| `src/components/SalesNavBar.tsx` | Status checks use account scope |
| `src/app/api/chat/route.ts` (or equivalent) | Context injection resolves through account |
