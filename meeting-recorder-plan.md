# Meeting Recorder Integration — Implementation Plan

## Overview

Automatically ingest call data from users' call recording systems via API. Users connect their recording account (Gong, Fireflies, etc.) via OAuth, then see recent calls in the Call Recap Email and Call Review pages. Selecting a call fetches the transcript and summary to populate the form and run analysis.

---

## API Availability

| Platform | API | Auth | List Calls | Transcript | Summary | Rate Limits | Viability |
|----------|-----|------|-----------|------------|---------|-------------|-----------|
| **Granola** | REST (GA) | API key (`grn_*`) | Yes (`GET /notes`) | Yes (`/notes/{id}?include=transcript`) | Yes (AI summary included) | 5/sec sustained, 25 burst | **Starting here** — simple auth, speaker-attributed transcripts, Business plan required |
| **Fireflies** | GraphQL (GA) | API key only | Yes (`transcripts` query) | Yes | Yes (summary, action items) | 50/day (Free/Pro), 60/min (Biz+) | **Starting here** — requires Business plan ($19/seat/mo) |
| **Fathom** | REST (GA) | OAuth2 + API key | Yes (`/meetings`) | Yes (`/recordings/{id}/transcript`) | Yes (summary + action items) | 60/min/user | Future — free plan, full OAuth2, SDKs |
| **Gong** | REST v2 (GA) | OAuth2 | Yes (`/v2/calls`) | Yes (`/v2/calls/{id}/transcript`) | Yes (brief + highlights) | ~1000/hr | Future — mature, granular scopes, may require contract negotiation |
| **Read.ai** | REST (open beta) | API key (OAuth coming) | Yes | Yes | Yes | Undocumented | Future — worth watching |
| **Grain** | REST (beta) | Bearer token | Yes | Yes | Yes | Undocumented | Future — requires Business plan |
| **Chorus/ZoomInfo** | REST (limited) | API token | Yes | Unclear | Unclear | Varies | Not recommended — sparse docs, legacy API being deprecated |
| **Otter.ai** | Beta | API key | Likely | Likely | Unknown | Undocumented | Not viable — Enterprise only |

**Starting with: Granola + Fireflies** — both use API key auth (simple), GA APIs.
**Future: Fathom, Gong** — OAuth2 integrations for broader coverage.

---

## Data Model

### MeetingRecorderConnection

```
MeetingRecorderConnection
├── id (cuid)
├── userId (FK → User)
├── provider (String) — "gong" | "fireflies" | etc.
├── accessToken (String, encrypted) — provider API token
├── refreshToken (String?, encrypted) — for OAuth refresh
├── tokenExpiresAt (DateTime?, nullable)
├── providerAccountId (String?, nullable) — provider's user/account ID
├── connectedAt (DateTime)
├── lastSyncedAt (DateTime?, nullable)
├── status (String) — "active" | "expired" | "revoked"
├── createdAt, updatedAt
@@unique([userId, provider])
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/meeting-recorder/connect` | GET | Initiate OAuth — redirects to provider |
| `/api/meeting-recorder/callback` | GET | OAuth callback — exchanges code, stores tokens |
| `/api/meeting-recorder/connections` | GET | List user's connected providers |
| `/api/meeting-recorder/connections/[id]` | DELETE | Disconnect a provider |
| `/api/meeting-recorder/calls` | GET | Fetch recent calls from connected provider |
| `/api/meeting-recorder/calls/[callId]` | GET | Fetch transcript + summary for a specific call |

---

## OAuth Flow

**API Key providers (Granola, Fireflies):**
1. User clicks "Connect Granola" (or Fireflies)
2. Modal appears: "Paste your API key"
3. User pastes key (e.g., `grn_abc123`)
4. Server validates key by calling the provider's list endpoint
5. Stores encrypted key in `MeetingRecorderConnection`
6. Modal closes, recent calls appear

**OAuth providers (Fathom, Gong — future):**
1. User clicks "Connect Fathom" (or Gong)
2. Redirect to provider's OAuth consent page
3. Provider redirects back to `/api/meeting-recorder/callback?provider=fathom&code=xxx`
4. Server exchanges code for access/refresh tokens
5. Stores encrypted tokens in `MeetingRecorderConnection`
6. Redirects back to the originating page

---

## Provider Abstraction

```typescript
interface MeetingRecorderProvider {
  name: string;
  slug: string; // "gong" | "fireflies"
  icon: string;
  getAuthUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  refreshToken(refreshToken: string): Promise<TokenSet>;
  listCalls(accessToken: string, limit?: number): Promise<Call[]>;
  getCallDetail(accessToken: string, callId: string): Promise<CallDetail>;
}

interface Call {
  id: string;
  title: string;
  date: string;
  duration: number; // seconds
  participants: string[];
  callType?: string;
  providerUrl?: string; // link to call in provider's UI
}

interface CallDetail extends Call {
  transcript: string;
  summary: string;
  actionItems?: string[];
}
```

