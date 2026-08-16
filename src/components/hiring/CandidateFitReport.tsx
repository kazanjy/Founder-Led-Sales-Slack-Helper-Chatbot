"use client";

import { useState } from "react";

/**
 * Renders a candidate fit report.
 *
 * The flag sections are built server-side from the deterministic flag
 * engine, so this component's job is to preserve two things the design
 * depends on: severity has to be VISIBLE (not every flag deserves equal
 * weight), and discounted flags have to render rather than disappear —
 * showing the work is what makes the surviving flags credible.
 */

export interface NarratedFlagView {
  code: string;
  polarity: "red" | "green";
  severity: "critical" | "high" | "medium" | "low";
  confidence: "detected" | "possible";
  claim: string;
  evidence: string;
  companies: string[];
  suppressedBy?: string;
  /** Tenure-pattern flags carry no innocent explanation, by design. */
  noExcuses?: boolean;
  whyItMatters?: string | null;
  innocentExplanation?: string | null;
  probe?: string | null;
}

export interface TimelineRow {
  company: string;
  title: string;
  start: string | null;
  end: string | null;
  months: number | null;
  isSales: boolean;
  read?: {
    stageAtStart: string | null;
    stageAtEnd: string | null;
    employeeEstimate: string | null;
    motion: string | null;
    category: string | null;
    soldTo: string | null;
    basis: string | null;
    confidence: "high" | "medium" | "low";
    provenance: "model" | "funding_data" | "unknown";
  } | null;
}

export interface FitReport {
  verdict?: { level?: string; headline?: string; confidence?: string };
  redFlags?: NarratedFlagView[];
  greenFlags?: NarratedFlagView[];
  discountedFlags?: NarratedFlagView[];
  timeline?: TimelineRow[];
  fitDimensions?: Array<{ dimension: string; rating: string; rationale: string; evidence: string }>;
  profileRequirements?: Array<{ requirement: string; status: string; evidence: string }>;
  claims?: Array<{ text: string; kind: string; verified: boolean; contradicts: string | null }>;
  interviewProbes?: string[];
  couldNotVerify?: string[];
  whatWouldHaveToBeTrue?: string[];
  backchannel?: Array<{ who: string; why: string; askThem: string }>;
  rubric?: { roleLabel?: string; shortStintMonths?: number; rampMonths?: number; rubricVersion?: string };
  /** What the grade actually rested on — see the banner below. */
  gradedAgainst?: {
    hiringProfile?: boolean;
    hiringProfileVersionId?: string | null;
    hiringProfileTitle?: string | null;
    hiringProfileAccount?: string | null;
    icp?: boolean;
    maturityStage?: string | null;
  };
  candidate?: { name?: string; headline?: string | null; linkedinUrl?: string | null; source?: string };
}

const VERDICT_STYLES: Record<string, { label: string; cls: string; emoji: string }> = {
  strong_fit: {
    label: "Strong fit",
    cls: "bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-100",
    emoji: "🎯",
  },
  worth_a_look: {
    label: "Worth a look",
    cls: "bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-100",
    emoji: "🔍",
  },
  stretch: {
    label: "Stretch",
    cls: "bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100",
    emoji: "🤔",
  },
  likely_mismatch: {
    label: "Likely mismatch",
    cls: "bg-rose-50 border-rose-300 text-rose-900 dark:bg-rose-950 dark:border-rose-700 dark:text-rose-100",
    emoji: "🚧",
  },
};

const SEVERITY_CHIP: Record<string, string> = {
  // Critical inverts to a solid fill — at a glance it has to read as a
  // different class of finding, not a slightly darker "high".
  critical: "bg-rose-600 text-white dark:bg-rose-500 dark:text-white",
  high: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  low: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
};

