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
2. **Upload a résumé or LinkedIn PDF (co-primary).** Most candidates
   arrive as an attachment, not a URL — and LinkedIn's own
   "More → Save to PDF" export is the highest-fidelity input we can
   get without an API, since the founder can produce it for any
   profile they can view, including ones PDL misses entirely.
   `extractTextFromPDFWithOCR()` + `formatPDFForAIWithOCR()` already
   exist (`src/lib/pdf-server.ts`, OCR fallback included for scanned
   résumés), and `uploadFile()` handles storage — same plumbing the
   narrative prefill and asset library use.
3. **Paste the profile text.** Same extraction path as the upload,
   minus the file — for when someone copies a profile out of a browser
   or an email.
4. **Manual entry** of a few roles — the escape hatch, never the
   default.

Crucially, **all four inputs converge on the same normalized
timeline** and everything downstream (company enrichment, stage
reconstruction, tenure math, grading) is identical. An upload is an
alternate *source*, not an alternate pipeline.

The UI should degrade gracefully across all of them and always tell
the founder which one produced the data — including "we merged your
uploaded résumé with the LinkedIn profile" when both exist.

### What a résumé gives us that LinkedIn doesn't

A LinkedIn profile is structured but sanitized; a résumé is messy but
carries the numbers a hiring manager actually wants:

- **Quota and attainment claims** — "142% of a $1.4M quota, 3 yrs
  running", President's Club, ranked 2/47.
- **Deal shape** — ACV, cycle length, logos closed, self-sourced %.
- **Team context** — "first AE", "built the SDR team", "no marketing
  support" — exactly the support-structure dimension the fit axis
  cares about and LinkedIn rarely states.