Each provider implements this interface. Adding a new provider = adding one file.

---

## UI: Meeting Recorder Section

Shows on both Call Recap (`/call-recap/new`) and Call Review (`/call-review`) pages.

### Not Connected State

```
┌──────────────────────────────────────────────┐
│  Meeting Recorder Integration                │
│                                              │
│  Connect your call recorder to automatically │
│  import transcripts and summaries.           │
│                                              │
│  [🔗 Connect Granola]  [🔗 Connect Fireflies]│
│                                              │
│  Or paste a share link below.                │
└──────────────────────────────────────────────┘
```

### Connected State

```
┌──────────────────────────────────────────────┐
│  Meeting Recorder    ✅ Gong · Disconnect    │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ Apr 6 · Discovery Call                 │  │
│  │ Visana x Ember · 32m · 3 people        │  │
│  │                          [Use This]    │  │
│  ├────────────────────────────────────────┤  │
│  │ Apr 4 · Demo                           │  │
│  │ PartnerCare Review · 45m · 2 people    │  │
│  │                          [Use This]    │  │
│  ├────────────────────────────────────────┤  │
│  │ Apr 2 · Follow-up                      │  │
│  │ Acme Corp Pricing · 28m · 2 people     │  │
│  │                          [Use This]    │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Or paste a share link below.                │
└──────────────────────────────────────────────┘
```

### "Use This" Flow

