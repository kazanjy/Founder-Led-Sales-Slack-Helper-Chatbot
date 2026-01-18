# Mikey - Founder-Led Sales Bot

## Overview

Mikey is a Slack bot that provides founder-led sales guidance via a Chatbase AI backend. Users interact with Mikey by @mentioning it in Slack channels, and conversations happen in threads to keep channels clean.

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Slack App     │────▶│  Vercel API     │────▶│    Chatbase     │
│  (Bot + OAuth)  │◀────│  (Node.js/TS)   │◀────│    Agent        │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                        ┌────────▼────────┐
                        │    Database     │
                        │  (PostgreSQL)   │
                        │  - Users        │
                        │  - Workspaces   │
                        │  - Licenses     │
                        │  - Chat History │
                        │  - Referrals    │
                        └─────────────────┘
                                 │
                        ┌────────▼────────┐
                        │  Web Dashboard  │
                        │  (Next.js)      │
                        │  - Chat History │
                        │  - Account Mgmt │
                        └─────────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js / TypeScript |
| Framework | Next.js (App Router) |
| Hosting | Vercel |
| Database | PostgreSQL (Vercel Postgres or Neon) |
| ORM | Prisma |
| Slack SDK | @slack/bolt |
| Payments | Stripe |
| Auth (Web) | Slack OAuth |

---

## Core Features

### 1. Slack Bot Interaction

**Invocation:**
- User @mentions `@Mikey` in any channel where the bot is installed
- Bot responds in a thread under the original message

**Threaded Conversations:**
- Initial @mention creates a new conversation thread
- Subsequent replies in that thread continue the conversation (no need to @mention again)
- Each thread = one conversation context sent to Chatbase