These are **claims, not facts**, and the design treats them that way:
extract them into a `claims[]` array, mark each `verified: false`, and
feed them to the grading call explicitly labeled as unverified. They
never move the verdict on their own — instead they become the sharpest
`interviewProbes` ("the résumé says 68% self-sourced at Acme — ask how
that was measured and what the team average was") and the best
backchannel-reference questions. A claim that contradicts the
reconstructed timeline (President's Club in a year the company was
pre-revenue) is itself a red flag worth surfacing.

### PII stripping on the upload path (do this in extraction)

Résumés — especially non-US CVs — carry things that must never reach a
grading prompt: photos, date of birth, marital status, nationality,
home address, and graduation years that proxy for age. The extraction
step drops them before assembly, and the prompt never sees them. This
is a stronger fairness control than the LinkedIn path gets for free,
and it should be implemented as an explicit allowlist of extracted
fields rather than a blocklist of things to remove.

### Parsing note

LinkedIn's PDF export has a predictable layout — an `Experience`
section with `Company · Full-time` and `Jan 2020 - Mar 2023 · 3 yrs
3 mos` date ranges — so it parses far more reliably than a free-form
résumé. Worth detecting the LinkedIn format up front (the export has a
recognizable header/footer) and using a tighter extraction prompt for
it, falling back to the general résumé prompt otherwise. Both emit the
same normalized timeline.

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
| Job-hopping pattern | count of short stints (role-relative) in last 6 yrs | 1 is noise, 2 is a pattern, 4+ is disqualifying |
| Ramp-adjusted productive time | stint − assumed ramp (by ACV band) | a 9-mo stint at 4-mo ramp = ~5 productive months |
| Progression | title sequence over time | SDR→AE→Sr AE = green; repeated lateral = question |
| Gaps | months between roles | flag only if long AND unexplained |
| Recency of relevant stage | last time they were at a company like ours | "startup experience" from 9 years ago is stale |
| Scale-down risk | biggest company → your stage | the classic first-AE failure mode |
| Tenure at BEST-fit company | how long they stayed where it mattered | the most predictive single number |

**Fairness adjustments, stated in the prompt:** career breaks are never
flags, and we never reason from name, location, school prestige or
graduation year. A *single* short stint ending in a known layoff window
or at an acquired company is discounted rather than penalized. See
"Legal & fairness" below.

This does **not** extend to repeated short tenure — see the job-hopping
carve-out below. Discounting one exit is fairness; discounting a
pattern of them is just failing to report what the data says.

#### The flag engine — `lib/hiring/flag-engine.ts`

**Rules produce the flags; the LLM never invents one.** Detection is
TypeScript over the normalized timeline, so the same résumé yields the
same flags every time, each one traceable to a line of code. The model
receives the finished list and narrates it — why it matters here, the
innocent explanation, the question to ask. `narrate()` joins narration
on *by flag code*, which means a flag the model liked and made up gets
dropped, and one it disliked and omitted still renders.

Four properties every flag carries:

- **Polarity** — red or green. Green flags are first-class, not the
  absence of red ones. `promotion_velocity` is the single strongest
  positive signal in a profile.
- **Severity** — critical / high / medium / low, and the report orders
  by it. Not every flag deserves the same visual weight.
- **Confidence** — `detected` on month-precision dates, `possible` when
  it rests on year-only dates or a fuzzy company match. A year-only
  date silently becomes January and can move a stint by 11 months, so
  a "hopping" pattern built on them is an artifact, not a finding.
- **Suppression, and it's visible.** A 10-month stint ending inside a
  mass-layoff window isn't hopping. The flag is still *returned*,
  carrying `suppressedBy`, and renders under "considered and
  discounted." Silent filtering is untrustworthy filtering — showing
  the work is what makes the surviving flags credible.

**Job hopping is the loud exception to all of the above.** Repeated
short tenure is the most predictive negative signal on a sales résumé —
a rep who leaves before a full quota year never produces, and the
employer eats the ramp twice — so the tenure-pattern flags
(`serial_short_stints`, `pre_milestone_departures`) are held to a
harsher standard than everything else:

- **Two short stints is a pattern. Four is a disaster** and fires at
  `critical`, which drives the verdict to `likely_mismatch` unless
  something extraordinary outweighs it, and forces the headline to lead
  with the pattern rather than bury it under strengths.
- **No layoff suppression.** A downturn explains one exit; it does not
  explain a career of them. The window is still reported as fact in the
  evidence line, labelled *context, not an excuse* — the founder gets
  the information without the flag being talked down.
- **No innocent explanation.** These flags carry `noExcuses: true`, and
  `narrate()` forces `innocentExplanation` to null in code rather than
  merely asking the prompt nicely — a model that decides to be
  charitable anyway cannot put that softening in front of the founder.
  If the candidate has an explanation, they can give it in the
  interview. The job here is to make sure the founder actually asks.

**Thresholds stay role-relative even so.** A flat 18-month bar would be
wrong for an SDR, where median tenure is genuinely around 14 months —
applying the AE bar there would flag essentially every SDR alive, which
is noise, not signal. `ROLE_RUBRICS` sets the short-stint threshold and
assumed ramp per seat (SDR 12mo, AE/AM/CSM/Manager 18mo, VP 24mo); the
*count* that makes a pattern is an unforgiving 2 across the board.

**Two things that are never flags:** a role they're *still in* (nobody
has left it — counting the current job as hopping is the easiest way
to libel someone who simply started recently), and multiple roles at
one employer counted separately (an SDR→AE run at Salesforce is one
28-month tenure, not two short stints).

`innocentExplanation` is mandatory on every red flag **except the
tenure-pattern ones above**. Elsewhere, a flag is an evidence-backed
prompt for a conversation — never a verdict about a person.

#### Hopping is measured per EMPLOYER, never per role

The single worst failure this engine can have is reading internal
movement as churn. "Corporate AE 12mo, then Mid-Market AE 17mo at the
same company" is a **29-month tenure with a promotion in the middle** —
a green flag — and a per-role counter turns it into two hops and a
`critical` verdict. Every tenure detector aggregates by company first.

That also required a second title ladder. Promotion detection compares
first vs last role chronologically (max-vs-min scores a *demotion* as a
promotion) across two orthogonal axes:

- **Seniority** — SDR → AE → Senior → Manager → Director → VP.
- **Segment** — SMB → Commercial/Corporate → Mid-Market → Enterprise →
  Strategic/Major. This is how AEs actually get promoted, and a ladder
  that only knows seniority scores `Corporate AE → Mid-Market AE` as
  nothing at all.

Either axis rising counts — except when the move is off the bag. A
quota-carrying seat to a non-quota one (`Enterprise AE → Enterprise
Strategic Consultant`) climbs the segment ladder while stepping out of
a selling role, and crediting that as advancement flatters a sideways
move.

