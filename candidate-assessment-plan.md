# Candidate Fit Assessment — screen an AE against YOUR hiring profile

## The idea

A founder gets 200 applicants for their first AE role and has no way to
tell the difference between "sold $2M ARR at a Series A with no SDR
support" and "carried a $4M number at Salesforce with inbound leads,
an SE, and a brand that opens every door." Both résumés say
"consistently exceeded quota."

Paste a LinkedIn URL in the Hiring tab. Mikey pulls the work history,
reconstructs **what each of those companies actually was while the
candidate was there**, and grades the profile against this founder's
AE Hiring Profile, sales motion, ICP, and current GTM stage — with
flags for the tenure patterns that matter and an honest read on
whether their experience transfers to a company like yours.

This sits UPSTREAM of the existing Pre-Hire Assessment applet (which
generates the take-home to send a candidate). Screen here; if they
survive, send them that. Natural CTA between the two.

## Why not "just GET the LinkedIn page"

Direct fetches of `linkedin.com/in/*` from a server return a login
wall or a 999 — LinkedIn blocks datacenter IPs, and scraping profiles
violates their ToS. Three viable inputs instead, in priority order:

1. **PDL person enrichment (primary).** Already wired in
   `src/lib/search/pdl.ts` and already accepts a LinkedIn URL — the
   `profile` param. Returns `experience[]` with company name, website,
   title, and start/end dates, plus education and skills. This is the
   whole ballgame and costs ~1 credit.
2. **Paste the profile text (fallback).** When PDL misses (no match,
   thin profile), the founder copy-pastes the profile or the résumé
   into a textarea and an LLM extracts the same structure. Also the
   path for candidates who applied with a PDF résumé and no LinkedIn.
3. **Manual entry** of a few roles — the escape hatch, never the
   default.

The UI should degrade gracefully across all three and always tell the
founder which one produced the data.

## The move that makes this more than résumé-vibes

Anyone can eyeball a résumé. The differentiated read is
**stage-at-tenure reconstruction**: what was that company *at the time
they worked there*, not what it is today.

PDL's company enrichment returns `funding_details[]` with per-round
`funding_type` and `date`, plus `employee_count`, `founded`, and
`latest_funding_stage`. So for each role we can compute, in code:

- rounds closed **before** their start date → the stage they joined at
- rounds closed **during** their tenure → what they lived through
- headcount trajectory (approximate — PDL gives current count, so this
  is an estimate anchored on founding year + funding pace)

"Series C, 900 people" today might have been "Series A, 40 people"
when they were there — which flips the read completely. A candidate
who joined three companies at Seed/A and stayed through the messy part
is a very different bet from one who only ever arrived post-C.

Where PDL has no funding data (bootstrapped, non-US, stale), fall back
to the existing web-research plumbing (`fetchPages` / search) for a
best-effort read, and mark the confidence as low rather than guessing.

## The two axes

### Axis 1 — Signals (flags), mostly computed, not inferred

Tenure math is arithmetic and must never be hallucinated. Compute it
in TypeScript from the dates, hand the LLM the numbers:

| Signal | How it's computed | Read |
|---|---|---|
| Stint lengths | end − start per role | <12mo repeatedly = churn risk |
| Job-hopping pattern | count of sub-12mo stints in last 6 yrs | 1 is noise, 3 is a pattern |
| Ramp-adjusted productive time | stint − assumed ramp (by ACV band) | a 9-mo stint at 4-mo ramp = ~5 productive months |
| Progression | title sequence over time | SDR→AE→Sr AE = green; repeated lateral = question |
| Gaps | months between roles | flag only if long AND unexplained |
| Recency of relevant stage | last time they were at a company like ours | "startup experience" from 9 years ago is stale |
| Scale-down risk | biggest company → your stage | the classic first-AE failure mode |
| Tenure at BEST-fit company | how long they stayed where it mattered | the most predictive single number |

