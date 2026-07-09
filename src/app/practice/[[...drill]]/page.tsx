"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import SalesNavBar from "@/components/SalesNavBar";
import { VoiceRecordingInput } from "@/components/VoiceRecordingInput";

/**
 * Practice suite home + drill runner (see practice-suite-plan.md).
 * Live drills: Pre-Call Planning, Rapport; Agenda / Discovery render
 * as coming-soon cards.
 *
 * Routes (optional catch-all): /practice is the home; each drill has
 * its own SHAREABLE page — /practice/precall-planning,
 * /practice/rapport, … — drop one in Slack as a "do this" link. The
 * drill page shows the description, a big Start button, and that
 * drill's full history (scenario + grade, click to reopen the report
 * card + reveal).
 *
 * Flow: start drill → POST /api/practice/sessions (persona
 * synthesized server-side, hidden dossier NOT sent) → founder answers
 * the quiz off the public card → POST grade → report card + reveal.
 * On grade, the NEXT scenario prefetches in the background so
 * "Practice Again" is instant.
 */

interface PersonaPublic {
  name: string;
  title: string;
  company: { name: string; industry: string; size: string; blurb: string };
  bio: string;
  breadcrumbs: string[];
}

interface PersonaHidden {
  orgPersona: string;
  humanPersona: string;
  pains: string[];
  currentState: string;
  compellingEvent: string;
  valuePropsThatLand: string[];
  valuePropsThatDont: string[];
  temperament: string;
  objections: string[];
}

interface SessionShape {
  id: string;
  drill: string;
  mode: string | null;
  status: string;
  persona: {
    public: PersonaPublic;
    quiz: { orgPersonaOptions: string[]; humanPersonaOptions: string[]; valueProps: string[] };
    hidden?: PersonaHidden;
  };
  turns: Array<{ role: string; text: string }> | null;
  answers: Record<string, unknown> | null;
  score: {
    overall: string;
    dimensions: Array<{ name: string; score: number; max: number; comment: string }>;
    modelAnswer: string;
    nextRep: string;
    flags?: string[];
    alternatives?: string[];
  } | null;
  createdAt: string;
  completedAt: string | null;
}

const DRILLS = [
  {
    key: "precall_plan",
    emoji: "🗺️",
    label: "Pre-Call Planning",
    description:
      "A meeting just landed on your calendar. Read the buyer's card, call the persona, pick your angle, and map which value props land — then see how you did.",
    available: true,
  },
  {
    key: "rapport",
    emoji: "🤝",
    label: "Rapport",
    description: "Deliver your icebreaker against a fresh buyer card — out loud or typed. Graded on warmth, humor, and picking a PERSONAL thread (business topics are research, not rapport).",
    available: true,
  },
  {
    key: "agenda",
    emoji: "📋",
    label: "Agenda Setting",
    description: "Run your agenda set + elevator pitch out loud — script visible or from memory — against the clock.",
    available: false,
  },
  {
    key: "discovery",
    emoji: "🔍",
    label: "Discovery",
    description: "Live discovery roleplay: ask questions by voice, the buyer answers in character, get graded on second-level digging.",
    available: false,
  },
];

function drillInfo(key: string) {
  return DRILLS.find((d) => d.key === key) || DRILLS[0];
}

// URL slugs for shareable per-drill pages — /practice/precall-planning
// etc. Slug → drill key, plus the reverse for building links.
const DRILL_SLUGS: Record<string, string> = {
  "precall-planning": "precall_plan",
  rapport: "rapport",
  "agenda-setting": "agenda",
  discovery: "discovery",
};
const SLUG_BY_DRILL: Record<string, string> = Object.fromEntries(
  Object.entries(DRILL_SLUGS).map(([slug, key]) => [key, slug])
);

