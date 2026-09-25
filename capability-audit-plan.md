# Capability Audit — Integration / Extension / Rationalization Roadmap

Derived from a full-app audit (applet inventory, integration surfaces, schema/legacy). Consolidated backlog + new findings across three buckets. Effort key: **S** = <½ day · **M** = ½–3 days · **L** = 1+ week.

> **Shipped (omitted from the actionable list below):**
> - **A1** — Slack file messages now route through the deal/coaching/GTM agents (file text extracted up front, folded into detection + agent message) instead of falling to legacy Chatbase. Blob-storage-on-agent-path is the one deferred sub-item.

---

## A. Integrations — make existing capabilities talk to each other

**A2. Deal ↔ Coaching structural link (M).**
No FK exists between deals and coaching sessions; the routers hand off on keywords but data never joins. Add a `DealCoachingMention` join (dealId, sessionId), auto-populated via deal-name match on session save (the synthesizer already detects deal names — reuse that pass), plus a manual tag. Surface: a "Discussed in coaching" deal-timeline entry type; coaching tools gain `getDealsDiscussedInSession`; deal tools gain `getCoachingDiscussionsForDeal`.

**A3. One attachment/artifact registry (M).**
The 9-attachment catalog is hand-synced across 3 files (`stream/route.ts` validAttachments + inline fetch switch, `attachments/available`, `attachments/content/[type]`); agent tools re-implement the same fetchers again. Build `src/lib/artifacts/registry.ts`: slug → { label, availability check, content fetcher }. All four consumers read from it, then add the missing artifacts (objection library, cold-call scripts, sales motion, sales metrics). Permanently kills the share-whitelist-drift bug class.

**A4. Call Review + Call Recap write back to deals (S–M).**
Both applets are stranded — a scorecard or recap email never lands on the deal. After generation, match by participants/company domain (reuse `findDealNameInText` / domain matching from `enrich.ts`) and offer a one-click "Attach to deal" that writes a timeline entry, so deal analysis sees the call feedback.

**A5. Readiness sync reads the pipeline (M).**
`/api/sales-readiness/sync` reads coaching + assessment but never deals. Extend `sync-sources` with pipeline evidence (closed-won count, meeting volume, stage distribution — available via existing `DEAL_TOOLS` pipeline queries).

**A6. Web agent honors promptGuidance + merge fields (S).**
The stream route injects `user.promptGuidance` and expands `{{merge_fields}}`; `/api/chat/agent` ignores both. Since agent mode is the default chat path now, port both (guidance → system prompt, expansion → before the run).

**A7. Artifact → Collateral Library bridge (S–M).**
"Where does my deck live" has two answers (SalesDeckVersion vs SalesAsset). Add a "Publish to Collateral Library" action on artifact pages that fills the matching SalesAsset slot with a pointer + extracted text. One-way publish, no schema merge.

**A8. Schedule the activity-broadcast digest (S).**
Watermark-based, built for periodic sending, but only fires on manual admin POST. Add a weekly cron to `vercel.json`.

**A9. Outcome synthesis → Goals/Tasks persistence — ✅ SHIPPED (implicit goal tracking).**
Post-save extraction (rides the synthesis job) infers completions/status changes/new goals+tasks from notes+transcript with verbatim evidence quotes; candidates persist on the session (`outcomeCandidates` blob); review chip + modal → transactional commit. Rejected/committed decisions carry forward across re-saves. See `lib/coaching/extract-outcomes.ts`, `/api/coaching-sessions/[id]/outcomes`, `OutcomeReviewPanel`.

---

## B. Extensions — new capability on existing rails