**Fairness adjustments, stated in the prompt:** 2022–2024 mass layoffs
and acquisitions produce short stints that aren't the candidate's
doing — the model must not penalize a stint that ends in a known
layoff window or at an acquired company without saying so. Career
breaks are not flags. See "Legal & fairness" below.

### Axis 2 — Fit (LLM judgment over reconstructed facts)

For each *seller* role (filter out non-sales roles), compare:

1. **Stage match** — company's stage during their tenure vs our
   `SalesMaturityStage.currentStage`. Adjacent is fine; two steps off
   is the risk.
2. **Motion match** — velocity/transactional vs enterprise/complex,
   inbound-fed vs outbound-hunting, PLG-assist vs sales-led. Inferred
   from company category, ACV band, and segment.
3. **Category / buyer match** — did they sell to your ICP's personas
   and industries, or something structurally different (selling
   martech to CMOs ≠ selling infra to platform teams)?
4. **Deal shape** — ACV band and cycle length vs yours.
5. **Support structure** — did they have SDRs, SEs, marketing air
   cover, and brand, or were they self-sufficient? A first AE at a
   seed company has none of it.

Each dimension gets a rating + the evidence behind it. The *aggregate*
is a stated verdict, not a fake precision score:
`strong_fit | worth_a_look | stretch | likely_mismatch`, with a
confidence level driven by how much of the profile we could actually
verify.

## Output shape

```
{
  candidate: { name, headline, linkedinUrl, location, source },
  timeline: [{ company, title, start, end, months, isSales,
               stageAtStart, stageAtEnd, employeeEstimate,
               fundingBefore[], fundingDuring[], confidence }],
  signals:  [{ kind, severity: green|amber|red, claim, evidence, computed }],
  fit:      [{ dimension, rating, rationale, evidence }],
  verdict:  { level, headline, confidence, whatWeCouldntVerify[] },
  interviewProbes: [ "..." ],   // what to actually ask them
  references:      [ "..." ]    // what to backchannel
}
```

Two deliberate output choices:

- **`whatWeCouldntVerify` is mandatory.** A profile with no company
  matches should say so loudly rather than produce confident prose
  over nothing. Same discipline as the proof-point extractor's
  mandatory quotes.
- **`interviewProbes`** turn the assessment into a next action —
  "ask how many of the 14 logos were self-sourced" beats a score.
  This is where the feature earns repeat use.

## Data model

```prisma
model CandidateAssessment {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Which profile they were graded against (null = graded against
  // narrative/ICP/stage only, no hiring profile authored yet).
  hiringProfileVersionId String?

  candidateName String
  linkedinUrl   String?
  source        String   // "pdl" | "pasted" | "manual"

  rawProfile Json     // normalized timeline + PDL payloads, for re-runs
  assessment Json     // the output shape above
  verdict    String   // denormalized for list filtering/sorting
  roleLabel  String   @default("AE")   // AE | SDR | AM | CSM later

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, createdAt(sort: Desc)])
  @@map("candidate_assessments")
}
```

Storing `rawProfile` separately means re-grading against an updated
hiring profile costs one LLM call and zero PDL credits.

## Pipeline

```
LinkedIn URL
  │
  ├─ PDL person/enrich (profile=<url>)          ~1 credit
  │    └─ miss → paste-text fallback → LLM extraction
  │
  ├─ for each SALES role (cap ~8, most recent first):
  │    └─ PDL company/enrich (website||name)     ~1 credit each
  │         └─ miss → web research fallback, confidence: low
  │
  ├─ [TypeScript] reconstruct stage-at-tenure + compute tenure math
  │
  ├─ [gpt-5.5] one structured call:
  │    inputs: computed timeline + signals, hiring profile markdown,
  │            sales narrative, ICP, sales motion, current GTM stage
  │    output: fit dimensions, verdict, probes, references
  │
  └─ persist CandidateAssessment
```