const RATING_CHIP: Record<string, string> = {
  strong: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  adequate: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  weak: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100",
  unknown: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  met: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  unmet: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100",
};

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
        {title}
        {count != null && <span className="ml-2 font-normal normal-case">({count})</span>}
      </h3>
      {children}
    </section>
  );
}

function FlagCard({ flag }: { flag: NarratedFlagView }) {
  const red = flag.polarity === "red";
  const critical = flag.severity === "critical";
  return (
    <div
      className={`rounded-lg border p-4 ${
        critical
          ? "border-rose-500 border-2 bg-rose-50 dark:border-rose-500 dark:bg-rose-950/70"
          : red
            ? "border-rose-200 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/40"
            : "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/40"
      }`}
    >
      <div className="flex items-start gap-2 flex-wrap">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${SEVERITY_CHIP[flag.severity]}`}>
          {flag.severity}
        </span>
        {flag.confidence === "possible" && (
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            title="Rests on year-only dates or a fuzzy company match — treat the number as approximate."
          >
            approximate
          </span>
        )}
        <p className="font-medium text-gray-900 dark:text-gray-100 flex-1 min-w-[12rem]">{flag.claim}</p>
      </div>

      {flag.whyItMatters && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">{flag.whyItMatters}</p>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-mono break-words">{flag.evidence}</p>

      {red && flag.innocentExplanation && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-3 pl-3 border-l-2 border-gray-300 dark:border-gray-600">
          <span className="font-medium text-gray-700 dark:text-gray-300">Could just as easily be: </span>
          {flag.innocentExplanation}
        </p>
      )}

      {flag.probe && (
        <p className="text-sm mt-2 text-purple-700 dark:text-purple-300">
          <span className="font-medium">Ask: </span>
          {flag.probe}
        </p>
      )}
    </div>
  );
}

export function CandidateFitReport({ report }: { report: FitReport }) {
  const [showDiscounted, setShowDiscounted] = useState(false);

  const verdict = report.verdict || {};
  const style = VERDICT_STYLES[verdict.level || ""] || VERDICT_STYLES.worth_a_look;
  const red = report.redFlags || [];
  const green = report.greenFlags || [];
  const discounted = report.discountedFlags || [];

  return (
    <div>
      {/* Verdict */}
      <div className={`rounded-xl border-2 p-5 mb-6 ${style.cls}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">{style.emoji}</span>
          <span className="font-bold uppercase text-xs tracking-wider">{style.label}</span>
          {verdict.confidence && (
            <span className="text-xs opacity-75">· {verdict.confidence} confidence</span>
          )}
        </div>
        <p className="text-lg font-medium">{verdict.headline || "No headline returned."}</p>
        {report.rubric?.shortStintMonths != null && (
          <p className="text-xs opacity-70 mt-2">
            Graded as {report.rubric.roleLabel || "AE"} · short stint = under {report.rubric.shortStintMonths}mo ·
            assumed ramp {report.rubric.rampMonths}mo · rubric {report.rubric.rubricVersion}
          </p>
        )}
      </div>

      {/* What the grade rested on, stated as fact rather than left to
          the model's narration. The whole point of a fit assessment is
          that it's measured against YOUR bar, so silently falling back
          to generic criteria is the one failure that must never be
          invisible — it's exactly how a lookup bug went unnoticed. */}
      {report.gradedAgainst && (
        <div
          className={`rounded-lg border px-4 py-3 mb-6 text-sm ${
            report.gradedAgainst.hiringProfile
              ? "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          }`}
        >
          {report.gradedAgainst.hiringProfile ? (
            <>
              <span className="font-medium">
                ✓ Graded against
                {report.gradedAgainst.hiringProfileAccount
                  ? ` ${report.gradedAgainst.hiringProfileAccount}'s AE Hiring Profile`
                  : " your AE Hiring Profile"}
              </span>
              {report.gradedAgainst.maturityStage && (
                <> · stage {report.gradedAgainst.maturityStage.replace(/_/g, " ").toLowerCase()}</>
              )}
              {report.gradedAgainst.icp && <> · your ICP</>}
              {report.gradedAgainst.hiringProfileVersionId && (
                <>
                  {" · "}
                  <a
                    className="underline hover:no-underline"
                    href={`/hiring-profile?version=${report.gradedAgainst.hiringProfileVersionId}`}
                  >
                    view the profile used
                  </a>
                </>
              )}
            </>
          ) : (
            <>
              <span className="font-medium">⚠ No AE Hiring Profile was found</span> — this was graded
              against your sales narrative, ICP and stage instead.{" "}
              <a className="underline hover:no-underline" href="/hiring-profile">
                Author one
              </a>{" "}
              and re-run for a sharper read.
            </>
          )}
        </div>
      )}

      {green.length > 0 && (
        <Section title="✅ Green flags" count={green.length}>
          <div className="space-y-3">
            {green.map((f, i) => (
              <FlagCard key={`${f.code}-${i}`} flag={f} />
            ))}
          </div>
        </Section>
      )}

      {red.length > 0 && (
        <Section title="🚩 Red flags" count={red.length}>
          <div className="space-y-3">
            {red.map((f, i) => (
              <FlagCard key={`${f.code}-${i}`} flag={f} />
            ))}
          </div>
        </Section>
      )}

      {/* The discounted section is the trust mechanism: it shows what the
          rules considered and deliberately set aside, with the reason. */}
      {discounted.length > 0 && (
        <section className="mb-6">
          <button
            onClick={() => setShowDiscounted((v) => !v)}
            className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 flex items-center gap-1.5"
          >
            <span className={`transition-transform ${showDiscounted ? "rotate-90" : ""}`}>▸</span>
            Considered and discounted ({discounted.length})
          </button>
          {showDiscounted && (
            <div className="mt-3 space-y-3 opacity-80">
              {discounted.map((f, i) => (
                <div
                  key={`${f.code}-${i}`}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4"
                >
                  <p className="text-gray-700 dark:text-gray-300 line-through decoration-gray-400">{f.claim}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1.5">
                    <span className="font-medium">Discounted: </span>
                    {f.suppressedBy}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1.5 font-mono break-words">{f.evidence}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Timeline — the differentiated read: what each company WAS. */}
      {(report.timeline || []).length > 0 && (
        <Section title="🏢 Timeline — what each company was at the time">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-3 font-medium">Company</th>
                  <th className="py-2 pr-3 font-medium">Title</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">Dates</th>
                  <th className="py-2 pr-3 font-medium">Tenure</th>
                  <th className="py-2 pr-3 font-medium">Stage while there</th>
                  <th className="py-2 font-medium">Motion / buyer</th>
                </tr>
              </thead>
              <tbody>
                {(report.timeline || []).map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-800 align-top">
                    <td className="py-2.5 pr-3 font-medium text-gray-900 dark:text-gray-100">
                      {r.company}
                      {r.isSales && <span className="ml-1.5 text-[10px] text-purple-600 dark:text-purple-400">SALES</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300">{r.title}</td>
                    <td className="py-2.5 pr-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {r.start || "?"} – {r.end || "present"}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {r.months != null ? `${r.months}mo` : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300">
                      {r.read?.stageAtStart ? (
                        <span title={r.read.basis || undefined}>
                          {r.read.stageAtStart}
                          {r.read.stageAtEnd && r.read.stageAtEnd !== r.read.stageAtStart
                            ? ` → ${r.read.stageAtEnd}`
                            : ""}
                          {/* Provenance is load-bearing: a modelled stage
                              and a funding-verified one are not the same
                              claim, and the report must not blur them. */}
                          <span
                            className="ml-1.5 text-[10px] text-gray-400"
                            title={
                              r.read.provenance === "funding_data"
                                ? "Verified against funding data"
                                : "From model knowledge — not independently verified"
                            }
                          >
                            {r.read.provenance === "funding_data" ? "✓" : "~"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">not established</span>
                      )}
                      {r.read?.employeeEstimate && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{r.read.employeeEstimate}</div>
                      )}
                    </td>
                    <td className="py-2.5 text-gray-600 dark:text-gray-400 text-xs">
                      {r.read?.motion && <div>{r.read.motion}</div>}
                      {r.read?.soldTo && <div className="text-gray-500 dark:text-gray-500">{r.read.soldTo}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* A hover tooltip is not a legend. The difference between a
              funding-verified stage and a modelled one changes how much
              weight the row deserves, so it has to be readable at rest. */}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            <span className="font-medium">✓</span> verified against funding data ·{" "}
            <span className="font-medium">~</span> from model knowledge, not independently verified
          </p>
        </Section>
      )}

      {(report.fitDimensions || []).length > 0 && (
        <Section title="📐 Fit dimensions">
          <div className="space-y-2">
            {(report.fitDimensions || []).map((d, i) => (
              <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${RATING_CHIP[d.rating] || RATING_CHIP.unknown}`}>
                    {d.rating}
                  </span>
                  <span className="font-medium text-gray-900 dark:text-gray-100 capitalize">
                    {d.dimension.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-1.5">{d.rationale}</p>
                {d.evidence && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{d.evidence}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {(report.profileRequirements || []).length > 0 && (
        <Section title="📋 Against your AE hiring profile">
          <div className="space-y-2">
            {(report.profileRequirements || []).map((r, i) => (
              <div key={i} className="flex gap-3 items-start">
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${
                    RATING_CHIP[r.status] || RATING_CHIP.unknown
                  }`}
                >
                  {r.status}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{r.requirement}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{r.evidence}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(report.claims || []).length > 0 && (
        <Section title="💬 Their claims — unverified">
          <div className="space-y-2">
            {(report.claims || []).map((c, i) => (
              <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-sm text-gray-900 dark:text-gray-100">&ldquo;{c.text}&rdquo;</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{c.kind}</p>
                {c.contradicts && (
                  <p className="text-sm text-rose-700 dark:text-rose-300 mt-1.5">
                    <span className="font-medium">Contradicts: </span>
                    {c.contradicts}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {(report.interviewProbes || []).length > 0 && (
        <Section title="🎤 Ask them">
          <ul className="space-y-1.5">
            {(report.interviewProbes || []).map((p, i) => (
              <li key={i} className="text-sm text-gray-800 dark:text-gray-200 flex gap-2">
                <span className="text-purple-600 dark:text-purple-400">→</span>
                {p}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(report.backchannel || []).length > 0 && (
        <Section title="🤝 Worth backchanneling">
          <div className="space-y-2">
            {(report.backchannel || []).map((b, i) => (
              <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <p className="font-medium text-sm text-gray-900 dark:text-gray-100">{b.who}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{b.why}</p>
                <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">&ldquo;{b.askThem}&rdquo;</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(report.whatWouldHaveToBeTrue || []).length > 0 && (
        <Section title="🧩 What would have to be true">
          <ul className="space-y-1.5">
            {(report.whatWouldHaveToBeTrue || []).map((w, i) => (
              <li key={i} className="text-sm text-gray-800 dark:text-gray-200 flex gap-2">
                <span className="text-gray-400">·</span>
                {w}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(report.couldNotVerify || []).length > 0 && (
        <Section title="❓ Couldn't verify">
          <ul className="space-y-1.5">
            {(report.couldNotVerify || []).map((c, i) => (
              <li key={i} className="text-sm text-gray-600 dark:text-gray-400 flex gap-2">
                <span className="text-gray-400">·</span>
                {c}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-4 mt-6">
        Decision support, not a decision. Flags are evidence-backed prompts for a conversation — a human makes the
        call. Résumé claims are unverified by definition.
      </p>
    </div>
  );
}