#### Green flags and the "grit" signals

Green flags are first-class, not the absence of red. Beyond
`promotion_velocity` and `long_tenure_multiple_roles`, the engine reads
background signals off the résumé: quantitative or argument-heavy
major, **professional athletics**, collegiate athletics, military
service, terminal ranks of multi-year achievement programs, academic
distinction, and — rated highest of the set — having worked through
school.

`professional_athletics` is scored separately from and above the
collegiate flag, and suppresses it (a pro career nearly always came
with a college one; firing both double-counts a single fact). Getting
paid to play means clearing a selection funnel far narrower than a
varsity roster and then holding a job re-evaluated on measured
performance continuously and in public — the closest thing to a
carried quota that exists outside sales. Semi-pro and minor-league
count, and are arguably the better signal: same grind, none of the
money. Both this and military service scan **job titles as well as
activity lines**, because a playing career or a tour is usually listed
as employment; titles only, never company names, so an employer called
"Olympic Steel" doesn't read as an Olympian.

**These are green-only, by construction.** Their absence is never a red
flag, never lowers a rating, and never appears in the report. That is
what keeps them usable: most good AEs didn't play varsity anything, so
"no athletics" carries no information, and a bonus-only signal cannot
harden into a filter that screens out the candidate who waited tables
instead of rowing.

Two deliberate exclusions:

- **Graduation year is never extracted or used** — it is an age proxy
  and age is protected under the ADEA. It's blocked in the extraction
  prompt *and* stripped by regex afterwards, because a prompt rule the
  model can forget is not a control.
- **"Eagle Scout" is not matched as a bare keyword.** The award was
  male-only until 2019, so keyed literally it is a sex proxy for anyone
  who earned it before then. What's actually worth crediting is a
  multi-year program carried to its terminal rank, so that's what the
  pattern matches — across Scouts BSA, Girl Scouts, Duke of Edinburgh
  and similar.

`worked_through_school` is rated above the prestige signals on purpose.
It's earned rather than inherited, and it's the one background signal
that corrects for advantage instead of compounding it.

#### School selectivity — what PDL can and can't do

