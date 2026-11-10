# Mass Slack Tool — Implementation Plan

## Overview

An admin-only extension of the existing admin UI for posting to many Slack channels that MikeyBot is already installed into. Covers three modes:

1. **One-shot broadcast** — send the same message (or one of N permutations) to a filtered set of channels at once.
2. **Recurring campaigns** — scheduled cadences (e.g., Monday morning excitement check, Wednesday midweek, Friday wrap) with timing jitter and rotating message variants so it doesn't feel automated.
3. **Dormancy nudge** — "stay in touch" rule that posts to a channel that's gone silent for N days without admin intervention.

Channels are segmented by tags (Students, Lapsed, Paid, etc.) so every send picks its recipients via a tag filter rather than a hand-picked list.

---

## What This Builds On

| Existing piece | How we use it |
|---|---|
| `Workspace` model | Source of `botToken` for posting. Admin picks a workspace before composing. |
| `ChannelClaim` model | The set of channels we can post into. Already includes `slackChannelId` + `slackChannelName` + `workspaceId` + `accountId` + `claimedByUserId`. |
| `src/lib/slack/client.ts` | Reused verbatim for `chat.postMessage`. |
| Slack event handling | Already captures channel message activity for coaching threads — we tap the same stream to maintain `lastMessageAt` per channel for the dormancy rule. |
| `/admin` shell + nav | New tabs slot into `src/app/admin/layout.tsx` alongside Accounts / Users / Workspaces. |
| Vercel Cron pattern (proposed in deals-plan.md Phase 6) | Same cron host runs our scheduled-send worker. |

---

## Data Model

### ChannelTag

```
ChannelTag
├── id (cuid)
├── name (String) — "Students" | "Lapsed" | "Paid" | etc.
├── color (String?) — optional hex for admin UI badges
├── createdAt, updatedAt
```

### ChannelTagAssignment (many-to-many join)

```
ChannelTagAssignment
├── channelClaimId (FK → ChannelClaim)
├── tagId (FK → ChannelTag)
├── @@unique([channelClaimId, tagId])
```

### BroadcastCampaign

```
BroadcastCampaign
├── id (cuid)
├── name (String) — admin-facing label
├── workspaceId (FK → Workspace) — scope
├── channelFilter (JSON) — { mode: "tag" | "explicit", tagIds?: [], channelClaimIds?: [] }
├── status (String) — "draft" | "scheduled" | "sending" | "done" | "canceled"
├── scheduledFor (DateTime?, nullable) — null = send-now on save
├── variantSelection (String) — "random" | "round_robin" | "hash"
├── createdByAdminId (FK → User)
├── createdAt, startedAt, completedAt
```

### MessageVariant

```
MessageVariant
├── id (cuid)
├── campaignId (FK → BroadcastCampaign, nullable — null when library-scoped later)
├── body (String, text) — markdown with merge fields like {{channelName}}
├── order (Int) — display order in composer
├── createdAt
```

Inline-per-campaign to start. Promote to a reusable library (`VariantTemplate` standalone) only if we find ourselves copy-pasting across campaigns.

### BroadcastDelivery

```
BroadcastDelivery
├── id (cuid)
├── campaignId (FK → BroadcastCampaign)
├── channelClaimId (FK → ChannelClaim)
├── chosenVariantId (FK → MessageVariant)
├── renderedBody (String, text) — merge fields resolved; what was actually sent
├── status (String) — "pending" | "sent" | "failed" | "suppressed"
├── slackMessageTs (String?, nullable) — for future updates/deletes
├── error (String?, nullable)
├── sentAt (DateTime?)
├── @@unique([campaignId, channelClaimId])
```

The unique constraint is the idempotency key — worker retries can't double-post to the same channel in the same campaign.

### RecurringCampaign

```
RecurringCampaign
├── id (cuid)
├── name (String)
├── workspaceId (FK → Workspace)
├── channelFilter (JSON)
├── variantSelection (String) — default "hash" for recurring (same channel → same voice)
├── cron (String) — e.g., "0 9 * * 1" for Mondays at 9am
├── jitterMinutes (Int) — ± offset per channel
├── timezone (String) — IANA, e.g., "America/Los_Angeles"
├── variantIds (String[]) — pointers into MessageVariant pool (campaignId=null, owned by this recurring)
├── paused (Bool, default false) — kill switch
├── lastRenderedAt (DateTime?) — dedup so a cron tick that fires twice doesn't render twice
├── createdByAdminId (FK → User)
├── createdAt, updatedAt
```