Cost per candidate: roughly 6–9 PDL credits + one gpt-5.5 call over
~15–25K tokens. Worth showing the founder a "this uses N enrichment
credits" note if PDL is metered on their plan.

## UI — `/hiring`, second tab

The Hiring tab becomes two things: **Profile** (existing) and
**Candidates** (new).

- **Paste bar** at the top: LinkedIn URL + "Assess candidate", with a
  "paste profile text instead" disclosure for the fallback path.
- **Demonstrative spinner** while it runs (~20–40s) narrating the real
  steps: pulling profile → researching 6 companies → reconstructing
  stages → grading against your profile. Same pattern as task
  detection.
- **Result card**: verdict chip + headline, then the **timeline** as
  the hero — one row per role showing company, title, dates, months,
  and *stage during tenure* as a chip, colored by match to your stage.
  That visual alone is the product.
- **Signals** as green/amber/red rows with the computed number visible
  ("3 of last 5 roles under 12 months").
- **Fit dimensions** as five rated rows with rationale.
- **Interview probes** and **what we couldn't verify** at the bottom.
- **Candidate list** with verdict filter, and a **compare view** (2–4
  side by side) once there's more than one — the natural Phase 2.
- **"Send the take-home →"** CTA linking the existing Pre-Hire
  Assessment applet.

Gate: if no hiring profile exists, still allow the assessment but say
it's graded against narrative + ICP + stage only, and link "Create
your AE Hiring Profile" — don't hard-block, since the stage/motion
comparison is useful on its own.

## Phasing

1. **Phase 1 — the core read (M).** Schema + PDL person/company +
   stage reconstruction + tenure math + single grading call + result
   card + candidate list. One role type (AE).
2. **Phase 2 — depth (M).** Paste-text fallback, side-by-side compare,
   re-grade against a newer hiring profile, PDF résumé ingest,
   SDR/AM/CSM role types, export to PDF (the shared export util).
3. **Phase 3 — the loop (S/M).** Assessment → take-home handoff with
   context prefilled; log the hire and the outcome so the profile
   itself can be tuned against who actually worked out; optional
   backchannel-reference suggestions.

## Legal & fairness — decide this before Phase 1

This is candidate screening software, which is a regulated surface,
and worth being deliberate about rather than discovering later:

- **Position it as decision support, never a filter.** No auto-reject,
  no numeric score presented as objective. A stated verdict a human
  overrides is defensible; a 87/100 that gates a pipeline is not.
- **NYC Local Law 144** covers Automated Employment Decision Tools —
  bias audits and candidate notice — for NYC-based roles. Adjacent
  rules exist in Illinois and Colorado, and the EU AI Act treats
  employment screening as high-risk. Worth counsel before this is
  marketed as a screening product rather than a founder's own
  research aid.
- **Exclude protected-class proxies from the prompt** — no name-based
  inference, no photo, no age signals (graduation years), no
  location-as-proxy, no school prestige. Grade the *work*: stage,
  motion, category, tenure.
- **Log the evidence for every claim** (already the house pattern) so
  any judgment can be audited and rebutted.
- **Never let career gaps be a flag on their own.**

## Open questions

- **PDL match rate on sales profiles** — needs a spike on 10 real
  LinkedIn URLs before committing to it as the primary path. If it's
  under ~70%, paste-text becomes the primary and PDL the enhancement.
- **Is "stage during tenure" reliable enough** for bootstrapped or
  non-US companies where funding data is thin? Proposal: show the
  confidence and let low-confidence rows read as "unknown" rather than
  guessing.
- **Do we want a numeric score at all?** Recommendation: no — a
  four-level verdict plus per-dimension ratings communicates the same
  thing without implying precision the data can't support.
- **Multi-tenant reuse:** company enrichments are user-agnostic — cache
  them globally (keyed by domain + as-of date) so the 40th founder to
  assess an ex-Gong rep doesn't re-buy the same company lookup.