**Rich Formatting:**
- Markdown (bold, italic, strikethrough)
- Code blocks (inline and fenced)
- Bulleted and numbered lists
- Links
- Emojis
- Tables (using Slack's mrkdwn format)

**License Check Flow:**
```
User @mentions Mikey
        │
        ▼
┌───────────────────┐
│ Is user licensed? │
└────────┬──────────┘
         │
    ┌────┴────┐
    │         │
   Yes        No
    │         │
    ▼         ▼
 Process   ┌─────────────────────────────┐
 message   │ Has trial remaining?        │
           │ (days > 0 OR messages > 0)  │
           └──────────────┬──────────────┘
                    ┌─────┴─────┐
                   Yes          No
                    │           │
                    ▼           ▼
                Process    Send "not licensed"
                message    message with info
                (decrement
                trial counter)
```

**Unlicensed User Response:**
> "Hey! You need a license to ask Mikey questions directly. In the meantime, someone with a license can ask on your behalf. Want to get started? [Start Trial] or [Get Licensed]"

---

### 2. Licensing System

**License Types:**

| Type | Description |
|------|-------------|
| **Individual Seat** | Single user license, tied to Slack user ID |
| **Workspace Bundle** | Up to X seats for a workspace (admin allocates) |

**License States:**
- `trial` - Using trial allocation
- `active` - Fully licensed
- `expired` - License/trial expired
- `suspended` - Manually suspended

**Trial Configuration (per workspace or global defaults):**

```typescript
interface TrialConfig {
  trialDays: number;        // 0 = no time-based trial
  trialMessages: number;    // 0 = no message-based trial
  // User gets access until BOTH are exhausted
  // Set both to 0 for "license required immediately"
}
```

**Trial Behavior:**
- Trial starts on first @mention
- Days count down from first use
- Messages decrement per question asked
- Trial ends when: `(daysRemaining <= 0) AND (messagesRemaining <= 0)`
- Configurable at workspace level (inherits from global defaults)

---

### 3. Referral System

**Earning Messages:**
- Licensed or trial users can invite others
- When invitee signs up/installs → inviter earns bonus messages
- Configurable bonus amount (e.g., +10 messages per referral)

**Referral Tracking:**
```typescript
interface Referral {
  referrerUserId: string;
  referredUserId: string;
  referredAt: Date;
  bonusAwarded: number;
  status: 'pending' | 'completed';
}
```

**Referral Flow:**
1. User gets unique referral link/code
2. New user installs or joins via link
3. On first @mention, referral is credited
4. Referrer gets bonus messages added to their account

---

### 4. Onboarding Flow

**Slack App Installation:**
1. Admin clicks "Add to Slack" on marketing site
2. Slack OAuth flow → grants permissions
3. Workspace + installing user recorded in database
4. Bot sends welcome DM to installer:

> "Hey! I'm Mikey, your Founder-Led Sales assistant. Here's what I can help with:
>
> - Crafting cold outreach messages
> - Handling objections
> - Pricing strategy advice
> - Sales call preparation
> - Follow-up sequences
>
> **Get started:** Just @mention me in any channel with your question!
>
> **Your trial:** You have 14 days and 50 messages to try me out.
>
> [View Dashboard] [Invite Your Team]"

**First @mention (new user in existing workspace):**
1. User @mentions Mikey
2. System creates user record, starts trial
3. Mikey responds with brief intro + answer:

> "Welcome! I'm Mikey. I'll help you with founder-led sales. Here's your answer:
>
> [Answer to their question]
>
> (You have 49 trial messages remaining)"

---

### 5. Web Dashboard

**Authentication:**
- "Sign in with Slack" (OAuth)
- Links Slack identity to web session
- No separate username/password needed

**User Dashboard:**

```
┌─────────────────────────────────────────────────────────┐
│  Mikey Dashboard                    [User ▼] [Sign Out] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  License Status: Trial (12 days, 34 messages left)      │
│  [Upgrade to Full License]                              │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  📜 Chat History                                        │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Jan 15 - "How do I handle pricing objections?"    │  │
│  │ #sales-team • 8 messages                          │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Jan 14 - "Cold email template for SaaS founders"  │  │
│  │ #general • 5 messages                             │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  🎁 Referrals                                           │
│  Share your link: https://mikey.app/r/abc123            │
│  Earn 10 bonus messages for each person who signs up!   │
│                                                         │
│  Referrals: 3 completed • 30 messages earned            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Workspace Admin Dashboard (additional features):**

```
┌─────────────────────────────────────────────────────────┐
│  Workspace Admin                                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Workspace: Acme Corp                                   │
│  Plan: Team (25 seats) • 18 active users                │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  👥 Licensed Users                                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ @john.doe    │ Active  │ 142 msgs │ [Revoke]   │    │
│  │ @jane.smith  │ Active  │ 89 msgs  │ [Revoke]   │    │
│  │ @bob.wilson  │ Trial   │ 23 left  │ [License]  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  [+ Add User] [Manage Billing]                          │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  ⚙️ Trial Settings (for new users in your workspace)    │
│                                                         │
│  Trial Days:     [14    ] (0 = no time trial)           │
│  Trial Messages: [50    ] (0 = no message trial)        │
│                                                         │
│  [Save Settings]                                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### 6. Payments (Stripe Integration)

**Products/Plans:**

| Plan | Price | Included |
|------|-------|----------|
| Individual | $X/month | 1 seat, unlimited messages |
| Team | $Y/month | Up to 10 seats |
| Business | $Z/month | Up to 50 seats |
| Enterprise | Custom | Unlimited seats, priority support |

**Self-Service Flow:**
1. User clicks "Upgrade" in Slack DM or web dashboard
2. Redirected to Stripe Checkout
3. On success, webhook updates license status
4. User notified via Slack DM

**Manual/Invoice Flow:**
1. Admin creates license manually in admin panel
2. Sets user/workspace, seat count, expiration
3. Can attach notes (PO number, invoice ID, etc.)
4. No Stripe interaction required

**Stripe Webhook Events:**
- `checkout.session.completed` → Activate license
- `invoice.paid` → Extend license
- `invoice.payment_failed` → Notify, grace period
- `customer.subscription.deleted` → Expire license

---

### 7. Admin Panel (Internal)

**For you to manage the system:**

```
┌─────────────────────────────────────────────────────────┐
│  Mikey Admin Panel                                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [Workspaces] [Users] [Licenses] [Settings] [Analytics] │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  📊 Quick Stats                                         │
│  Workspaces: 47 | Users: 312 | Messages Today: 1,429   │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  🔧 Manual License Grant                                │
│                                                         │
│  Workspace: [Select or search...          ▼]            │
│  User:      [Select or search...          ▼]            │
│  Type:      [● Individual  ○ Workspace Bundle]          │
│  Seats:     [1       ] (for bundles)                    │
│  Expires:   [2025-12-31] or [Never ☑]                   │
│  Notes:     [Invoice #1234                    ]         │
│                                                         │
│  [Grant License]                                        │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  ⚙️ Global Defaults                                     │
│                                                         │
│  Default Trial Days:     [14]                           │
│  Default Trial Messages: [50]                           │
│  Referral Bonus:         [10] messages                  │
│                                                         │
│  [Save Defaults]                                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Data Models

### Core Entities

```typescript
// Workspace (Slack workspace)
interface Workspace {
  id: string;
  slackTeamId: string;
  slackTeamName: string;
  installedAt: Date;
  installedByUserId: string;

  // Trial config (null = use global defaults)
  trialDays: number | null;
  trialMessages: number | null;

  // Workspace-level license (optional)
  workspaceLicenseId: string | null;
}

// User
interface User {
  id: string;
  slackUserId: string;
  slackUserName: string;
  workspaceId: string;

  // Trial tracking
  trialStartedAt: Date | null;
  trialMessagesRemaining: number;

  // License
  licenseStatus: 'trial' | 'active' | 'expired' | 'suspended';
  licenseId: string | null;

  // Referral
  referralCode: string;
  referredByUserId: string | null;
  bonusMessagesEarned: number;

  createdAt: Date;
}

// License
interface License {
  id: string;
  type: 'individual' | 'workspace_bundle';

  // For individual
  userId: string | null;

  // For workspace bundle
  workspaceId: string | null;
  seatLimit: number | null;
  seatsUsed: number;

  // Billing
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;

  // Manual override
  manuallyGranted: boolean;
  grantedByAdminId: string | null;
  notes: string | null;

  status: 'active' | 'expired' | 'cancelled' | 'suspended';
  expiresAt: Date | null; // null = never expires

  createdAt: Date;
}

// Conversation (one Slack thread)
interface Conversation {
  id: string;
  userId: string;
  workspaceId: string;

  slackChannelId: string;
  slackThreadTs: string; // Thread timestamp = unique ID

  // For Chatbase context
  chatbaseConversationId: string;

  firstMessagePreview: string; // First ~100 chars
  messageCount: number;

  createdAt: Date;
  lastMessageAt: Date;
}

// Message (individual message in conversation)
interface Message {
  id: string;
  conversationId: string;

  role: 'user' | 'assistant';
  content: string;

  // Slack reference
  slackMessageTs: string;

  createdAt: Date;
}

// Referral
interface Referral {
  id: string;
  referrerUserId: string;
  referredUserId: string;

  bonusAwarded: number;
  status: 'pending' | 'completed';

  completedAt: Date | null;
  createdAt: Date;
}
```

---

## API Routes

### Slack Endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/slack/events` | Slack Events API (messages, app mentions) |
| `POST /api/slack/interactions` | Button clicks, modal submissions |
| `GET /api/slack/oauth` | OAuth callback for app installation |
| `GET /api/slack/oauth/callback` | Complete OAuth flow |

### Web Dashboard API

| Route | Purpose |
|-------|---------|
| `GET /api/auth/slack` | Initiate Slack OAuth for web login |
| `GET /api/auth/slack/callback` | Complete web auth |
| `GET /api/user/me` | Get current user profile + license status |
| `GET /api/conversations` | List user's conversations |
| `GET /api/conversations/:id` | Get conversation with messages |
| `GET /api/referrals` | Get user's referral stats |

### Payment Endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/stripe/create-checkout` | Create Stripe checkout session |
| `POST /api/stripe/webhook` | Handle Stripe webhooks |
| `GET /api/stripe/portal` | Get Stripe customer portal URL |

### Admin API

| Route | Purpose |
|-------|---------|
| `GET /api/admin/workspaces` | List all workspaces |
| `GET /api/admin/users` | List/search users |
| `POST /api/admin/licenses` | Create manual license |
| `PATCH /api/admin/licenses/:id` | Update license |
| `GET /api/admin/analytics` | Usage statistics |
| `PATCH /api/admin/settings` | Update global defaults |

---

## Project Structure

```
/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Marketing landing page
│   ├── dashboard/
│   │   ├── page.tsx              # User dashboard
│   │   ├── conversations/
│   │   │   └── [id]/page.tsx     # Conversation detail
│   │   └── admin/
│   │       ├── page.tsx          # Admin overview
│   │       ├── workspaces/       # Workspace management
│   │       ├── users/            # User management
│   │       └── licenses/         # License management
│   ├── api/
│   │   ├── slack/
│   │   │   ├── events/route.ts   # Slack events webhook
│   │   │   ├── interactions/route.ts
│   │   │   └── oauth/route.ts
│   │   ├── auth/
│   │   │   └── slack/route.ts    # Web auth
│   │   ├── stripe/
│   │   │   ├── webhook/route.ts
│   │   │   └── checkout/route.ts
│   │   ├── user/route.ts
│   │   ├── conversations/route.ts
│   │   └── admin/
│   │       └── ...
│   └── layout.tsx
│
├── lib/
│   ├── slack/
│   │   ├── client.ts             # Slack Web API client
│   │   ├── events.ts             # Event handlers
│   │   ├── formatting.ts         # Markdown → Slack mrkdwn
│   │   └── messages.ts           # Message templates
│   ├── chatbase/
│   │   └── client.ts             # Chatbase API client
│   ├── licensing/
│   │   ├── check.ts              # License validation
│   │   ├── trial.ts              # Trial logic
│   │   └── referrals.ts          # Referral processing
│   ├── stripe/
│   │   ├── client.ts
│   │   └── webhooks.ts
│   └── db/
│       └── prisma.ts             # Prisma client
│
├── prisma/
│   └── schema.prisma             # Database schema
│
├── components/                   # React components
│   ├── ui/                       # Shared UI components
│   ├── dashboard/                # Dashboard components
│   └── admin/                    # Admin panel components
│
├── public/
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## Implementation Phases

### Phase 1: Core Bot Functionality
- [ ] Project setup (Next.js, Prisma, database)
- [ ] Slack app creation and OAuth flow
- [ ] Basic @mention handling
- [ ] Chatbase integration
- [ ] Threaded replies
- [ ] Rich text formatting

### Phase 2: Licensing & Trials
- [ ] User and workspace models
- [ ] Trial system (days + messages)
- [ ] License checking middleware
- [ ] Unlicensed user responses
- [ ] Manual license granting (admin)

### Phase 3: Web Dashboard
- [ ] Slack OAuth for web
- [ ] User dashboard UI
- [ ] Chat history display
- [ ] License status display

### Phase 4: Payments
- [ ] Stripe integration
- [ ] Checkout flow
- [ ] Webhook handling
- [ ] Customer portal

### Phase 5: Referrals & Growth
- [ ] Referral code generation
- [ ] Referral tracking
- [ ] Bonus message crediting
- [ ] Referral dashboard UI

### Phase 6: Admin Panel
- [ ] Admin authentication
- [ ] Workspace management
- [ ] User management
- [ ] Analytics dashboard
- [ ] Global settings

---

## Environment Variables

```bash
# App
NEXT_PUBLIC_APP_URL=https://mikey.app

# Database
DATABASE_URL=postgresql://...

# Slack
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=  # Per-workspace, stored in DB after OAuth

# Chatbase
CHATBASE_API_KEY=
CHATBASE_CHATBOT_ID=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Admin
ADMIN_SECRET=  # For admin panel access
```

---

## Open Questions / Decisions Needed

1. **Pricing**: What are the actual price points for Individual/Team/Business plans?

2. **Rate Limiting**: Should there be rate limits even for licensed users (e.g., max 100 messages/day)?

3. **Message Persistence**: How long to retain chat history? Forever? 90 days?

4. **Multi-workspace Users**: If a user is in multiple workspaces with Mikey, should licenses be separate per workspace?

5. **Chatbase Conversation Context**: How much history to send to Chatbase per request? Full thread? Last N messages?

6. **Bot Channels**: Should Mikey work in DMs as well as channels? Or channels only?

7. **Export**: Should users be able to export their chat history (PDF, CSV)?

---

## Next Steps

1. Review this plan and provide feedback
2. Finalize open questions
3. Create Slack app in Slack API dashboard
4. Set up Vercel project and database
5. Begin Phase 1 implementation
