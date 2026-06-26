# Deal Agent — Tool-Using Mikey Plan

Inline tool-using agent (DIRECT-mode gpt-5.5 with function calling) so Mikey
can answer Slack / chat questions about specific deals by name and execute
limited actions on them. Inline tools, no separate MCP server yet — when /
if external clients (Claude Desktop, Cursor, etc.) need to read Mikey data,
this same tool registry becomes the MCP server's tool list with no logic
duplication.

## Architecture

```
Slack inbound → events handler → run-deal-agent loop
                                  │
                                  ├── gpt-5.5 with tool defs
                                  │     ↓
                                  │   tool calls
                                  │     ↓
                                  ├── handler dispatch
                                  │     ↓
                                  ├── Prisma + lib/deals/* helpers
                                  │     ↓
                                  ├── tool results back into model
                                  │     ↓
                                  └── final text → Slack reply
```

- One agent loop. Tool definitions live in `src/lib/agents/deals/tools.ts`.
- Handlers receive `{ userId }` from the trusted server context; never from
  the LLM. This is the auth boundary.
- Loop caps at ~8 tool turns to bound cost and runaway behavior.
- All mutating tools return what they wrote so the agent can confirm.

## Phasing

### Phase 1 — Per-deal tools (this round)

The agent can answer questions about ONE deal at a time, resolved by name /
fuzzy reference. No multi-deal reporting yet. Drafts (email, Slack messages)
return the draft for the user to approve; never auto-sent.

Resolver:
- `findDeal(query)` — fuzzy match by name + companyName + participant
  domain. Returns top 3-5 candidates with confidence.

Reading:
- `getDealCore(dealId)` — structured facts: stage, status, dates,
  dealValue, mikeyHealth, days in stage, days open, counts.
- `getRecentActivity(dealId, days?, type?)` — timeline slice.
- `getCallDetail(callId)` — full transcript / summary for one call.
- `getParticipants(dealId)` — contacts with roles, titles, last
  engagement.
- `getHealthAndRisks(dealId)` — Mikey Health + the "Risks & Gaps"
  section from latest analysis.
- `getUpcomingMeetings(dealId)` — future calendar entries on the deal.
- `summarizeCall(dealId, entryId? | startDate? + endDate?)` — pick
  one specific call (most recent by default, or a date range, or
  by explicit entryId) and return its full content + a summary
  directive. Collapses the common findCall → getCallDetail
  sequence for the "summarize the most recent call" / "what did we
  talk about in the first week of June" question shape.

Synthesis (specific format):
- `prepForMeeting(dealId)` — same prompt as the /deals/[id] CTA.
- `nextBestAction(dealId)` — same prompt as the /deals/[id] CTA.

Action:
- `draftFollowUpEmail(dealId, fromCallId?, intent?)` — uses most recent
  call by default. Intents: `next-steps` | `re-engage` | `pricing-followup`.
- `addTimelineEntry(dealId, type, content, title?)` — append a note,
  email, slack_message, etc. ONLY mutation in phase 1. Returns the
  created entry's id + a preview for confirmation.

NOT building `summarizeDeal` — the agent composes summaries from the
structured tools above, producing more grounded answers than a paraphrased
blob would.

### Phase 2 — Pipeline tools (after phase 1 is solid)

Once per-deal is stable, layer in cross-deal reporting / discovery. These
are the highest-leverage Slack questions: "what's stalled?", "which deals
have meetings this week?", "who am I single-threaded on?".

Planned phase 2 tools:
- `listDeals(filter)` — multi-deal filter:
  `{ stage?, status?, health?, withMeetingInNextDays?, lastActivityBeforeDays?,
    hasParticipantEmail?, hasParticipantNameLike?, dealValueMin?, dealValueMax? }`
  Returns capped result set (e.g. 25 deals) with the same shape as `findDeal`'s
  candidates so the agent can chain into the per-deal tools.
- `findDealsByPerson(name | email)` — cross-deal participant lookup.
- `findDealsByCompany(domain | name)` — covers "do I have anything going
  with sourcebot.dev?".
- `pipelineSummary({ status?, stage? })` — aggregate stats: count by
  stage, total value, deals needing attention, deals with no upcoming
  meeting. Powers "how's the pipeline looking?".
- `stalledDeals(daysSinceActivity?)` — deals open with no activity in
  N days. Subset of `listDeals` but a dedicated tool because the
  question shape is so common.
- `dealsNeedingAttention()` — opinionated combo: active deals with
  poor/fair health OR no upcoming meeting OR long dwell in current
  stage. Surfaces the "what should I work on today?" answer in one
  tool call.

Phase 2 also expands the action surface:
- `bulkReanalyze(dealIds[])` — fire `runDealAnalysis` on a set.
- `draftSlackMessage(dealId, intent)` — separate from email because the
  voice + length differ.

### Phase 3 — Beyond deals (later)

Once deals work, the same agent loop gets a wider tool surface:
- `narrative.*` — read / search the user's sales narrative.
- `playbook.search(query)` — RAG over founder-led-sales playbook content.
  Replaces or complements the Chatbase path.
- `coaching.*` — read latest coaching session takeaways, surface relevant
  guidance per deal.
- Cross-surface actions ("apply this coaching insight to all stalled
  deals") get safer once the per-deal action layer is battle-tested.

## Slack integration plan

Phase 1 ships with a plain HTTP endpoint (`POST /api/agents/deals`) so we
can drive it from curl / a test page and inspect the tool-call trace.
Slack wiring lands once the agent reliably handles the per-deal question
set:

- Slack message → existing events handler → detect "deal-ish" intent
  (simple regex on deal names + a few keywords initially, since the agent
  itself can decide to just answer from training if no deal is named).
- Route to `run-deal-agent`, stream tool-call status to Slack as
  thinking messages ("Looking up MongoDB deal…", "Reading recent
  calls…") so the user sees the work happening.
- Final answer posted as a threaded reply. Drafts get posted as
  attachments / blocks with copy buttons.

## Open design choices

- **Multi-deal references in one question** ("compare the MongoDB and
  Acme deals"): defer until phase 2 — for now the agent can call
  `findDeal` twice and chain, but no first-class comparison tool.
- **Disambiguation UX**: when `findDeal` returns multiple candidates, the
  agent asks the user. Could later be a first-class "ask user for
  clarification" tool that returns a structured option list.
- **Token budget per user**: not enforced in phase 1; add once we see
  what real Slack usage looks like.
- **Caching**: skip in phase 1. Deal data changes too often and the per-
  query cost is fine at our scale.