**B1. Morning Briefing digest (M) — composes entirely from existing tools.**
Daily Slack DM from tools that already exist: `getUpcomingDealActivity` (today's meetings) + `getDealsNeedingHelp` (risk) + `getDealsLikelyToClose` + `whereDidWeLeaveOff` (coaching priorities). The daily-research-briefs cron already has the Slack-DM + chat-conversation delivery plumbing. Best value-per-line on the list.

**B2. Customer Success Phase 1 (L) — per customer-success-plan.md.**
Post-close view of the Deals applet: `whyTheyBought` + `renewalDate` columns on Deal, pinned "why they bought" card, renewal countdown, at-risk customer pipeline view, `getCustomerOutcomeStatus` tool. Phase 1 only (no standalone Customer model).

**B3. Collateral Phase 2 (M).**
OCR fallback for `extractTextStatus=ocr_needed` scanned PDFs (pipe through existing `pdf-ocr.ts`) + `getCollateralContent(id)` tool for full-text retrieval when snippets aren't enough.

**B4. Attachment picker parity (S, rides on A3).**
Once the registry exists, expose all registered artifacts as toggleable persistent attachments — today only 6 of ~20 are toggleable; the rest need ad-hoc ChatAboutButton.

**Deferred extensions:** cross-provider recorder dedup (no dual-recorder usage yet); merge hiring-profile / sales-leader-profile into one parameterized applet (UI + data migration cost > current pain); blog-generator / SEO-planner concepts.

---

## C. Rationalizations — simplify and de-duplicate

**C1. Shared agent runtime (M) — biggest bug-surface reduction.**
The `MAX_TURNS` run loop is byte-similar across 4 run.ts files; `loadSellerContext` is copied 5x (incl. synthesize.ts); `ToolCallTrace`/`AgentResult` re-declared 7x (incl. test pages). Extract `runAgentLoop({ tools, systemPrompt, ctx, callbacks })` + move shared types/helpers into `src/lib/agents/shared/`. Every agent fix this session had to be applied 4x — this ends that.

**C2. Slack utility dedup (S–M).**
`stripSlackMentions` 3x byte-identical; `markdownToSlack` variants; Validate/Dismiss block-kit duplicated in scan-recordings + slack-broadcast; `handleMention`/`handleDirectMessage` duplicate the entire router cascade. One `src/lib/slack/util.ts` + one `runRouterCascade()`. (`file-context.ts` from A1 is the first tenant of this shared module.)

**C3. Delete verified-dead code (S).**
`formatSessionsForChat` (zero call sites), `/api/cron/refresh-deal-health` (self-described retired, unscheduled), the 3 `/agents/*` test pages (superseded by agent-mode in main chat).

**C4. Retire the non-stream Chatbase route (M).**
Only caller is the settings "AI Assist" widget — migrate that to the stream route, delete `/api/conversations/[id]/messages`, then evaluate dropping `Conversation.mode` / `chatbaseConversationId` once the Slack legacy path also retires.

**C5. Plan-file hygiene (S).**
Resolve the `PLAN.md` / `Plan.md` / `plan.md` case-collision trio (breaks case-insensitive filesystems; two are ~60KB divergent copies) — merge to one, move all root `*-plan.md` files into `docs/plans/`. (This file included.)

**C6. Extract activity-broadcast wiring from db.ts (S–M).**
254 of db.ts's 275 lines are Prisma `$extends` broadcast interceptors with hard-coded labels for ~22 models. Move to `src/lib/activity/interceptors.ts` registry so the DB client file is a DB client again.

**C7. `prisma migrate deploy` in the build script (S).**
The `providerClientId` prod incident happened because migrations don't auto-apply. Change build to `prisma migrate deploy && prisma generate && next build`. Additive-migration discipline (already the norm) makes this safe.

**Flagged, not proposed:** consolidating the 6 near-identical persona Version tables (Email/LinkedIn/ColdCall/Deck/Ad/Social) into one discriminated table, and the 5x Question/Answer/Version triple — real redundancy, risky migrations, low user payoff. Only fold in if a feature forces touching them.

---

## Suggested sequencing

1. **Quick wins:** C3, C5, C7, A6, A8
2. **Foundations (make everything after cheaper):** C1, C2, A3
3. **Integrations:** A2, A4, B4, A7
4. **By appetite:** B1, A5, B3, B2, C4, C6 (A9 shipped)

## Verification per tranche

- **Quick wins:** `npm run build` green; grep for deleted symbols returns zero; Vercel deploy applies a no-op migration cleanly.
- **Shared runtime (C1):** all 4 agents + web chat produce identical traces pre/post refactor on the /agents test prompts (run before deleting the test pages).
- **Registry (A3):** attachment picker, `/attachments/available`, stream-route injection, and agent tool outputs all list the same artifact set; add a dummy artifact in one place and verify it appears everywhere.
- **Deal↔coaching (A2):** save a coaching session mentioning a deal name; verify the join row, the deal-page timeline entry, and both agents' new tools return the link.