PDL's `/school/clean` returns `id, name, website, domain, type,
linkedin_url, linkedin_id, facebook_url, twitter_url, location` — per
their own OpenAPI spec. There is **no prestige, selectivity, ranking or
admission-rate field**, on that endpoint or any other. PDL resolves who
an institution *is*; it does not rate institutions.

So the work splits:

- **PDL does identity.** "UMich", "U of M" and "University of
  Michigan-Ann Arbor" all clean to one record with `domain:
  umich.edu`. That's the half that makes a tier lookup actually work.
- **`school-registry.ts` does the tier**, keyed on **domain** rather
  than free text, with suffix matching so `eng.umich.edu` resolves.
  Raw-name matching is a lossy fallback and drops the flag to
  `possible` confidence when it's the only path available.

Capped at 2 school lookups per assessment — undergrad plus a graduate
degree is all the flag needs, since it reports the single best match
rather than a transcript.

**This is a heavily-weighted signal by product decision** —
`selective_school` fires at **high** severity for elite and **medium**
for selective, the same tiering as the sales-org registry. The
rationale: a single-digit admit rate is a hard selection event
verified by a third party, which is the same reason academy-org tenure
counts for anything.

Two properties hold regardless of the weight. It stays **green-only**
— a strong school is a real positive, an unremarkable one is never a
negative, which is the line between a signal and a screen. And the
tiers are judgment, not data, since PDL has no selectivity field.

That second point makes account overrides (`HIGH_BAR_SCHOOLS`) *more*
important the heavier the weight, not less: the seed list is
unavoidably US-centric, and a founder hiring in Munich or São Paulo
has a completely different and equally valid set that a shipped list
must not silently override.

"Smart major" splits into two bands. **Technical** (engineering, CS,
hard sciences, maths) is the harder signal for a complex sale — that
candidate can hold a technical conversation with the buyer's engineers
without an SE in the room, which matters most precisely where there is
no SE. **Business-quant** (economics, finance, accounting) is the
classic band: numerate enough to build a business case and defend an
ROI model. Both cap at low severity and `possible` confidence, because
a field of study is weak evidence about how someone runs a deal.

#### The sales org registry — `lib/hiring/sales-org-registry.ts`

Backed by the **Elite Sales Organization Whitelist v1** (vendored at
`lib/hiring/data/elite-sales-orgs.v1.json`, README alongside it): 136
org records, 144 scored eras, 19 alias/acquisition mappings, spanning
1930 to present. This replaced a 26-entry hand-seeded list. It is a
versioned data product — update it by dropping in a new JSON, never by
editing entries in code.

Two ideas from the asset's `core_principles` do the real work:

**The logo is not the signal — the logo plus the ERA is.** Oracle 1994
and Oracle 2016 are different companies for talent assessment. Every
lookup resolves the era the candidate actually overlapped, preferring
the strongest overlapping window; a stint entirely outside every scored
era earns nothing. Verified: Oracle 1996–2001 fires green/high with the
"hyper-competitive up-or-out enterprise machine, 1988–2005" era named;
Oracle 2019–2023 fires nothing at all.

**Membership is a prior, not a verdict, and absence is NEUTRAL.** Not
being on the list is never a penalty — `lookupSalesOrg` returns null and
no flag renders. The asset caps org-era contribution at ~15% of an AE
score precisely so a logo can never clear a bar by itself.

The asset's signal flags are enforced as credit rules, not decoration:

| Flag | Effect |
|---|---|
| `negative_signal`, `not_a_sales_signal` | Credit → 0, no green flag (Palantir, CoreWeave) |
| `plg_overlay`, `ai_demand_capture`, `demand_capture_era` | Capped at Tier 2 + caveat demanding self-sourced-pipeline evidence |
| `too_new` | Credit halved pending reassessment |
| `era_bounded` | Handled by era resolution — out-of-window earns nothing |
| `toxic_but_successful`, `thin_data_provisional` | Credit unchanged, caveat attached |
| `mcmahon_lineage`, `meddic_culture`, `outbound_academy` | Feed the `methodology_lineage` flag |

Caveats travel **with** the credit into the flag evidence. A PLG overlay
or a churn-and-burn culture changes what a logo means, and hiding that
behind a green chip is how a list like this starts lying.

Three details that matter in practice. **Alias and acquisition
normalization** runs first — `TripActions`→Navan, `KeepTruckin`→Motive,
`Dell EMC`→EMC scored as the predecessor era. **Lineage-only strings**
(Zenefits, Meraki, Slack) resolve to zero credit while still recording
alumni pedigree, which is different from a miss. **`role_tier_overrides`**
can only improve a tier and only on an explicit role match — Figma is
Tier 1 for sales leadership, Tier 2 for a line AE.

`methodology_lineage` is a new green flag with no equivalent in the old
list: two or more orgs carrying MEDDIC / McMahon-guild / outbound-academy
markers, each in-era with 12+ months. One is a coincidence; a chain is a
deliberately-trained operator from a single tradition.

Account overrides (`HIGH_BAR_SALES_ORGS`) still layer on top, and still
matter — the asset itself flags US/English-language and survivorship
bias, and a regional org with a fearsome local reputation is exactly
what no global list will carry.

**How to keep extending it — the sources, cheapest first:**

1. **Curated seed** (done). ~25 orgs, deliberately conservative: a
   wrong entry silently inflates a candidate, which is worse than a
   missing entry that merely fails to credit one. Everything in it
   should be defensible to a skeptical sales leader in one sentence.
2. **Per-account overrides** (done — `HIGH_BAR_SALES_ORGS`, a
   GtmVariable singleton, no migration). The entries with the most
   signal are ones we'd never guess: the regional payroll company
   everyone in that city knows trains ferociously, the vertical SaaS
   leader in a niche of 400 buyers. Founders know those; we don't.
3. **Model-with-confidence-gate for the long tail.** Reuse the exact
   pattern already proven for company reads: ask for a reputation
   assessment plus a `basis`, accept only `high` confidence, and cache
   the verdict in a table keyed by company. Costs nothing extra per
   assessment after the first, and the cache compounds into a real
   registry rather than evaporating each run.
4. **Alumni-outcome signal** (the genuinely differentiated one). An
   academy is definitionally a place whose alumni go on to do well.
   PDL can answer "where did people who left Company X in 2015-2019
   land next, and did they climb?" A company whose leavers
   consistently progress at other high-bar orgs *is* an academy, and
   this measures it rather than asserting it. Expensive, so it belongs
   in a periodic batch job that promotes companies into the registry,
   not in the per-assessment path.
5. **Aggregate across accounts** — companies that recur in profiles
   graded `strong_fit`. Cheap, but treat with suspicion: it's a
   feedback loop that will happily confirm whatever the registry
   already believes. Useful as a *candidate* generator for human
   review, never as an automatic promoter.

The honest sequencing is 1+2 now (shipped), 3 next for the long tail
the asset doesn't cover, 4 when there's enough volume to justify the
batch spend, and 5 only ever as a suggestion queue for human review.
Per the asset's own maintenance note: the AI cohort needs a 6–12 month
review cadence, everything else annual, and today's Tier 1s (Samsara,
Rippling, Wiz) will drift toward Tier 2 as they scale.

### Axis 2 — Fit (LLM judgment over reconstructed facts)

For each *seller* role (filter out non-sales roles), compare:

1. **Stage match — ASYMMETRIC, and this is the whole trick.** Having
   sold at pre-seed/seed/Series A is the single most transferable thing
   on a résumé for a first sales hire, so it fires a `high` green flag
   (`early_stage_selling`, or `early_at_a_winner` where the company then
   scaled) and lifts the verdict.

   Its **absence is not a penalty**. There is deliberately no
   "never sold at early stage" red flag, and a stage gap on its own may
   never produce `stretch` or `likely_mismatch` — it belongs in
   `interviewProbes` and `whatWouldHaveToBeTrue`. Most good AEs have
   never worked at a seed company; that is the market, not a defect, and
   treating it as one made every single assessment read "stretch". The
   verdict moves down only for things about THIS candidate: a real
   tenure pattern, an unmet hard requirement in the hiring profile, or a
   contradicted claim. `weak` on the stage dimension is reserved for
   actual adverse evidence, never for missing evidence.
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

## The report — what's in it and why

Nine sections, ordered for a founder scanning on a phone. The first
three answer "should I spend another hour on this person"; the rest
answer "what do I do next".

1. **Verdict line.** One sentence a human would actually say: *"Strong
   operator, wrong stage — she's only ever carried a number with brand,
   SDRs and an SE behind her."* Plus the level
   (`strong_fit | worth_a_look | stretch | likely_mismatch`) and a
   confidence. A founder triaging 40 candidates reads only this.

2. **Career timeline with stage-at-tenure.** The evidence table, and
   the thing no résumé skim gives you: company · title · dates ·
   months · **what that company was while they were there** · fit
   chip. This is the artifact founders will stare at; it belongs above
   the flags, because the flags are conclusions drawn from it.

3. **Fit assessment — two halves.** Worth splitting, because they
   answer different questions:
   - *Against your stated profile:* each requirement in the AE Hiring
     Profile marked met / unmet / unknown, quoting the requirement.
     This is the founder's own criteria, honored literally.
   - *Against the structural dimensions:* stage, motion, category /
     buyer, deal shape, support structure — the five that predict
     whether founder-stage selling will transfer. Rated with the
     evidence behind each.

4. **Green flags.** Evidence-cited, not adjectives. "Stayed 3y2m at
   Rippling through Seed→B" beats "strong tenure."

5. **Red flags.** Same discipline, each with the computed number and
   the fairness caveat where one applies ("ended in the Nov-2023
   layoff window").

6. **Claims to verify.** Résumé-sourced assertions — quota attainment,
   self-sourced %, President's Club — listed as *unverified*, with any
   that contradict the reconstructed timeline called out. The gap
   between what someone claims and what's checkable is often the whole
   read.

7. **Interview focus.** Three to five probes tied to specific gaps,
   phrased as questions to ask. This is what turns the report into a
   next action.

8. **What we couldn't verify.** Mandatory. Named companies with no
   funding data, roles with ambiguous dates, an unmatched profile. A
   founder must be able to tell "no red flags" from "we couldn't see
   anything," and this section is also the legal spine — it's what
   keeps the report honest about its own limits.

9. **What would have to be true.** For anything short of `strong_fit`:
   the conditions under which this hire works anyway — *"you'd be
   their first no-brand sale; this works if you're willing to spend
   two quarters co-selling"*. It converts a mismatch into a decision
   the founder can make, rather than a rejection. This is the section
   that makes it a thinking tool instead of a filter.

Plus a small **backchannel** block: who to talk to (former managers /
peers at the best-fit company) and the one question to ask each.

**Deliberately excluded:** a numeric score (implies precision the data
can't carry, and is the most legally exposed presentation),
compensation estimates, and anything derived from name, photo,
location, or graduation year.

**The Slack reply is a subset**, not a different report: verdict,
timeline, top three flags, two probes, and the "drop their résumé too"
nudge. Everything else waits for the web view — with a link to it once
the UI exists.

```
{
  candidate: { name, headline, linkedinUrl, location, source },
  verdict:   { level, headline, confidence },
  timeline:  [{ company, title, start, end, months, isSales,
                stageAtStart, stageAtEnd, employeeEstimate,
                fundingBefore[], fundingDuring[], fitChip, confidence }],
  profileRequirements: [{ requirement, status: met|unmet|unknown, evidence }],
  fitDimensions:       [{ dimension, rating, rationale, evidence }],
  greenFlags: [{ claim, evidence, computed }],
  redFlags:   [{ claim, evidence, computed, fairnessCaveat? }],
  claims:     [{ text, kind, verified: false, source, contradicts? }],
  interviewProbes: [ "..." ],
  couldNotVerify:  [ "..." ],
  whatWouldHaveToBeTrue: [ "..." ],   // omitted when strong_fit
  backchannel: [{ who, why, askThem }]
}
```

## Data model

```prisma
model CandidateAssessment {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Which profile they were graded against (null = graded against
  // narrative/ICP/stage only, no hiring profile authored yet).
  hiringProfileVersionId String?

  // Groups every run for the same human so the UI can show a history
  // ("assessed Jul 3 · re-assessed Aug 11 against the new profile").
  // Normalized LinkedIn slug when we have one, else a name+employer
  // hash. Runs are IMMUTABLE — a re-grade writes a new row.
  candidateKey  String

  candidateName String
  linkedinUrl   String?
  source        String   // "pdl" | "pdf" | "pasted" | "manual" | "merged"
  sourceFiles   Json?    // [{ name, storagePath, kind: "resume"|"linkedin_pdf" }]

  rawProfile Json     // normalized timeline + PDL payloads + extracted
                      // claims, for re-runs without re-uploading

  // A report kept for months has to stay interpretable after the
  // rubric moves: stamp what produced it.
  rubricVersion String  // bump when the report contract changes
  model         String  // e.g. "gpt-5.5"
  assessment Json     // the output shape above
  verdict    String   // denormalized for list filtering/sorting
  roleLabel  String   @default("AE")   // AE | SDR | AM | CSM later

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, createdAt(sort: Desc)])
  @@index([userId, candidateKey, createdAt(sort: Desc)])
  @@map("candidate_assessments")
}
```

Storing `rawProfile` separately means re-grading against an updated
hiring profile costs one LLM call and zero PDL credits.

## Pipeline

```
LinkedIn URL  ·  résumé/LinkedIn PDF  ·  pasted text  ·  manual
  │
  ├─ URL      → PDL person/enrich (profile=<url>)   ~1 credit
  ├─ PDF      → extractTextFromPDFWithOCR → LLM extraction (+claims,
  │             PII stripped) — no PDL credit spent
  ├─ text     → same LLM extraction as PDF
  │    └─ any miss falls through to the next available source;
  │       when several exist, merge (URL/PDF facts win on dates,
  │       résumé contributes claims)
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