Each cron tick that matches the schedule renders a one-shot `BroadcastCampaign` child from the recurring config, so delivery + audit use the same machinery.

### DormancyRule

```
DormancyRule
├── id (cuid)
├── name (String)
├── workspaceId (FK → Workspace)
├── channelFilter (JSON) — which tagged channels this rule watches
├── silentDaysThreshold (Int) — post when last activity is older than this
├── variantIds (String[]) — pool to rotate from
├── minDaysBetweenNudges (Int, default 14) — so the same channel doesn't get poked every tick
├── paused (Bool, default false)
├── createdByAdminId (FK → User)
├── createdAt, updatedAt
```

Plus on `ChannelClaim` (or a new small `ChannelActivity` table):

```
ChannelClaim
├── ... existing fields
├── lastMessageAt (DateTime?)   # fed by the existing Slack message event stream
├── lastNudgedAt (DateTime?)    # updated on DormancyRule send
```

---

## Key Design Decisions (with working answers)

**Channel filter shape** — tag-only at first, hybrid later. Every campaign filters by tag set; explicit channel-id override creeps in as a later "power user" affordance only if tag-based filtering feels too coarse. Avoids building two parallel selection UIs from day one.

**Variant distribution**:
- **Random** for one-shots.
- **Hash(channelId) → variant** for recurring, so a given channel always sees the same voice across weeks. Reads as more intentional.
- **Round-robin** available as an option but probably not the default.

**Jitter** — per-send random offset inside the jitter window, not bucketed. Feels organic. The worker caps concurrent sends per workspace at ~1/sec to keep Slack happy even if 100 channels all land in the same minute.

**Send host** — Vercel Cron fires a worker at some high frequency (5 min?); worker drains:
1. `BroadcastCampaign.scheduledFor <= now AND status = "scheduled"` — render + send.
2. `RecurringCampaign` whose cron+timezone+jitter window matches now — render a child `BroadcastCampaign`.
3. Channels matching a `DormancyRule` with `lastMessageAt < now - threshold AND (lastNudgedAt IS NULL OR lastNudgedAt < now - minDaysBetweenNudges)` — post from the pool, update `lastNudgedAt`.

Same `/api/cron/*` + `CRON_SECRET` pattern as deals-plan.md Phase 6.

**Timezone** — stored per recurring campaign and per dormancy rule. Rendered in the admin UI using that TZ. For "Monday morning" I lean the *channel owner's* TZ (from `claimedBy.timezone` if we store it) so a US East student doesn't get a 6am message because the admin is in LA. If we don't have the owner TZ, fall back to the workspace TZ, then UTC.

**Merge fields** — start with: `{{channelName}}`, `{{accountName}}`, `{{ownerFirstName}}`, `{{lastMessageDaysAgo}}`, `{{weekOfYear}}`, `{{dayOfWeek}}`. Renderer is a plain `{{ key }}` substitution; no conditionals in v1.

**Threading** — always post as a new top-level message. Reply-in-thread can come later; top-level makes the message surface properly.

---

## Posting as the user (Path A)

The product's whole frame is "founder-led sales" — messages that read as if they came from the founder. Posting as MikeyBot defeats that entirely (Slack renders the "APP" badge next to the bot name). We post via the admin's *user token* so the message is genuinely from them: their avatar, their name, no APP tag, lands in their own thread history. The cost is that every admin who wants to send must do a one-time Slack OAuth that grants user-scope.

### Mechanics

- **Two tokens, two scopes.** The existing install flow only requests bot scopes and stores `Workspace.botToken`. Send-as-user adds `user_scope=chat:write` to the install URL; on callback Slack returns `authed_user.access_token` (a `xoxp-` token). We persist that on the `User` row.
- **Send path uses the user token, not the bot token.** `runCampaign` looks up `createdByAdmin.slackUserToken` and uses *that* in the Slack client. The bot token stays the way to read channels / hear events; the user token is only ever used for outbound posting on behalf of that admin.
- **Hard fail when the user token is missing or revoked.** No silent fallback to the bot — if the admin hasn't connected their Slack as a user, the broadcast endpoint refuses at request time and the cron worker marks scheduled campaigns `status: "failed"` with `error: "user token unavailable"`. Falling back to the bot would be the failure mode we're trying to avoid.

### Schema additions

Two nullable columns on `User`:

