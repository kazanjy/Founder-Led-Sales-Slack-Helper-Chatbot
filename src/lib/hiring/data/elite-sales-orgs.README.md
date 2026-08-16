# Elite Sales Organization Whitelist — Unified Resume-Assessment Asset (v1.0.0)

A single machine-readable asset (`elite_sales_org_whitelist_v1.json`) that an app can consume to score the **organization-era component** of an AE or sales-leader resume. It synthesizes three source documents into one reconciled data product: 136 organization records spanning 1930 → present, a unified tier scale, alumni lineages, signal flags, embedded scoring rubrics, credit-adjustment rules, and interview verification prompts.

> **The one thing to remember:** whitelist membership is a *prior, not a verdict*. The org-era signal is deliberately capped (15 of 100 points for AEs, 10 of 100 for leaders) and can never by itself clear a hiring bar. Individual attainment, role difficulty, and skills transfer — scored in the rubrics — are what actually move the decision. Absence from the list is **neutral**, never a penalty.

---

## 1. Sources and how they were reconciled

| Source id | Role in the synthesis |
|---|---|
| `original_whitelist` | Primary curated list (prepared for Pete Kazanjy, Aug 2026): tier definitions, classic-through-modern org windows, the grit-filter tier, the PTC/McMahon lineage, anti-signals, screening application. |
| `deep_research_report` | Evidence-graded research: the 12-criterion org scorecard, AE/leader rubrics, credit-adjustment table, era normalization, public-metric evidence. |
| `modern_addendum` | The 2015–2026 cohort: tiering, Israeli-GTM and Silicon-Slopes schools, PLG-overlay and AI-demand-capture rules, and explicit corrections to the original list. |

**Reconciliation policy** (encoded in `meta.reconciliation_policy`):

1. **Addendum corrections win.** Where the addendum states an explicit update (Ramp → Tier 1, Brex era bounds, Rippling addition, Dropbox codification, Navan addition, Palantir negative flag, Toast Tier 1 era reconfirmation, the post-2022 caveat block), that correction takes precedence.
2. **Tier conflicts are averaged.** Where the original list and the research report grade the same org-era differently, the unified tier is the average rounded to the nearest 0.5, with ambiguous quarters rounding toward the *weaker* (higher-number) tier. Both source grades are preserved in the record's `reconciliation_note`.
3. **Era windows take the union** of the source windows; `peak_window` marks the strongest overlapping years.
4. **Grouped rows are split.** Source rows that bundle companies (`Veritas / NetApp`, `Paycom / Paylocity`, `Loom / Calendly`, `Melio / Airwallex`, …) become separate records sharing the grouped rationale, noted in `reconciliation_note`.

---

## 2. Top-level structure

```
{
  "meta":                          versioning, sources, reconciliation policy, known gaps, maintenance
  "core_principles":               the guardrails (prior-not-verdict, points cap, missing-data policy, …)
  "inclusion_criteria":            what earns a place on the list
  "tier_definitions":              the unified 1 / 1.5 / 2 / 2.5 / 3 scale + formal decision rules
  "signal_flag_definitions":       what each flag means and how to act on it
  "regional_schools":              Israeli GTM + Silicon Slopes (Utah) clusters
  "acquisition_and_alias_mappings":resume-string → org-id normalization (renames, acquisitions, lineage-only)
  "lineages":                      the alumni/"mafia" graph (Zenefits, McMahon guild, Meraki, Snowflake, …)
  "scoring":                       org scorecard, AE + leader rubrics, credit adjustments, tenure rules,
                                   anti-signals, positive patterns, interpretation bands, interview checklist
  "organizations":                 the 136 org records (the heart of the asset)
  "application_logic":             the deterministic per-stint pipeline + a worked example
  "data_caveats":                  reliability warnings (RepVue, ARR sources, thin data, biases)
  "watchlist":                     named-but-not-tiered entities (lineage-only nodes, untiered school members)
}
```

---

## 3. The `organizations` record schema

Every record is shaped like this (optional fields omitted when empty):

```json
{
  "id": "navan",
  "name": "Navan",
  "category": "hr_fintech_ops",
  "sector": "Travel & expense",
  "primary_motion": "aggressive outbound SDR/AE motion",
  "aliases": ["TripActions"],
  "signal_flags": ["era_bounded"],
  "eras": [
    {
      "start": 2017, "end": 2021,
      "tier": 2,
      "label": "pre-COVID elite era",
      "rationale": "…one-sentence why…",
      "peak_window": [2017, 2019],          // optional
      "trend": "…",                          // optional
      "caveats": ["…"],                      // optional
      "evidence": { "key_facts": ["…"], "repvue": 0 }  // optional
    }
  ],
  "role_tier_overrides": { "sales_leadership": 1 },     // optional
  "notable_leaders": ["…"],                             // optional
  "alumni_to": ["figma"],                               // optional, references other ids
  "resume_guidance": "…",                               // optional
  "sources": ["modern_addendum"],
  "reconciliation_note": "…"                            // optional, present on reconciled/split records
}
```

