# Mikey - Founder-Led Sales Bot

## Overview

Mikey is an AI-powered founder-led sales assistant. Users can access Mikey through:

1. **Web App** - Chat directly on the website, sign up with email
2. **Slack App** - @mention or DM Mikey in Slack

Users can start with either entry point and optionally connect the other later. All conversations sync across both interfaces.

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web App       │────▶│                 │────▶│                 │
│  (Chat + Auth)  │◀────│  Vercel API     │────▶│    Chatbase     │
└─────────────────┘     │  (Node.js/TS)   │◀────│    Agent        │
                        │                 │     └─────────────────┘
┌─────────────────┐     │                 │
│   Slack App     │────▶│                 │
│  (Bot + OAuth)  │◀────│                 │
└─────────────────┘     └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │    Database     │
                        │  (PostgreSQL)   │
                        │  - Accounts     │
                        │  - Users        │
                        │  - Workspaces   │
                        │  - Licenses     │
                        │  - Chat History │
                        │  - Referrals    │
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
| Auth (Web) | Email/password + OAuth (Slack, Google) |

---

## Core Features

### 0. Account Model & Entry Points

**Two Ways to Start:**

| Entry Point | Flow |
|-------------|------|
| **Web App** | Sign up with email → Start chatting → Optionally connect Slack later |
| **Slack App** | Install to workspace → Start chatting → Optionally access web dashboard |

**Account Structure:**

```
Account (billing entity)
├── Email/password login
├── Connected OAuth providers (Slack, Google)
├── License/subscription
├── Billing info
│
└── Users (one per Slack workspace connection)
    ├── Slack User in Workspace A
    ├── Slack User in Workspace B
    └── Web-only user (no Slack)
```

**Key Behaviors:**
- Account owns the license and billing
- Account can exist without Slack (web-only users)
- Account can connect to multiple Slack workspaces
- Each Slack workspace connection creates a "User" record
- Chat history syncs across web and Slack
- Conversations from web show in dashboard alongside Slack conversations

**Web Chat Interface:**
- Real-time chat UI (similar to ChatGPT/Claude)
- Same Chatbase backend as Slack
- Full conversation history
- No Slack required

**Connecting Slack Later:**
1. User signs up on web, starts using Mikey
2. Later clicks "Connect Slack" in settings
3. OAuth flow links their Slack identity to existing account
4. Future Slack messages tied to same account/license

**Linking Existing Slack User to Web Account:**
1. User starts via Slack install
2. Visits web, clicks "Sign in with Slack"
3. Account auto-created/linked from Slack identity
4. Can add email/password for direct web login

---

### 1. Slack Bot Interaction

**Invocation:**
- **In channels:** User @mentions `@Mikey` - bot responds in a thread under the original message
- **In DMs:** User messages Mikey directly (no @mention needed) - bot responds in the DM

**Rate Limiting:**
- 1,000 messages per user per day (configurable globally and per-workspace)
- Prevents abuse while being generous for normal use

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
 message   │ Is user in trial period?    │
           │ (< 7 days since first msg)  │
           └──────────────┬──────────────┘
                    ┌─────┴─────┐
                   Yes          No
                    │           │
                    ▼           ▼
                Process    Send trial ended
                message    message
                (+ welcome
                if first msg)