```
slackUserToken  String?  // xoxp-… token from Slack OAuth (authed_user.access_token)
slackUserScopes String?  // comma-joined scopes granted (e.g., "chat:write")
```

Plain text at rest for now, matching how `Workspace.botToken` is stored. User tokens are higher-sensitivity than bot tokens (they impersonate a human) — a follow-up to encrypt both types together is filed but out of scope for this slice.

### OAuth changes

- `src/app/api/slack/oauth/route.ts` adds `user_scope=chat:write` alongside existing `BOT_SCOPES`.
- `src/app/api/slack/oauth/callback/route.ts` reads `tokenData.authed_user.access_token` and `.scope` and writes them onto the resolved `User` row at the end of its existing user-resolution flow.

### Re-auth UX

Every existing installation only granted bot-scope, so no User has a user token yet. Two options:
1. **Inline prompt in the composer.** When the admin opens compose without a user token, the modal shows "Connect Slack to send as yourself" with a button that kicks off the existing OAuth URL. Slack handles the diff smoothly — only asks for the new permission, not the entire scope list again. **Default.**
2. **Settings page banner.** Surface it once globally; some admins never open the composer.

Start with #1; add #2 later if discovery is a problem.

### Cron edge case

If Pete schedules a send for Monday and his user token is revoked between Friday and Monday, the cron drainer's first call into `runCampaign` will fail at the Slack API. Catch that failure at the campaign level: mark `status: "failed"`, set `error` on the campaign (or first delivery row), and surface it on the channels page so the admin can re-connect and re-create the send.

---

## Implementation Staging

### Milestone 1 — Tags + manual composer (shippable)

1. `ChannelTag` + `ChannelTagAssignment` models + migration.
2. `/admin/channels` tab:
   - Table of claimed channels with workspace, tags, `lastMessageAt` (null initially — can be null, shown as "—"), account, owner.
   - Inline tag editor (add/remove tags per row).
   - "Manage tags" modal to rename / recolor / delete tag definitions.
   - Filter by workspace, tag, text search.
3. "Compose" action on the channels tab:
   - Pick workspace (defaults to the one currently filtered).
   - Pick tags (or "all channels in workspace").
   - Paste a single message.
   - Preview: rendered text + the list of channels it will hit.
   - **Dry-run button** (just shows preview, no send).
   - **Send now** — creates a `BroadcastCampaign` with `status: "sending"` and one `MessageVariant`, synchronously sends via the worker's core send function.
4. Per-campaign detail page showing deliveries: sent/failed/suppressed, per-channel status, retry-failed button.

No scheduling, no variants, no recurring, no dormancy yet. Delivers the core "send one message to many channels" loop and the tag vocabulary.

### Milestone 1.5 — Send as the user (not as MikeyBot)

Foundational for the whole tool to be credible. Detail under "Posting as the user (Path A)" above. Net deltas:

1. `User.slackUserToken` + `User.slackUserScopes` (nullable strings) + migration.
2. `src/app/api/slack/oauth/route.ts`: add `user_scope=chat:write` to the authorize URL.
3. `src/app/api/slack/oauth/callback/route.ts`: persist `authed_user.access_token` + `.scope` on the resolved `User`.
4. `runCampaign` (`src/lib/broadcast/send.ts`): use `createdByAdmin.slackUserToken`; throw a typed error when it's missing.
5. POST `/api/admin/broadcast`: preflight check on the admin's user token before creating the campaign; refuse with a 412 + actionable error message when absent.
6. Cron `/api/cron/drain-broadcasts`: on the typed missing-token error, mark the campaign `failed` and continue (no retry — admin has to re-connect).
7. Composer UI: show "Will post as @{name}" badge above the message field when token is present; show a "Connect Slack to send as yourself" prompt with a link to `/api/slack/oauth` when absent. Disable the send button in the absent state.

### Milestone 2 — Variants + scheduled send

5. `BroadcastCampaign.scheduledFor` + `MessageVariant` with multiple-per-campaign support.
6. Composer grows to:
   - Add/remove variant slots (up to, say, 5).
   - Variant distribution picker (random / round-robin / hash).
   - "Schedule for later" time picker.
7. Vercel Cron tick that drains scheduled campaigns.
8. Kill switch in the campaign detail page → sets `status: "canceled"`, worker skips remaining deliveries.

### Milestone 3 — Recurring campaigns