**Field notes**

- `eras` is a **list** because an org's quality changes over time. Score the era the candidate actually worked, not the brand's best era. `end: null` means "through present."
- `tier` on an era is the unified numeric tier (see §4).
- `role_tier_overrides` handles orgs where the tier depends on the role — e.g., Figma is Tier 1 for `sales_leadership` (the Parrish tree) but Tier 2 for a line AE.
- Segment dependence (e.g., Stripe's enterprise arm, HubSpot enterprise vs. velocity, Workday/CrowdStrike large-enterprise) is captured in the era `rationale`/`caveats` and encoded as a `.5` tier — resolve upward only with segment evidence.
- `evidence.repvue` and `evidence.key_facts` carry the corroborating public metrics; treat them as directional (see §8).

**Categories in use:** `classic_academies`, `onprem_enterprise`, `saas_wave_1`, `modern_cloud`, `hr_fintech_ops`, `security_modern`, `beyond_tech` (medtech / staffing / logistics / insurance). Category is coarse; `sector` carries the fine detail.

---

## 4. Tier scale

The two source tier systems (Roman I/II/III and Arabic 1/2/3, plus split ratings like "I/II" and "2/3") are merged into one numeric scale. Split ratings become **midpoints**.

| Tier | Label | Resume interpretation |
|---|---|---|
| **1** | Canonical sales school | Meaningful positive prior. |
| **1.5** | Canonical/strong boundary | Positive prior; Tier 1 only for specific segments/roles (validate). |
| **2** | Strong | Positive prior; validate segment. |
| **2.5** | Strong/contextual boundary | Small-to-moderate prior; probe caveats. |
| **3** | Contextual | Small prior only; require strong individual evidence (or a demand-capture environment). |

Two non-numeric states also exist (`tier_definitions.extra_states`): **gray** (quality too low / evidence too weak — do not use the logo as a positive signal) and **exclude/negative** (adverse evidence — a potential *negative* prior; see the `negative_signal` flag).

---

## 5. Signal flags (and what to do with each)

Defined in `signal_flag_definitions`; act on them in the pipeline (§7, step 5).

| Flag | Meaning / action |
|---|---|
| `plg_overlay` | Sales overlays huge inbound/expansion tailwind. **Cap at Tier 2** unless the resume shows self-sourced pipeline ≥ 30–40%, net-new logos, or founding/early-team status. |
| `ai_demand_capture` | 2023–2026 AI org where "sales" can mean order-taking. Same cap as PLG; **reassess every 6–12 months**. |
| `negative_signal` | Adverse sales-org evidence (e.g., Palantir). The logo may be a **negative** prior despite brand/stock success → set org credit to 0 and probe. |
| `not_a_sales_signal` | Revenue from concentrated mega-deals / non-repeatable dynamics (e.g., CoreWeave; Loom/Calendly PLG) → 0 org credit. |
| `toxic_but_successful` | Churn-and-burn/culture caveats (ServiceTitan, Verkada, Tanium). No auto-change, but weight quota evidence and probe "what did the rep actually control." |
| `era_bounded` | Credit is confined to the stated elite era; discount tenure beginning after the caveat date. |
| `too_new` | < ~3 years as an academy (Cursor, Sierra, Harvey, Anthropic) → cap credit, set reassessment flag. |
| `thin_data_provisional` | Tiered on thin independent data (Adyen, Bill.com, Postman, …) → validate before heavy weighting. |
| `israeli_gtm_school` / `silicon_slopes_school` | Positive pedigree markers (Wiz/Gong/monday; Qualtrics/Podium/Divvy/Lucid/Weave). Qualitative, not a numeric multiplier bump. |
| `meddic_culture` / `outbound_academy` | Documented qualification discipline / outbound pipeline-gen rigor — genuine skill-builders; route to matching interview probes. |

---

## 6. Lineages, schools, and normalization

- **`lineages`** is the alumni graph — the NCR/Patterson tradition, the McMahon guild (PTC → the MEDDIC diaspora), the Oracle tree, the EMC mafia, the Xerox/IBM schoolhouse, plus modern branches (Zenefits → Rippling/Brex, AWS → Stripe, Meraki → Samsara/Verkada, Snowflake/MEDDIC diaspora, Slack/Wiz → OpenAI, Stripe → Anthropic, ADP → Dropbox → Figma). Use these as corroborating pedigree, not as points.
- **`regional_schools`** captures the Israeli-GTM and Silicon-Slopes (Utah) clusters, including members named in the sources but never individually tiered (Domo, Pluralsight, MX) — those live in the `watchlist`, not as scored records.
- **`acquisition_and_alias_mappings`** is the normalization table the pipeline consults first: renames (`TripActions` → `navan`, `KeepTruckin` → `motive`, `Anysphere` → `cursor`), acquisitions with predecessor-vs-acquirer rules (EMC/Dell, Wiz/Google closed 2026-03-11, Divvy/Bill, Qualtrics/SAP, HashiCorp/IBM), and **lineage-only** strings that resolve to `null` (Zenefits, Meraki, Slack) — those award **zero** org points but record a lineage marker.

---

## 7. Application logic — the per-stint pipeline

`application_logic.pipeline` is the deterministic sequence an app runs for each resume stint. Summary:

1. **Normalize** the employer string → org id (aliases, then acquisition mappings). `null` map → 0 points + lineage marker. No match → gray (0), never a penalty.
2. **Resolve era** by overlapping stint dates with era windows; compute `months_in_era`. A stint entirely *after* an `era_bounded` elite era is heavily discounted.
3. **Select base tier** from the era (apply `role_tier_overrides`; confirm segment for `.5` tiers).
4. **Base credit** from `application_logic.tier_base_credit_suggestion.by_tier` → `{1: 1.0, 1.5: 0.875, 2: 0.8, 2.5: 0.55, 3: 0.35}`. *(These are adjustable synthesis defaults, not values from the sources.)*
5. **Apply flag rules** in order (negative/not-a-signal → 0; PLG/AI → cap at Tier 2 unless pipeline evidence; too_new → cap; era_bounded → discount if out of window; toxic → probe; schools → qualitative).
6. **Apply credit adjustments** from `scoring.whitelist_credit_adjustments` (exact-era + quota-carrying role + adequate ramp = 100%; acquirer-listed-without-working-in-system = 0–25%; below-median individual evidence overrides the halo to 0).
7. **Apply tenure adjustment** from `scoring.tenure_rules` (≥ 18–24 months = full credit; sub-12-month "tourist" stints discounted; account for ramp/time-at-risk).
8. **Compute points:** `org_era_points = round(budget × final_multiplier)`, clamped to `[0, budget]`, where `budget` = 15 (AE) or 10 (leader).
9. **Emit interview probes** from `scoring.verification_checklist`, prioritized by the flags/caveats that fired.

A full **worked example** (Navan AE, 2018–2021) is embedded in `application_logic.worked_example`, tracing all nine steps to 12/15 org-era points — and reminding the reader that 12/15 is a strong prior, not a hire.

The individual-evidence side lives in `scoring.ae_rubric` (100 pts: quota repeatability 30, org-era 15, complexity 15, new-logo 10, process 10, progression 10, integrity 10) and `scoring.sales_leader_rubric` (100 pts: team distribution 20, hiring/ramp 15, process/forecast 15, personal selling 10, scope 10, retention 10, org-era 10, progression 5, integrity 5), with `scoring.interpretation_bands` mapping totals to actions (≈85–100 priority interview … < 55 reject).

---

## 8. Data caveats (read before trusting any single number)

From `data_caveats`:

- **RepVue** scores are self-reported, fluctuate monthly, and skew negative — directional only.
- **ARR / "fastest-to-$100M"** figures come from company blogs, VC newsletters, and podcasts — self-interested; approximate corroboration, not proof of individual skill.
- **Thin-data** orgs (Adyen, Bill.com, Mercury, Personio, Abnormal, Arctic Wolf, Postman) are tiered provisionally.
- **AI-cohort** tiers are the most time-sensitive — reassess every 6–12 months.
- This asset assesses **sales-org quality as a resume signal**, not company/investment/product quality. A great stock can be a weak sales signal.
- Expect **US / English-language bias** and **survivorship bias**. Absence is neutral.
- The **biggest evidence gaps** — quota-attainment distribution, stage-normalized win rate, median deal size, internal stack adoption — are the least public. Move these from desk research to candidate self-report and reference checks. **Unspecified is never zero** and never silently back-filled with a proxy.

---

## 9. Maintenance

Treat this as a **versioned data product**, not folklore. Log every tier/era change in `meta.changelog`. Today's Tier 1s (Samsara, Rippling, Wiz) will drift toward Tier 2 as they scale, and new academies are being founded now — so the AI cohort gets a 6–12 month review cadence and the rest an annual revisit. Re-supplying any newly discovered source rows can promote entries from the `watchlist` into full records in a future v1.1.0.