function gradeColor(overall: string): string {
  const letter = overall.charAt(0).toUpperCase();
  if (letter === "A") return "text-green-600 dark:text-green-400";
  if (letter === "B") return "text-emerald-600 dark:text-emerald-400";
  if (letter === "C") return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Letter grade → 0-4.3 points for trend math (display stays letters).
function gradePoints(overall: string): number {
  const base: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  const letter = overall.charAt(0).toUpperCase();
  let pts = base[letter] ?? 0;
  if (overall.includes("+")) pts += 0.3;
  if (overall.includes("-")) pts -= 0.3;
  return Math.max(0, pts);
}

/** Tiny inline trend line of recent grades, oldest → newest. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 72;
  const h = 20;
  const max = 4.3;
  const step = w / (points.length - 1);
  const coords = points
    .map((p, i) => `${(i * step).toFixed(1)},${(h - (p / max) * (h - 2) - 1).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="text-purple-400 dark:text-purple-500" aria-hidden>
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Consecutive-day streak (ending today or yesterday) over completed
// sessions. Day-granular and timezone-local — good enough for a gym.
function computeStreak(sessions: Array<{ completedAt: string | null }>): number {
  const days = new Set(
    sessions
      .filter((s) => s.completedAt)
      .map((s) => new Date(s.completedAt!).toDateString())
  );
  if (days.size === 0) return 0;
  let streak = 0;
  const cursor = new Date();
  // Allow the streak to survive if today has no rep yet.
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function PracticePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ drill?: string[] }>();
  const sessionId = searchParams.get("session");

  // Focused-drill mode when the URL carries a slug
  // (/practice/rapport). Unknown slugs fall back to the home view.
  const slug = params.drill?.[0] || null;
  const focusedDrill = slug ? DRILL_SLUGS[slug] || null : null;
  const basePath = focusedDrill ? `/practice/${SLUG_BY_DRILL[focusedDrill]}` : "/practice";

  const [history, setHistory] = useState<SessionShape[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  // Which drill's Start button is working (per-drill so one click
  // doesn't throb every card).
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const [session, setSession] = useState<SessionShape | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);

  // Quiz form state
  const [orgPersona, setOrgPersona] = useState("");
  const [humanPersona, setHumanPersona] = useState("");
  const [angle, setAngle] = useState("");
  const [propsLand, setPropsLand] = useState<Set<string>>(new Set());
  // Rapport drill state — two-turn roleplay: icebreaker → buyer
  // responds → pivot. Voice recording targets whichever step is live.
  const [icebreaker, setIcebreaker] = useState("");
  const [pivot, setPivot] = useState("");
  const [recordingFor, setRecordingFor] = useState<"icebreaker" | "pivot" | null>(null);
  const [sendingTurn, setSendingTurn] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [loadingHint, setLoadingHint] = useState(false);
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  // Next-scenario prefetch: as soon as a grade lands we generate the
  // next session in the background so "Practice again" is instant —
  // persona synthesis takes ~10-20s and shouldn't sit between reps.
  const [nextSession, setNextSession] = useState<SessionShape | null>(null);
  const [prefetching, setPrefetching] = useState(false);

  const streak = useMemo(() => computeStreak(history), [history]);
  const sparkByDrill = useMemo(() => {
    const map = new Map<string, number[]>();
    // History arrives newest-first; sparkline wants oldest → newest.
    for (const s of [...history].reverse()) {
      if (!s.score) continue;
      const arr = map.get(s.drill) || [];
      arr.push(gradePoints(s.score.overall));
      map.set(s.drill, arr.slice(-10));
    }
    return map;
  }, [history]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      // Focused drill pages show that drill's full history; the home
      // shows a recent cross-drill slice.
      const query = focusedDrill ? `drill=${focusedDrill}&limit=100` : "limit=30";
      const res = await fetch(`/api/practice/sessions?${query}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.sessions || []);
      }
    } catch {
      /* empty history */
    } finally {
      setLoadingHistory(false);
    }
  }, [focusedDrill]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Load the session in focus; reset quiz state on change.
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }
    let cancelled = false;
    setLoadingSession(true);
    setOrgPersona("");
    setHumanPersona("");
    setAngle("");
    setPropsLand(new Set());
    setIcebreaker("");
    setPivot("");
    setRecordingFor(null);
    setHint(null);
    setGradeError(null);
    (async () => {
      try {
        const res = await fetch(`/api/practice/sessions/${sessionId}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSession(data.session);
        }
      } catch {
        /* stays null */
      } finally {
        if (!cancelled) setLoadingSession(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const prefetchNext = useCallback(async (drill: string) => {
    setPrefetching(true);
    setNextSession(null);
    try {
      // mode:"warm" marks background-created sessions so the history
      // list can hide them until they're actually attempted.
      const res = await fetch("/api/practice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drill, mode: "warm" }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.session) setNextSession(data.session);
      // Failure is silent — the button just falls back to generating
      // on click, same as before prefetch existed.
    } catch {
      /* fall back to on-click generation */
    } finally {
      setPrefetching(false);
    }
  }, []);

  // Warm-pool: pre-generate one scenario per live drill in the
  // background when the page loads, so the FIRST click of Start is as
  // instant as Practice Again after a grade. Self-limiting — we only
  // warm a drill that has no active (unattempted) session, and
  // starting a drill consumes the warm session, so steady state is
  // ~1 spare per drill.
  const warmingRef = useMemo(() => new Set<string>(), []);
  useEffect(() => {
    if (loadingHistory) return;
    const liveDrills = DRILLS.filter(
      (d) => d.available && (!focusedDrill || d.key === focusedDrill)
    );
    for (const d of liveDrills) {
      const hasActive = history.some((s) => s.drill === d.key && s.status === "active");
      if (hasActive || warmingRef.has(d.key)) continue;
      warmingRef.add(d.key);
      (async () => {
        try {
          const res = await fetch("/api/practice/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ drill: d.key, mode: "warm" }),
          });
          const data = await res.json().catch(() => null);
          if (res.ok && data?.session) {
            setHistory((prev) => [data.session, ...prev]);
          }
        } catch {
          /* warm-up is best-effort */
        } finally {
          warmingRef.delete(d.key);
        }
      })();
    }
  }, [loadingHistory, history, focusedDrill, warmingRef]);

  const startDrill = async (drill: string) => {
    setStartError(null);
    // Instant path: consume an existing active session (warm-pooled or
    // previously abandoned — either way it's ungraded and unrevealed).
    const ready = history.find((s) => s.drill === drill && s.status === "active");
    if (ready) {
      router.push(`${basePath}?session=${ready.id}`);
      return;
    }
    // Cold path: nothing warm yet (first-ever visit or warm-up still
    // in flight) — generate on click with the per-drill throbber.
    setStarting(drill);
    try {
      const res = await fetch("/api/practice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drill }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Failed to start (${res.status})`);
      await loadHistory();
      router.push(`${basePath}?session=${data.session.id}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start drill");
    } finally {
      setStarting(null);
    }
  };

  const fetchHint = async () => {
    if (!session || loadingHint) return;
    setLoadingHint(true);
    try {
      const res = await fetch(`/api/practice/sessions/${session.id}/hint`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.hint) setHint(data.hint);
    } catch {
      /* hint is best-effort */
    } finally {
      setLoadingHint(false);
    }
  };

  // Rapport step 1: deliver the icebreaker; the buyer responds in
  // character and the exchange lands in session.turns.
  const deliverIcebreaker = async () => {
    if (!session || sendingTurn) return;
    setGradeError(null);
    if (!icebreaker.trim()) {
      setGradeError("Deliver your icebreaker (record it or type it) first.");
      return;
    }
    setSendingTurn(true);
    try {
      const res = await fetch(`/api/practice/sessions/${session.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: icebreaker.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Turn failed (${res.status})`);
      setSession(data.session);
    } catch (err) {
      setGradeError(err instanceof Error ? err.message : "Failed to deliver icebreaker");
    } finally {
      setSendingTurn(false);
    }
  };

  const submitAnswers = async () => {
    if (!session) return;
    setGradeError(null);
    let answers: Record<string, unknown>;
    if (session.drill === "rapport") {
      if (!pivot.trim()) {
        setGradeError("Deliver your pivot (record it or type it) before submitting.");
        return;
      }
      answers = { pivot: pivot.trim() };
    } else {
      if (!orgPersona || !humanPersona || !angle.trim()) {
        setGradeError("Pick both personas and write your angle before submitting.");
        return;
      }
      answers = {
        orgPersona,
        humanPersona,
        angle: angle.trim(),
        valuePropsLand: [...propsLand],
      };
    }
    setGrading(true);
    try {
      const res = await fetch(`/api/practice/sessions/${session.id}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Grading failed (${res.status})`);
      setSession(data.session);
      // Grade is in — immediately start building the next scenario in
      // the background (not awaited) so Practice Again loads instantly.
      void prefetchNext(session.drill);
      await loadHistory();
    } catch (err) {
      setGradeError(err instanceof Error ? err.message : "Grading failed");
    } finally {
      setGrading(false);
    }
  };

  const pub = session?.persona.public;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SalesNavBar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-3">
              🥊 Practice
              {streak >= 2 && (
                <span className="text-sm font-semibold bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-2.5 py-1 rounded-full">
                  🔥 {streak}-day streak
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Drills against synthetic buyers built from YOUR playbook, graded against YOUR
              value props and discovery framework.
            </p>
          </div>
          {sessionId ? (
            <button
              onClick={() => router.push(basePath)}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              ← {focusedDrill ? drillInfo(focusedDrill).label : "All drills"}
            </button>
          ) : focusedDrill ? (
            <button
              onClick={() => router.push("/practice")}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              ← All drills
            </button>
          ) : null}
        </div>

        {!sessionId ? (
          /* ── Home / focused-drill landing: cards + history ────── */
          <div className="space-y-6">
            {startError && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2.5">
                {startError}
              </p>
            )}
            <div className={focusedDrill ? "" : "grid sm:grid-cols-2 gap-4"}>
              {DRILLS.filter((d) => !focusedDrill || d.key === focusedDrill).map((d) => (
                <div
                  key={d.key}
                  className={`bg-white dark:bg-gray-800 border rounded-xl p-5 ${
                    d.available
                      ? "border-purple-200 dark:border-purple-800"
                      : "border-gray-200 dark:border-gray-700 opacity-70"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {d.available && !focusedDrill ? (
                        // Card titles deep-link to the shareable drill
                        // page (/practice/<slug>) — copy that URL into
                        // Slack as a "do this" assignment.
                        <button
                          onClick={() => router.push(`/practice/${SLUG_BY_DRILL[d.key]}`)}
                          className="hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                          title={`Open the ${d.label} page (shareable link)`}
                        >
                          {d.emoji} {d.label} <span className="text-gray-300 dark:text-gray-600">→</span>
                        </button>
                      ) : (
                        <>
                          {d.emoji} {d.label}
                        </>
                      )}
                    </h2>
                    {d.available ? (
                      <Sparkline points={sparkByDrill.get(d.key) || []} />
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                        soon
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{d.description}</p>
                  {d.available && (
                    <button
                      onClick={() => startDrill(d.key)}
                      disabled={starting === d.key}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                    >
                      {starting === d.key ? (
                        <>
                          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Building your buyer…
                        </>
                      ) : (
                        "Start drill"
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-3">
                {focusedDrill ? `${drillInfo(focusedDrill).label} history` : "Recent sessions"}
              </h2>
              {loadingHistory ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                  No reps yet — start your first drill above.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {/* Warm-pooled sessions that were never attempted are
                      plumbing, not history — hide them until used. */}
                  {history.filter((s) => !(s.status === "active" && s.mode === "warm")).map((s) => {
                    const info = drillInfo(s.drill);
                    return (
                      <li key={s.id}>
                        <button
                          onClick={() => router.push(`${basePath}?session=${s.id}`)}
                          className="w-full text-left py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 rounded-lg px-2 -mx-2"
                        >
                          <span>{info.emoji}</span>
                          <span className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-200 truncate">
                            {info.label} — {s.persona.public.name}, {s.persona.public.company.name}
                          </span>
                          <span className="text-xs text-gray-400">{formatDate(s.createdAt)}</span>
                          {s.score ? (
                            <span className={`text-sm font-bold ${gradeColor(s.score.overall)}`}>
                              {s.score.overall}
                            </span>
                          ) : (
                            <span className="text-[10px] uppercase text-amber-600 dark:text-amber-400">
                              unfinished
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : loadingSession || !session ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-10 text-center text-sm text-gray-400">
            {loadingSession ? "Loading…" : "Session not found."}
          </div>
        ) : (
          /* ── Drill runner ─────────────────────────────────────── */
          <div className="space-y-5">
            {/* Persona public card */}
            {pub && (
              <div className="bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-800 rounded-xl p-5">
                <div className="text-xs uppercase tracking-wide text-purple-500 dark:text-purple-400 font-semibold mb-2">
                  📅 New meeting on your calendar
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {pub.name} <span className="font-normal text-gray-500 dark:text-gray-400">— {pub.title}</span>
                </h2>
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                  <strong>{pub.company.name}</strong> · {pub.company.industry} · {pub.company.size}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{pub.company.blurb}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 italic">{pub.bio}</p>
                {pub.breadcrumbs?.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {pub.breadcrumbs.map((b, i) => (
                      <li key={i} className="text-[11px] bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {session.status !== "completed" && session.drill === "rapport" ? (
              /* ── Rapport: two-turn roleplay ─────────────────── */
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
                {/* Guidance — the philosophy, up front, every time. */}
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-900 rounded-lg px-3.5 py-2.5 text-xs text-purple-900 dark:text-purple-200 space-y-1">
                  <p className="font-semibold">What good rapport looks like:</p>
                  <p>
                    Pick something <strong>personal</strong> from their card — a hobby, a joke they
                    made, a human detail. Be warm and light; a laugh is the goal. Keep it to 1–3
                    sentences and <strong>end with an easy question, then wait</strong> — they&rsquo;ll
                    respond, and you&rsquo;ll pivot to business after. Business topics (their posts,
                    panels, initiatives) are pre-call research, <em>not</em> rapport.
                  </p>
                </div>

                {(session.turns?.length ?? 0) === 0 ? (
                  /* Step 1 — the icebreaker */
                  <>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                        You&rsquo;re opening the call with {pub?.name.split(" ")[0]}. Deliver your icebreaker.
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Say it out loud like you would on the call, or type it. End with your
                        question — {pub?.name.split(" ")[0]} will answer, then you&rsquo;ll pivot.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {recordingFor !== "icebreaker" && (
                        <button
                          onClick={() => setRecordingFor("icebreaker")}
                          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 rounded-lg"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                          Record it
                        </button>
                      )}
                      <button
                        onClick={fetchHint}
                        disabled={loadingHint}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60 rounded-lg disabled:opacity-60"
                        title="Get an example icebreaker for this buyer — read it into the recorder to practice the delivery"
                      >
                        {loadingHint ? "Thinking…" : "💡 Give me a hint"}
                      </button>
                    </div>
                    {hint && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3.5 py-2.5">
                        <p className="text-sm text-amber-900 dark:text-amber-200 italic">&ldquo;{hint}&rdquo;</p>
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                          Read it into the recorder — the rep is in the delivery, not the writing.
                        </p>
                      </div>
                    )}
                    {recordingFor === "icebreaker" && (
                      <VoiceRecordingInput
                        isActive
                        onCancel={() => setRecordingFor(null)}
                        onTranscriptionComplete={(text) => {
                          setIcebreaker((prev) => (prev ? `${prev} ${text}` : text));
                          setRecordingFor(null);
                        }}
                      />
                    )}
                    <textarea
                      value={icebreaker}
                      onChange={(e) => setIcebreaker(e.target.value)}
                      rows={3}
                      placeholder='e.g. "Hey Mara — I have to ask about the gravel cycling…"'
                      className="w-full text-sm p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                    {gradeError && <p className="text-sm text-red-600 dark:text-red-400">{gradeError}</p>}
                    <button
                      onClick={deliverIcebreaker}
                      disabled={sendingTurn}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                    >
                      {sendingTurn ? (
                        <>
                          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          {pub?.name.split(" ")[0]} is responding…
                        </>
                      ) : (
                        "Deliver icebreaker"
                      )}
                    </button>
                  </>
                ) : (
                  /* Step 2 — the buyer responded; now the pivot */
                  <>
                    <div className="space-y-2">
                      {session.turns!.map((t, i) => (
                        <div
                          key={i}
                          className={`text-sm rounded-lg px-3.5 py-2.5 max-w-[85%] ${
                            t.role === "user"
                              ? "bg-purple-600 text-white ml-auto"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                          }`}
                        >
                          {t.role !== "user" && (
                            <span className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-0.5">
                              {pub?.name}
                            </span>
                          )}
                          {t.text}
                        </div>
                      ))}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                        Now ride {pub?.name.split(" ")[0]}&rsquo;s response into business.
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        React to what they actually said — a genuine beat, then a graceful
                        transition ("anyway — I know we&rsquo;ve only got 30 minutes…").
                      </p>
                    </div>
                    {recordingFor === "pivot" ? (
                      <VoiceRecordingInput
                        isActive
                        onCancel={() => setRecordingFor(null)}
                        onTranscriptionComplete={(text) => {
                          setPivot((prev) => (prev ? `${prev} ${text}` : text));
                          setRecordingFor(null);
                        }}
                      />
                    ) : (
                      <button
                        onClick={() => setRecordingFor("pivot")}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 rounded-lg"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                        Record it
                      </button>
                    )}
                    <textarea
                      value={pivot}
                      onChange={(e) => setPivot(e.target.value)}
                      rows={3}
                      placeholder='e.g. "Ha, that&apos;s exactly what I&apos;d expect — anyway, I know we&apos;ve only got 30 minutes…"'
                      className="w-full text-sm p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                    {gradeError && <p className="text-sm text-red-600 dark:text-red-400">{gradeError}</p>}
                    <button
                      onClick={submitAnswers}
                      disabled={grading}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                    >
                      {grading ? (
                        <>
                          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Grading…
                        </>
                      ) : (
                        "Submit pivot for grading"
                      )}
                    </button>
                  </>
                )}
              </div>
            ) : session.status !== "completed" ? (
              /* ── Pre-call quiz form ─────────────────────────── */
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    1. Which of your org personas is this company?
                  </h3>
                  <div className="space-y-1.5">
                    {session.persona.quiz.orgPersonaOptions.map((opt) => (
                      <label key={opt} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                        <input
                          type="radio"
                          name="orgPersona"
                          checked={orgPersona === opt}
                          onChange={() => setOrgPersona(opt)}
                          className="mt-0.5"
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    2. What&rsquo;s {pub?.name.split(" ")[0]}&rsquo;s role in a deal?
                  </h3>
                  <div className="space-y-1.5">
                    {session.persona.quiz.humanPersonaOptions.map((opt) => (
                      <label key={opt} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                        <input
                          type="radio"
                          name="humanPersona"
                          checked={humanPersona === opt}
                          onChange={() => setHumanPersona(opt)}
                          className="mt-0.5"
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                    3. What&rsquo;s your angle?
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    The pain you&rsquo;d hypothesize, why NOW, and how you&rsquo;d open the conversation.
                  </p>
                  <textarea
                    value={angle}
                    onChange={(e) => setAngle(e.target.value)}
                    rows={4}
                    placeholder="e.g. They just raised a Series B and are hiring SDRs fast — I'd bet onboarding consistency is breaking…"
                    className="w-full text-sm p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                    4. Which of your value props LAND for this buyer?
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    Check the ones that land. Leaving one unchecked means you&rsquo;d keep it holstered —
                    picking a prop they don&rsquo;t care about costs points, same as it costs credibility on a real call.
                  </p>
                  <div className="space-y-1.5">
                    {session.persona.quiz.valueProps.map((vp) => (
                      <label key={vp} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={propsLand.has(vp)}
                          onChange={() =>
                            setPropsLand((prev) => {
                              const next = new Set(prev);
                              if (next.has(vp)) next.delete(vp);
                              else next.add(vp);
                              return next;
                            })
                          }
                          className="mt-0.5"
                        />
                        {vp}
                      </label>
                    ))}
                  </div>
                </div>
                {gradeError && <p className="text-sm text-red-600 dark:text-red-400">{gradeError}</p>}
                <button
                  onClick={submitAnswers}
                  disabled={grading}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                >
                  {grading ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Grading…
                    </>
                  ) : (
                    "Submit plan for grading"
                  )}
                </button>
              </div>
            ) : (
              /* ── Report card + reveal ───────────────────────── */
              session.score && (
                <div className="space-y-5">
                  {/* The exchange as it happened (roleplay drills) —
                      turns + the graded pivot from answers. */}
                  {session.drill === "rapport" && (session.turns?.length ?? 0) > 0 && (
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-1">
                        The exchange
                      </h3>
                      {[
                        ...session.turns!,
                        ...(typeof session.answers?.pivot === "string"
                          ? [{ role: "user", text: session.answers.pivot as string }]
                          : []),
                      ].map((t, i) => (
                        <div
                          key={i}
                          className={`text-sm rounded-lg px-3.5 py-2.5 max-w-[85%] ${
                            t.role === "user"
                              ? "bg-purple-600 text-white ml-auto"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                          }`}
                        >
                          {t.role !== "user" && (
                            <span className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-0.5">
                              {pub?.name}
                            </span>
                          )}
                          {t.text}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">
                        Report card
                      </h3>
                      <span className={`text-3xl font-black ${gradeColor(session.score.overall)}`}>
                        {session.score.overall}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {session.score.dimensions.map((d) => (
                        <div key={d.name}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{d.name}</span>
                            <span className="text-gray-500 dark:text-gray-400">
                              {d.score}/{d.max}
                            </span>
                          </div>
                          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full"
                              style={{ width: `${(d.score / Math.max(d.max, 1)) * 100}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{d.comment}</p>
                        </div>
                      ))}
                    </div>
                    {(session.score.flags?.length ?? 0) > 0 && (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {session.score.flags!.map((f) => (
                          <span
                            key={f}
                            className="text-[11px] font-medium bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded-full"
                          >
                            🚩 {f}
                          </span>
                        ))}
                      </div>
                    )}
                    {session.score.nextRep && (
                      <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                        <strong>Next rep:</strong> {session.score.nextRep}
                      </div>
                    )}
                  </div>

                  {session.score.modelAnswer && (
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-2">
                        What great looks like
                      </h3>
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {session.score.modelAnswer}
                      </p>
                      {(session.score.alternatives?.length ?? 0) > 0 && (
                        <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-3">
                          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                            Other angles you could have taken
                          </h4>
                          <ul className="space-y-2">
                            {session.score.alternatives!.map((alt, i) => (
                              <li key={i} className="text-sm text-gray-600 dark:text-gray-400 italic border-l-2 border-purple-200 dark:border-purple-800 pl-3">
                                {alt}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {session.persona.hidden && (
                    <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-5">
                      <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-200 uppercase tracking-wide mb-3">
                        🃏 The reveal — who {pub?.name.split(" ")[0]} really was
                      </h3>
                      <dl className="space-y-2 text-sm">
                        <div>
                          <dt className="font-medium text-purple-800 dark:text-purple-300 inline">Org persona: </dt>
                          <dd className="inline text-gray-700 dark:text-gray-300">{session.persona.hidden.orgPersona}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-purple-800 dark:text-purple-300 inline">Human persona: </dt>
                          <dd className="inline text-gray-700 dark:text-gray-300">{session.persona.hidden.humanPersona}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-purple-800 dark:text-purple-300">Their pains:</dt>
                          <dd>
                            <ul className="list-disc ml-5 text-gray-700 dark:text-gray-300">
                              {session.persona.hidden.pains.map((p, i) => (
                                <li key={i}>{p}</li>
                              ))}
                            </ul>
                          </dd>
                        </div>
                        <div>
                          <dt className="font-medium text-purple-800 dark:text-purple-300 inline">Why now: </dt>
                          <dd className="inline text-gray-700 dark:text-gray-300">{session.persona.hidden.compellingEvent}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-purple-800 dark:text-purple-300">Value props that land:</dt>
                          <dd>
                            <ul className="list-disc ml-5 text-green-700 dark:text-green-400">
                              {session.persona.hidden.valuePropsThatLand.map((p, i) => (
                                <li key={i}>{p}</li>
                              ))}
                            </ul>
                          </dd>
                        </div>
                        <div>
                          <dt className="font-medium text-purple-800 dark:text-purple-300">Value props to keep holstered:</dt>
                          <dd>
                            <ul className="list-disc ml-5 text-gray-500 dark:text-gray-400">
                              {session.persona.hidden.valuePropsThatDont.map((p, i) => (
                                <li key={i}>{p}</li>
                              ))}
                            </ul>
                          </dd>
                        </div>
                        <div>
                          <dt className="font-medium text-purple-800 dark:text-purple-300 inline">Temperament: </dt>
                          <dd className="inline text-gray-700 dark:text-gray-300">{session.persona.hidden.temperament}</dd>
                        </div>
                        {session.persona.hidden.objections?.length > 0 && (
                          <div>
                            <dt className="font-medium text-purple-800 dark:text-purple-300">Objections they&rsquo;re carrying:</dt>
                            <dd>
                              <ul className="list-disc ml-5 text-gray-700 dark:text-gray-300">
                                {session.persona.hidden.objections.map((o, i) => (
                                  <li key={i}>{o}</li>
                                ))}
                              </ul>
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}

                  <div className="flex gap-3">
                    {prefetching ? (
                      <button
                        disabled
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg shadow-sm opacity-70"
                      >
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Generating Next Scenario…
                      </button>
                    ) : nextSession && nextSession.drill === session.drill ? (
                      <button
                        onClick={() => {
                          const id = nextSession.id;
                          setNextSession(null);
                          router.push(`${basePath}?session=${id}`);
                        }}
                        className="px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg shadow-sm"
                      >
                        ✨ Next Scenario Ready: Practice Again
                      </button>
                    ) : (
                      <button
                        onClick={() => startDrill(session.drill)}
                        disabled={starting === session.drill}
                        className="px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                      >
                        {starting === session.drill ? "Building your next buyer…" : "🔁 Practice again"}
                      </button>
                    )}
                    <button
                      onClick={() => router.push(basePath)}
                      className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
                    >
                      Back to drills
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PracticePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 dark:bg-gray-900" />}>
      <PracticePageInner />
    </Suspense>
  );
}