- **One intake control** at the top that takes any of it: a LinkedIn
  URL field, a drag-and-drop / click-to-browse zone for a résumé or
  LinkedIn PDF (the drop zone pattern already used on deal tiles and
  the asset library), and a "paste text instead" disclosure. Dropping
  a file and pasting a URL for the same candidate merges them.
- **Uploaded files stay attached** to the assessment, so the founder
  can reopen the résumé beside the read.
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

## Stage 0 — a Slack-callable tool (start here)

Ship the *judgment* before the UI. A founder is usually looking at a
candidate on their phone, in Slack, between calls — and the whole
value is the read, not a page. Stage 0 is one registered agent tool
and no new screens.

**Where it registers.** `GTM_TOOLS` in `src/lib/agents/gtm/tools.ts`
— a `Record<string, ToolEntry>`, so registration is literally one key,
and `getToolDefinitions()` picks it up automatically. The GTM agent is
the right home: a hiring question names no deal and carries no
coaching keyword, so the Slack router cascade already lands there.

```ts
assessCandidateProfile: {
  definition: { …, parameters: {
    linkedinUrl?: string,   // "https://linkedin.com/in/…"
    profileText?: string,   // pasted profile, résumé text, or the
                            // extracted text of an attached PDF
    candidateName?: string, // disambiguates a thin PDL match
    roleLabel?: string,     // defaults "AE"
  }},
  handler: …
}
```