```

**First Message Response:**
> "Thanks for sending Mikey your first message! You've just started your trial - you have 7 days to ask Mikey as much as you'd like! Have fun!"

**Trial Ended Response:**
> "Your trial is all done! If you liked Mikey, go ahead and subscribe!"

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

**Trial Configuration:**

```typescript
const TRIAL_DAYS = 7;  // Unlimited messages for 7 days
```

**Trial Behavior (CURRENT IMPLEMENTATION):**
- Trial starts on first @mention
- 7 days of unlimited messages
- First message shows welcome: "Thanks for sending Mikey your first message! You've just started your trial - you have 7 days to ask Mikey as much as you'd like! Have fun!"
- Trial ends after 7 days
- Expired message: "Your trial is all done! If you liked Mikey, go ahead and subscribe!"

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

**Slack App Installation (CURRENT IMPLEMENTATION):**
1. Admin clicks "Add to Slack" on marketing site
2. Slack OAuth flow → grants permissions
3. Workspace + installing user recorded in database
4. Redirect to channel selection page
5. User selects channel for Mikey to join
6. Bot joins channel and posts welcome message:

> "Hey team! I'm Mikey, your Founder-Led Sales assistant. I'm here to help with sales strategies, outreach, objection handling, and more.
>
> To get started, just @mention me with your question - like this: @Mikey how do I handle pricing objections?
>
> You can also DM me directly if you prefer a private conversation.
>
> Here's to some founder-led selling success!"

**First @mention (new user in existing workspace):**
1. User @mentions Mikey
2. System creates user record, starts 7-day trial
3. Mikey responds with welcome + answer:

> "Thanks for sending Mikey your first message! You've just started your trial - you have 7 days to ask Mikey as much as you'd like! Have fun!"
>
> [Answer to their question]

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

**Pricing Model:**

| Billing | First Seat | Additional Seats | Discount |
|---------|------------|------------------|----------|
| Monthly | $99/month | $39/month each | - |
| Annual | $69/month ($828/yr) | $27/month ($324/yr) each | ~30% off |

*Pricing is configurable at both global default and per-user/account level.*

**Monthly Examples:**
- 1 user: $99/month
- 5 users: $99 + (4 × $39) = $255/month
- 10 users: $99 + (9 × $39) = $450/month

**Annual Examples (paid upfront):**
- 1 user: $828/year ($69/month effective)
- 5 users: $828 + (4 × $324) = $2,124/year ($177/month effective)
- 10 users: $828 + (9 × $324) = $3,744/year ($312/month effective)

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
// Account (top-level billing entity)
interface Account {
  id: string;

  // Auth - at least one required
  email: string | null;
  passwordHash: string | null;

  // Profile
  name: string | null;

  // Trial tracking (account-level)
  trialStartedAt: Date | null;
  trialMessagesRemaining: number;

  // License
  licenseStatus: 'trial' | 'active' | 'expired' | 'suspended';
  licenseId: string | null;

  // Rate limiting
  messagesToday: number;
  messageCountResetAt: Date;

  // Referral
  referralCode: string;
  referredByAccountId: string | null;
  bonusMessagesEarned: number;

  createdAt: Date;
  updatedAt: Date;
}

// OAuth Connection (Slack, Google, etc.)
interface OAuthConnection {
  id: string;
  accountId: string;

  provider: 'slack' | 'google';
  providerAccountId: string;  // Slack user ID or Google ID
  providerEmail: string | null;

  // Slack-specific
  slackTeamId: string | null;
  slackTeamName: string | null;

  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;

  createdAt: Date;
}

// Workspace (Slack workspace - for bot installation)
interface Workspace {
  id: string;
  slackTeamId: string;
  slackTeamName: string;
  installedAt: Date;
  installedByAccountId: string;

  // Bot token for this workspace
  botToken: string;
  botUserId: string | null;

  // Trial config overrides (null = use global defaults)
  trialDays: number | null;
  trialMessages: number | null;

  // Rate limiting override (null = use global default)
  dailyMessageLimit: number | null;
}

// License
interface License {
  id: string;
  accountId: string;  // Licenses belong to accounts

  // Billing interval
  billingInterval: 'monthly' | 'annual';

  // Seat management
  seatLimit: number;
  seatsUsed: number;

  // Pricing override (null = use global defaults)
  // Monthly: $99 first, $39 additional
  // Annual: $69 first, $27 additional (~30% off)
  priceFirstSeatCents: number | null;
  priceAdditionalSeatCents: number | null;

  // Billing
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;

  // Manual override
  manuallyGranted: boolean;
  grantedByAdminId: string | null;
  notes: string | null;

  status: 'active' | 'expired' | 'cancelled' | 'suspended';
  expiresAt: Date | null;

  createdAt: Date;
}

// Conversation (can be from web or Slack)
interface Conversation {
  id: string;
  accountId: string;

  // Source - either web or Slack
  source: 'web' | 'slack';

  // Slack-specific (null for web conversations)
  workspaceId: string | null;
  slackChannelId: string | null;
  slackThreadTs: string | null;

  // For Chatbase context
  chatbaseConversationId: string | null;

  title: string | null;  // Auto-generated or user-set
  firstMessagePreview: string | null;
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

  // Slack reference (null for web messages)
  slackMessageTs: string | null;

  createdAt: Date;
}

// Referral
interface Referral {
  id: string;
  referrerAccountId: string;
  referredAccountId: string;

  bonusAwarded: number;
  status: 'pending' | 'completed';

  completedAt: Date | null;
  createdAt: Date;
}

// Shared Conversation Link
interface SharedConversation {
  id: string;
  conversationId: string;
  createdByAccountId: string;

  shareCode: string;  // e.g., "abc123" for mikey.app/c/abc123

  // Optional protection
  passwordHash: string | null;
  expiresAt: Date | null;

  viewCount: number;

  createdAt: Date;
}

// Global Settings (single row)
interface GlobalSettings {
  id: string;

  // Default pricing - Monthly
  defaultMonthlyFirstSeatCents: number;       // 9900 = $99
  defaultMonthlyAdditionalSeatCents: number;  // 3900 = $39

  // Default pricing - Annual (per month, paid yearly)
  defaultAnnualFirstSeatCents: number;        // 6900 = $69
  defaultAnnualAdditionalSeatCents: number;   // 2700 = $27

  // Default trial
  defaultTrialDays: number;
  defaultTrialMessages: number;

  // Default rate limit
  defaultDailyMessageLimit: number;  // 1000

  // Referral
  referralBonusMessages: number;

  updatedAt: Date;
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

### Phase 1: Core Slack Bot *(DONE)*
- [x] Project setup (Next.js, Prisma, database)
- [x] Slack app OAuth flow
- [x] Basic @mention handling
- [x] Chatbase integration
- [x] Threaded replies
- [x] Rich text formatting (Slack mrkdwn)
- [x] DM support
- [x] App Home tab
- [x] Channel selection on install
- [x] Welcome message to channel

### Phase 2: Account System & Web Auth
- [ ] Account model (replaces user-centric model)
- [ ] Email/password signup and login
- [ ] OAuth connections (Slack, Google)
- [ ] Session management
- [ ] Link Slack identity to existing account

### Phase 3: Web Chat Interface
- [ ] Real-time chat UI
- [ ] Conversation management
- [ ] Chat history display
- [ ] Same Chatbase backend as Slack

### Phase 4: Licensing & Trials
- [x] Trial system (7-day unlimited)
- [x] License checking in event handlers
- [x] Unlicensed/expired user responses
- [x] First message welcome
- [ ] Account-level licensing (migrate from user-level)

### Phase 5: Payments
- [ ] Stripe integration
- [ ] Monthly vs Annual billing
- [ ] Checkout flow (self-service)
- [ ] Webhook handling
- [ ] Customer portal
- [ ] Manual license granting (admin)

### Phase 6: Referrals & Growth
- [ ] Referral code generation
- [ ] Referral tracking
- [ ] Bonus message crediting
- [ ] Referral dashboard UI

### Phase 7: Admin Panel
- [ ] Admin authentication
- [ ] Account management
- [ ] Workspace management
- [ ] Analytics dashboard
- [ ] Global settings (pricing, trials, etc.)

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

## Finalized Decisions

| Topic | Decision |
|-------|----------|
| **Entry Points** | Web app (email signup) OR Slack install - can connect both |
| **Trial** | 7 days unlimited messages (starts on first @mention) |
| **Pricing - Monthly** | $99/month first seat, $39/month each additional |
| **Pricing - Annual** | $69/month first seat, $27/month additional (~30% off, paid upfront) |
| **Pricing Config** | Configurable at global default and per-account level |
| **Rate Limiting** | 1,000 messages/day per account (configurable) - *not yet enforced* |
| **Chat History Retention** | Forever |
| **Multi-workspace** | Accounts can connect multiple Slack workspaces |
| **DMs** | Supported - users can DM Mikey directly or @mention in channels |
| **Thread Context** | Each thread = one Chatbase conversation (isolated from other threads) |
| **Export** | Download, copy to clipboard, shareable URLs |

---

## Export Features

Users can share and export their conversations:

- **Download** - Export as PDF, Markdown, or plain text
- **Copy to clipboard** - One-click copy of conversation
- **Shareable URL** - Generate a public link to share with others (e.g., `https://mikey.app/c/abc123`)
  - Optional: password protection
  - Optional: expiration date
  - Read-only view for recipients

---

### Phase 8: Future Features
- [ ] Sales call grading (user provides call link → read transcript → grade against rubric)
- [ ] Configurable trial length per workspace
- [ ] Analytics/usage tracking
- [ ] App Home enhancements

### Cleanup Tasks
- [ ] Remove debug console.log statements before production

---

## Next Steps

1. ~~Create Slack app in Slack API dashboard~~ ✓
2. ~~Set up Vercel project and database~~ ✓
3. ~~Begin Phase 1 implementation~~ ✓
4. **Current:** Phase 2 (Account system + Web auth) and Phase 3 (Web chat)
5. Then: Phase 5 (Payments) to start monetization
