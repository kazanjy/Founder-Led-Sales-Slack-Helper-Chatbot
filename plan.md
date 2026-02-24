# Adding Custom Domain to Vercel

## Domain: `mikeybot.io`

## Overview
Adding the custom domain requires updates to:
1. Vercel project settings
2. Environment variables
3. OAuth provider configurations (Google, Slack)
4. Stripe webhook endpoints

---

## Step 1: GoDaddy DNS Configuration

In GoDaddy DNS Management for `mikeybot.io`:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| **A** | `@` | `76.76.21.21` | 600 |
| **CNAME** | `www` | `cname.vercel-dns.com` | 600 |

Then in Vercel, add both domains and configure `www.mikeybot.io` to redirect to `mikeybot.io`.

---

## Step 2: Update Environment Variables

In Vercel Dashboard → Project → Settings → Environment Variables:

| Variable | New Value |
|----------|-----------|
| `NEXT_PUBLIC_APP_URL` | `https://mikeybot.io` |

---

## Step 3: Google OAuth Configuration

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Your OAuth Client:

### Authorized JavaScript Origins
Add:
```
https://mikeybot.io
```

### Authorized Redirect URIs
Add:
```
https://mikeybot.io/api/auth/google/callback
```

---

## Step 4: Slack App Configuration