**The PDF path is already free in Slack.** `extractFileContextForAgents()`
in `src/lib/slack/events.ts` extracts attached PDFs (with OCR
fallback) *before* the router cascade and appends the text to the
message the agents see. So "@Mikey what do you make of this
candidate" + a dropped `resume.pdf` arrives at the GTM agent as text
with **zero new plumbing** — the model passes it into `profileText`.
That makes "paste a PDF or résumé too" a prompt-and-description
concern, not an engineering one.

**What the handler does** (the same pipeline the web UI will use):
PDL person-enrich by URL → filter to sales roles → PDL company-enrich
each → reconstruct stage-at-tenure + compute tenure math in code →
one grading call against the hiring profile / narrative / ICP / stage
→ persist → return **structured data, not prose**. The agent narrates
in its own voice, consistent with every other tool in the registry.

**The Slack reply** should lead with the verdict, then the timeline
with stage-at-tenure per role (the part no résumé skim gives you),
then the top flags, then two or three interview probes — and close
with the nudge: *"Got their résumé or a LinkedIn PDF? Drop it here and
I'll read that too — it usually carries quota and self-sourced numbers
the profile doesn't."* That line is how the upload path gets
discovered.

**Persist from Stage 0.** It costs one additive migration and means
Slack-run assessments are already there when the web UI lands — plus
re-grading later doesn't re-spend PDL credits. Stateless would be
faster to ship and immediately regrettable.