**For Call Recap Email:**
1. Fetch transcript + summary from provider API
2. Pre-fill `recordingUrl` (provider's share URL if available)
3. Pre-fill `callSummary` from provider's summary
4. Pre-fill `callTranscript` from provider's transcript
5. Auto-trigger recap generation

**For Call Review:**
1. Same data fetch
2. Pre-fill `recordingUrl`, `transcript`
3. Auto-detect call type from summary
4. User can immediately click "Analyze"

---

## Token Security

- **Encryption at rest**: AES-256-GCM encryption for access/refresh tokens
- **`ENCRYPTION_KEY` env var**: 32-byte hex key for encryption
- **Decrypt only when needed**: Tokens decrypted server-side only when making API calls
- **Auto-refresh**: If token is expired and refresh token exists, auto-refresh before API call

---

## Implementation Staging

### Phase 1: Foundation
1. DB model (`MeetingRecorderConnection`) + migration
2. Token encryption/decryption utility
3. Provider abstraction interface
4. OAuth connect/callback endpoints
5. Connections API (list, disconnect)

### Phase 2: Granola Integration
6. Granola provider implementation (API key auth, REST)
7. API: `GET /notes` (list), `GET /notes/{id}?include=transcript` (detail with speaker-attributed transcript)
8. UI: Meeting Recorder section on Call Recap new page
9. UI: Meeting Recorder section on Call Review page
10. "Use This" flow — fetch + populate + auto-trigger
11. Connection flow: user pastes their `grn_*` API key in a modal

### Phase 3: Fireflies Integration
12. Fireflies provider implementation (API key auth, GraphQL)
13. Fireflies `transcripts` query (list) + transcript detail (summary, action items, full text)
14. Connection flow: user pastes their Fireflies API key

### Phase 4: Fathom + Gong (future)
15. Fathom provider (OAuth2 flow, REST API)
16. Gong provider (OAuth2 flow, REST v2, scope negotiation)
17. OAuth redirect-based connection flow

### Phase 5: Polish
17. Token refresh handling (auto-refresh on 401)
18. Error states (expired tokens, rate limits, API down)
19. Sync status indicator (last synced timestamp)
20. Loading skeletons for call list

---

## Key Design Decisions

- **No background sync** — polls on demand when user opens the page. Simple, no cron jobs.
- **User-scoped connections** — each user connects their own recording account.
- **Tokens encrypted at rest** — defense in depth, even if DB is compromised.
- **Provider abstraction** — each provider is a pluggable module. Adding a new one = one file.
- **Graceful degradation** — if API fails or isn't connected, existing "paste share link" flow works as before.
- **No duplicate calls** — when fetching recent calls, provider's call ID is used to avoid re-importing.

---

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | MeetingRecorderConnection model |
| `src/lib/meeting-recorder/interface.ts` | Provider abstraction interface |
| `src/lib/meeting-recorder/encryption.ts` | Token encryption/decryption |
| `src/lib/meeting-recorder/granola.ts` | Granola provider implementation |
| `src/lib/meeting-recorder/fireflies.ts` | Fireflies provider implementation |
| `src/lib/meeting-recorder/fathom.ts` | Fathom provider implementation (future) |
| `src/lib/meeting-recorder/gong.ts` | Gong provider implementation (future) |
| `src/app/api/meeting-recorder/connect/route.ts` | Initiate OAuth |
| `src/app/api/meeting-recorder/callback/route.ts` | OAuth callback |
| `src/app/api/meeting-recorder/connections/route.ts` | List connections |
| `src/app/api/meeting-recorder/calls/route.ts` | List recent calls |
| `src/app/api/meeting-recorder/calls/[callId]/route.ts` | Fetch call detail |
| `src/components/MeetingRecorderPanel.tsx` | Shared UI component for both pages |
| `src/app/call-recap/new/page.tsx` | Add panel to recap page |
| `src/app/call-review/page.tsx` | Add panel to review page |

---

## Environment Variables

```
# Token encryption (for storing user API keys securely)
ENCRYPTION_KEY=<32-byte hex string>

# Granola — users provide their own grn_* API key via UI
# Fireflies — users provide their own API key via UI
# No server-side keys needed for API-key providers

# Fathom OAuth (future)
FATHOM_CLIENT_ID=<from Fathom developer portal>
FATHOM_CLIENT_SECRET=<from Fathom developer portal>

# Gong OAuth (future)
GONG_CLIENT_ID=<from Gong developer portal>
GONG_CLIENT_SECRET=<from Gong developer portal>
```

---

## Future: Call Execution Automation

### Phase 6: Calendar Integration + Pre-Call Prep

Integrate with Google Calendar / Outlook to see upcoming meetings and automatically generate pre-call prep briefs.

**How it works:**
1. User connects their calendar (OAuth — Google Calendar API or Microsoft Graph)
2. Mikey shows upcoming meetings on a dashboard or in the sidebar
3. For each upcoming meeting, Mikey identifies the deal/company from the meeting invite (attendees, title)
4. Generates a pre-call prep brief using:
   - **Sales Narrative** — positioning and messaging context
   - **Sales Motion** — expected call flow for this deal stage
   - **Deal context** — if a Deal exists for this company, pulls timeline entries, participant info, last call summary
   - **PDL enrichment** — attendee profiles (title, background, company)
   - **Pre-Call Planning checklist** — the user's existing checklist template
5. Outputs: suggested agenda, desired outcomes, key questions to ask, attendee profiles, relevant deal history
6. Optionally: sends a pre-call brief to Slack or email N minutes before the meeting

**Key questions to resolve:**
- How far in advance to prep? (e.g., meetings in the next 24-48 hours)
- Auto-match meetings to Deals by company name / attendee email?
- Push notifications (Slack/email) vs. pull (user checks dashboard)?

### Phase 7: Automated Call Review with Call Type Classification

Use the meeting recorder integration to automatically review calls after they happen, with the right scoring template based on call type.

**How it works:**
1. When a new call recording is available (via polling or webhook from Fathom/Gong), Mikey auto-ingests the transcript
2. GPT classifies the call type from the transcript:
   - **Discovery** — first meeting, exploring pain/need/fit
   - **Demo** — product walkthrough, showing capabilities
   - **Proposal** — pricing, packaging, commercial terms
   - **Negotiation** — working through objections, legal/security
   - **Closing** — final decision, signature, next steps
   - **General/Other** — can't classify, use generic template
3. Based on call type, Mikey selects the appropriate scoring rubric:
   - Discovery → Discovery Call Rubric (existing)
   - Demo → Demo Rubric (to be built)
   - Proposal → Proposal Rubric (to be built)
   - General → Lightweight generic rubric
4. Runs the call review analysis against the matched rubric
5. Results appear in the Call Review page, tagged with call type
6. If a Deal exists for this company, the review is auto-linked to the deal timeline

**What needs to be built:**
- Call type classifier (GPT-5.2, from transcript first 2000 chars + title)
- Auto-title generation from call metadata: use provider's participant names, company, and summary to generate a structured title (e.g., "Visana - Discovery - Conrad Smith + Jodi Mazzone") instead of generic "Call Review: 18/62"
- Participant extraction and characterization: parse participants from recording metadata (names, emails) and from transcript speaker labels, then enrich via PDL to get titles, companies, and roles. Store as structured data alongside the review.
- Additional scoring rubrics beyond Discovery (Demo, Proposal, Negotiation, Closing)
- Auto-trigger mechanism (poll for new calls, or webhook handler)
- Auto-link to Deals by matching company/attendee names
- Notification to user: "Your call with Visana was reviewed — 34/62 (Discovery)"

**Rubric design principle:** Each rubric follows the same structural pattern as the existing Discovery rubric (sections → items → score 0-2 → evidence), but with different sections and criteria appropriate to that call type.