In [Slack API Dashboard](https://api.slack.com/apps) → Your App:

### OAuth & Permissions → Redirect URLs
Add:
```
https://mikeybot.io/api/slack/oauth/callback
https://mikeybot.io/api/auth/slack/callback
```

### Event Subscriptions → Request URL
Update to:
```
https://mikeybot.io/api/slack/events
```

---

## Step 5: Stripe Configuration (if using)

In [Stripe Dashboard](https://dashboard.stripe.com/) → Developers → Webhooks:

1. Add new webhook endpoint: `https://mikeybot.io/api/stripe/webhook`
2. Select same events as existing webhook
3. Update `STRIPE_WEBHOOK_SECRET` env var with new signing secret

---

## Step 6: Testing Checklist

- [ ] `https://mikeybot.io` loads
- [ ] Google Sign In works
- [ ] Slack Sign In works
- [ ] Slack App Install works
- [ ] Slack messages get responses
- [ ] Share links use `mikeybot.io`
- [ ] Stripe checkout works (if applicable)

---

## Quick Reference - All URLs to Configure

```
# Environment Variable
NEXT_PUBLIC_APP_URL=https://mikeybot.io

# Google OAuth
https://mikeybot.io
https://mikeybot.io/api/auth/google/callback

# Slack OAuth
https://mikeybot.io/api/slack/oauth/callback
https://mikeybot.io/api/auth/slack/callback

# Slack Events
https://mikeybot.io/api/slack/events

# Stripe Webhook
https://mikeybot.io/api/stripe/webhook
```

---

## Multi-User Corporate Accounts

### Overview

Transform Mikey from single-user to multi-user with corporate accounts grouped by email domain. Users within the same company share context apps and can access each other's public chats.

---

### Requirements Summary

#### User Roles
| Role | Context Apps (Maturity, Narrative, etc.) | Chats | Account Admin |
|------|------------------------------------------|-------|---------------|
| **Admin** | Create, edit, regenerate | Full access to own | Manage users, set roles, billing |
| **User** | Read-only (edit actions ghosted: "Available to Admins") | Full access to own | No access |

- Impersonation inherits the impersonated user's capabilities
- User type (admin/user) is set via in-app account admin interface

#### Account & Domain Model
- Users auto-grouped by email domain on signup (Slack or Google auth)
- Personal domains excluded: gmail.com, outlook.com, yahoo.com, hotmail.com, icloud.com, me.com, aol.com, protonmail.com, live.com, msn.com
- Context apps (maturity assessment, sales narrative) are **per-account**, shared across all users
- First user from a domain becomes account admin

#### Chat Privacy & Sharing
- **Default**: Private (only creator sees it)
- **Public**: Visible to all account members, but **read-only** to non-owners
- Privacy can be set at chat creation or changed after
- **Clone**: Any user can clone a public chat to continue it themselves
- Authorship/owner shown in: chat sidebar, chat header, search results

#### Search
- Searches across: own chats + all public chats in account
- Results show author/owner attribution

#### Billing
- Subscription attaches to **account**, not individual user
- Seat-based pricing: **$99/mo** or **$828/year** per seat ("Mikey Pro")
- When seat limit reached: new signups blocked until seats added

---

### Open Questions (Need Decisions)

1. **Multiple admins?** Can there be multiple admins per account, or just one?
2. **Admin removal safety?** What happens if the only admin leaves or is removed?
3. **Proactive invites?** Can admins invite users proactively, or only auto-join on signup?
4. **User removal?** Can admins remove users? What happens to their private chats?
5. **Chat ownership transfer?** Can ownership of a chat be transferred to another user?
6. **Existing users migration?** What happens to current users? Become single-user account admins?
7. **Account naming?** Auto from domain (e.g., "embercopilot.ai") or admin sets company name?
8. **Free tier?** Is there a free tier for individuals, or paid from the start?

---

### Execution Plan

#### Phase 1: Data Model & Schema

**New Models:**
```prisma
model Account {
  id            String   @id @default(cuid())
  name          String?  // Company name (optional, can default to domain)
  domain        String   @unique  // e.g., "embercopilot.ai"

  // Billing
  stripeCustomerId     String?
  stripeSubscriptionId String?
  seatCount            Int      @default(1)

  users         User[]
  maturityAssessments MaturityAssessment[]
  salesNarratives     SalesNarrative[]

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("accounts")
}
```

**User Model Changes:**
```prisma
model User {
  // ... existing fields ...

  // Account membership
  accountId     String?
  account       Account?  @relation(fields: [accountId], references: [id])
  accountRole   AccountRole @default(USER)  // ADMIN or USER
}

enum AccountRole {
  ADMIN
  USER
}
```

**Conversation Model Changes:**
```prisma
model Conversation {
  // ... existing fields ...

  visibility    ChatVisibility @default(PRIVATE)
  ownerId       String  // Explicit owner (for attribution)
}

enum ChatVisibility {
  PRIVATE
  PUBLIC
}
```

**Tasks:**
- [ ] Create Account model
- [ ] Add accountId, accountRole to User
- [ ] Add visibility, ownerId to Conversation
- [ ] Move MaturityAssessment and SalesNarrative to account-level (add accountId)
- [ ] Create migration script for existing users (each becomes their own account admin)
- [ ] Add personal domain exclusion list constant

---

#### Phase 2: Authentication & Account Assignment

**On signup (Google or Slack auth):**
1. Extract domain from email
2. Check if domain is personal (skip account assignment)
3. Find or create Account for domain
4. If new account: user becomes ADMIN
5. If existing account: check seat availability, assign as USER

**Tasks:**
- [ ] Update Google OAuth callback to assign account
- [ ] Update Slack OAuth callback to assign account
- [ ] Update Slack auth callback to assign account
- [ ] Add seat limit enforcement
- [ ] Add domain extraction utility function
- [ ] Add personal domain check utility

---

#### Phase 3: Role-Based UI for Context Apps

**Affected pages:**
- `/maturity-assessment` - Quiz and results
- `/sales-narrative` - Narrative generation
- `/discovery-questions` - Discovery questions tool
- `/first-call-checklist` - First call checklist

**For non-admin users:**
- Hide "Regenerate", "Edit", "Create New" buttons
- Show ghosted buttons with tooltip: "Available to Admins"
- Results/outputs are read-only but fully viewable

**Tasks:**
- [ ] Create `useAccountRole()` hook to get current user's role
- [ ] Create `<AdminOnly>` wrapper component with tooltip for ghosted state
- [ ] Update maturity assessment page for role-based actions
- [ ] Update sales narrative page for role-based actions
- [ ] Update discovery questions page for role-based actions
- [ ] Update first call checklist page for role-based actions
- [ ] Add "Available to Admins" tooltip component

---

#### Phase 4: Chat Privacy & Sharing

**New UI elements:**
- Privacy toggle when starting new chat (default: Private)
- Privacy indicator in chat header
- "Make Public" / "Make Private" in chat settings/menu
- "Clone Chat" button for public chats viewed by non-owners
- Owner attribution badge in sidebar and header

**API changes:**
- Chat creation: accept visibility parameter
- Chat update: allow visibility change (owner only)
- Chat clone: create copy with new owner
- Chat list: filter by own + public in account

**Tasks:**
- [ ] Add visibility toggle to new chat UI
- [ ] Add privacy indicator to chat header
- [ ] Add "Clone Chat" functionality
- [ ] Update chat sidebar to show owner name/avatar
- [ ] Update chat header to show "By [Owner Name]" for public chats
- [ ] Update `/api/chat` routes for visibility
- [ ] Update chat list query to include account's public chats

---

#### Phase 5: Search Across Account

**Changes:**
- Search queries own conversations + public conversations in account
- Search results show owner attribution
- Filter options: "My Chats" / "Team Chats" / "All"

**Tasks:**
- [ ] Update search API to include account public chats
- [ ] Add owner attribution to search results UI
- [ ] Add filter dropdown for search scope

---

#### Phase 6: In-App Account Admin

**New route: `/account` or `/team`**

**For Account Admins:**
- View all users in account
- Change user roles (promote to admin, demote to user)
- Remove users from account
- View/edit account name
- Manage billing (link to Stripe portal)
- See seat usage (X of Y seats used)

**For Regular Users:**
- View team members (read-only)
- See account name
- Link to request admin access or more seats

**Tasks:**
- [ ] Create `/account` page with role-based views
- [ ] Create user list component with role badges
- [ ] Add role change functionality (admin only)
- [ ] Add user removal functionality (admin only)
- [ ] Add seat usage display
- [ ] Integrate Stripe billing portal link
- [ ] Add "Request Admin" flow for users

---

#### Phase 7: Billing Integration

**Changes to Stripe integration:**
- Subscription tied to Account, not User
- Seat-based checkout (quantity = seats)
- Webhook updates account seatCount
- Enforce seat limits on new user joins

**Tasks:**
- [ ] Update Stripe checkout to use account
- [ ] Update Stripe webhook to update account subscription
- [ ] Add seat quantity to checkout
- [ ] Add seat upgrade/downgrade flow
- [ ] Block signups when seats exhausted (with "Contact admin" message)

---

#### Phase 8: Migration & Rollout

**Migration script:**
1. For each existing user with non-personal email domain:
   - Create Account for their domain (if not exists)
   - Assign user to account as ADMIN (first user) or USER
2. For users with personal domains:
   - Create individual Account (single-user)
   - Assign as ADMIN of their own account
3. Migrate MaturityAssessment records to account-level
4. Migrate SalesNarrative records to account-level
5. Set all existing conversations to PRIVATE, set ownerId

**Tasks:**
- [ ] Write migration script
- [ ] Test migration on staging data
- [ ] Create rollback plan
- [ ] Execute migration
- [ ] Verify data integrity

---

### Implementation Order (Recommended)

1. **Phase 1** - Data model (foundation for everything)
2. **Phase 8** - Migration script (so existing users work)
3. **Phase 2** - Auth changes (new users get accounts)
4. **Phase 3** - Role-based context apps (immediate value)
5. **Phase 4** - Chat privacy (core sharing feature)
6. **Phase 6** - Account admin UI (self-service management)
7. **Phase 5** - Search (enhancement)
8. **Phase 7** - Billing (monetization)

---

## Future Work

### 1. Home Page Refactor - Maturity Assessment Focus ✅

Refactored the home page to heavily merchandise the GTM Maturity Assessment capabilities:

- [x] Hero section: "Discover Your GTM Blind Spots" with primary assessment CTA
- [x] Showcase sample assessment results/insights (mock recommendation card)
- [ ] Add testimonials or case studies around assessment value
- [x] Visual preview of the assessment experience (sample questions section)
- [x] Clear explanation of what users get (GTM Score, Priority Actions, Chat with Results)
- [x] Secondary CTAs for Slack integration and chat features
- [x] Assessment as primary onboarding funnel (startAssessment query param handling)
- [x] Updated StickyCtaBar to lead with "Take Free Assessment"