**Routing hazard worth pre-empting.** The deal router claims any
message containing a distinctive token matching one of the founder's
deals — and a candidate's employer is very often a company they sell
to ("assess this rep, she was at Flock"). Two mitigations: treat a
`linkedin.com/in/` URL in the message as a hard defer signal in
`deal-agent-router`, and add hiring words ("candidate", "résumé",
"hiring", "AE we're interviewing") to the same guard. This is the
exact failure mode the partial-name matcher and the "synthesize" fix
hit earlier — cheaper to handle up front than to debug from a
screenshot.

## Phasing

0. **Stage 0 — the Slack tool (S/M).** Registered `assessCandidateProfile`,
   LinkedIn URL input, PDL enrichment, stage reconstruction, grading,
   persistence, Slack-formatted reply, résumé/PDF nudge (which already
   works via existing file context). Router guard. No UI.
1. **Phase 1 — the web read (M).** Schema + BOTH intake paths (PDL by
   URL, and résumé / LinkedIn-PDF upload with claim extraction and PII
   stripping) + company enrichment + stage reconstruction + tenure
   math + single grading call + result card + candidate list. One role
   type (AE). Shipping both inputs together de-risks the PDL match
   rate — if enrichment disappoints, the upload path already carries
   the feature.
2. **Phase 2 — depth (M).** Explicit upload control, multi-source merge polish,
   side-by-side compare, re-grade against a newer hiring profile,
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

- **PDL match rate on sales profiles** — still worth a spike on 10 real
  URLs, but with upload in Phase 1 it's no longer a single point of
  failure: a poor match rate just means the LinkedIn-PDF path leads
  and PDL becomes the convenience option.
- **Do uploaded résumés need a retention policy?** They're candidate
  PII sitting in storage. Proposal: delete the file when the
  assessment is deleted, and offer a "purge candidate" action —
  decide before Phase 1 since it shapes the storage path.
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