9. `RecurringCampaign` model + admin UI (`/admin/channels/recurring`).
10. Cron-expression picker (preset helpers: Mon/Wed/Fri 9am, Weekly Monday, etc.).
11. Jitter + timezone controls.
12. Worker tick renders recurring → one-shot `BroadcastCampaign` + delivers.
13. Recurring detail page shows past renders (linked to child campaigns) + upcoming next-fire-at.

### Milestone 4 — Dormancy nudge

14. Feed `ChannelClaim.lastMessageAt` from the existing Slack event handler for every channel message (not just bot-tagged ones). Backfill once from the last 90 days of coaching-thread messages where that data already exists.
15. `DormancyRule` model + admin UI.
16. Worker tick evaluates rules, posts nudges, updates `lastNudgedAt`.
17. "Dormant channels" view on the Channels tab — channels sorted by `lastMessageAt ASC`, with a one-click "Nudge now" action that pulls from the matching rule's variant pool.

---

## Safety Rails (pre-committed, not afterthoughts)

- **Dry-run preview** on every composer action — shows exact channel list + rendered text per variant before any send.
- **Per-campaign kill switch** — `status: canceled` short-circuits the worker.
- **Suppression flag on `ChannelClaim.suppressBroadcasts`** — channel owners can opt out even if they match a tag. Worker filters these out at render time, marks delivery `status: "suppressed"`.
- **Rate limit per workspace** — worker caps concurrent sends at 1/sec per workspace to stay under Slack's posting limits.
- **Audit log** — every admin action that creates/mutates/sends a campaign gets an entry. Two-admin coordination becomes a real risk as this tool grows.
- **Idempotency** — `BroadcastDelivery.@@unique([campaignId, channelClaimId])` prevents worker retries from double-posting.
- **Quiet hours** — global (default 10pm–8am) in the channel owner's TZ. Worker defers sends that would fall in quiet hours to the start of the next active window.

---

## Open Questions

- **Variant library scope**: inline-per-campaign vs reusable `VariantTemplate` model. Start inline; refactor if admins copy-paste variants across campaigns.
- **Channel owner timezone source**: do we already collect `User.timezone` or `Account.timezone`? If not, we need a backfill strategy (ask the owner on first campaign that targets their channel, or infer from Slack profile).
- **Recurring + holidays**: should "every Monday 9am" skip observed US holidays? Probably not in v1, but worth a flag on `RecurringCampaign.skipHolidays` later.
- **Multi-admin coordination**: if two admins are both editing the same recurring campaign, last-write-wins or explicit locking? Probably last-write-wins + audit log for v1.
- **Unsubscribe signal**: should the bot listen for a reply like "stop" / "unsubscribe" in-channel and auto-flip `suppressBroadcasts: true`? Probably yes eventually — worth noting now so the dormancy rule doesn't keep nudging a channel that told us to back off.
- **Per-delivery personalization cost**: merge-field rendering is cheap. If we later want per-channel LLM-rewriting of a base variant ("rewrite this in the voice of a coach talking to lapsed students"), that's a per-delivery model call — needs rate limiting and cost controls.

---

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Add ChannelTag, ChannelTagAssignment, BroadcastCampaign, MessageVariant, BroadcastDelivery, RecurringCampaign, DormancyRule; extend ChannelClaim with lastMessageAt + lastNudgedAt + suppressBroadcasts |
| `src/app/admin/channels/page.tsx` | Channels tab — list, tags, dormancy view, "Compose" CTA |
| `src/app/admin/channels/compose/page.tsx` | Composer for one-shot + scheduled broadcasts |
| `src/app/admin/channels/recurring/page.tsx` | Recurring campaigns CRUD |
| `src/app/admin/channels/dormancy/page.tsx` | Dormancy rules CRUD |
| `src/app/admin/channels/[campaignId]/page.tsx` | Campaign detail + delivery table + kill switch |
| `src/app/api/admin/broadcast/route.ts` | Create / update / cancel campaigns |
| `src/app/api/admin/tags/route.ts` | Tag CRUD + assignments |
| `src/app/api/cron/drain-broadcasts/route.ts` | Scheduled-send worker |
| `src/app/api/cron/render-recurring/route.ts` | Recurring-campaign renderer |
| `src/app/api/cron/dormancy-nudge/route.ts` | Dormancy-rule worker |
| `src/lib/slack/client.ts` | Existing poster — reused for all three workers |
| `src/lib/broadcast/render.ts` | Merge-field substitution + variant selection |
| `vercel.json` | Cron schedule for the three worker routes |
