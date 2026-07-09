"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
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
  intro?: string;
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
    script?: string;
    scriptSource?: string;
    voice?: string;
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
  dealId: string | null;
  meetingEntryId: string | null;
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
    description: "Run your agenda set + elevator pitch out loud — script visible or from memory — against the clock. Graded on beats, time, pace, and filler words.",
    available: true,
  },
  {
    key: "discovery",
    emoji: "🔍",
    label: "Discovery",
    description: "Live discovery roleplay — the buyer speaks back. Two-Level drill (one question + the follow-up) or full Freestyle conversation, graded on second-level digging and pulling the gold threads.",
    available: true,
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
  // Live-Fire mode: arrived from a deal's upcoming-meeting row —
  // drills run against the REAL attendee, grounded in deal evidence.
  const lfDealId = searchParams.get("deal");
  const lfMeetingId = searchParams.get("meeting");
  const lfLabel = searchParams.get("label");
  const liveFire = !!lfDealId;

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
  const [recordingFor, setRecordingFor] = useState<"icebreaker" | "pivot" | "agenda" | "discovery" | null>(null);
  const [sendingTurn, setSendingTurn] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [loadingHint, setLoadingHint] = useState(false);
  // Agenda drill state — setup (edit script, pick mode) → deliver.
  const [agendaScript, setAgendaScript] = useState("");
  const [agendaMode, setAgendaMode] = useState<"script_visible" | "script_hidden">("script_visible");
  const [agendaDelivering, setAgendaDelivering] = useState(false);
  const [agendaTranscript, setAgendaTranscript] = useState("");
  const [agendaDurationMs, setAgendaDurationMs] = useState<number | null>(null);
  const [savingScript, setSavingScript] = useState(false);
  const [scriptSaved, setScriptSaved] = useState(false);
  // Discovery drill state — mode pick → live conversation → grade.
  const [discMode, setDiscMode] = useState<"two_level" | "freestyle">("two_level");
  const [discStarted, setDiscStarted] = useState(false);
  const [discInput, setDiscInput] = useState("");
  const [discQuestionsVisible, setDiscQuestionsVisible] = useState(false);
  const [myQuestions, setMyQuestions] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
    setAgendaDelivering(false);
    setAgendaTranscript("");
    setAgendaDurationMs(null);
    setScriptSaved(false);
    setDiscStarted(false);
    setDiscInput("");
    audioRef.current?.pause();
    audioRef.current = null;
    setGradeError(null);
    (async () => {
      try {
        const res = await fetch(`/api/practice/sessions/${sessionId}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSession(data.session);
          setAgendaScript(data.session?.persona?.script || "");
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

  const prefetchNext = useCallback(async (drill: string, rematchOf?: SessionShape) => {
    setPrefetching(true);
    setNextSession(null);
    try {
      // mode:"warm" marks background-created sessions so the history
      // list can hide them until they're actually attempted. For a
      // live-fire session the "next scenario" is a REMATCH of the same
      // real buyer — fresh synthetic strangers don't help you prep.
      const res = await fetch("/api/practice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          rematchOf?.dealId
            ? { drill, mode: "warm", rematchSessionId: rematchOf.id }
            : { drill, mode: "warm" }
        ),
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
  // ~1 spare per drill. In LIVE-FIRE mode this pre-builds all three
  // deal-anchored scenarios for THIS meeting the moment the founder
  // lands (real-attendee personas take ~15-25s each — that wait
  // belongs in the background, not between click and drill).
  const warmingRef = useMemo(() => new Set<string>(), []);
  useEffect(() => {
    if (loadingHistory) return;
    const liveDrills = DRILLS.filter(
      (d) =>
        d.available &&
        (!focusedDrill || d.key === focusedDrill) &&
        (!liveFire || ["precall_plan", "agenda", "discovery"].includes(d.key))
    );
    for (const d of liveDrills) {
      // Match the anchoring startDrill consumes: gym sessions for gym
      // mode, this exact deal+meeting for live-fire.
      const hasActive = history.some(
        (s) =>
          s.drill === d.key &&
          s.status === "active" &&
          (liveFire
            ? s.dealId === lfDealId && s.meetingEntryId === lfMeetingId
            : !s.dealId)
      );
      const warmKey = `${d.key}:${liveFire ? `${lfDealId}/${lfMeetingId ?? ""}` : "gym"}`;
      if (hasActive || warmingRef.has(warmKey)) continue;
      warmingRef.add(warmKey);
      (async () => {
        try {
          const res = await fetch("/api/practice/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              drill: d.key,
              mode: "warm",
              ...(liveFire
                ? { dealId: lfDealId, meetingEntryId: lfMeetingId || undefined }
                : {}),
            }),
          });
          const data = await res.json().catch(() => null);
          if (res.ok && data?.session) {
            setHistory((prev) => [data.session, ...prev]);
          }
        } catch {
          /* warm-up is best-effort */
        } finally {
          warmingRef.delete(warmKey);
        }
      })();
    }
  }, [loadingHistory, history, focusedDrill, liveFire, lfDealId, lfMeetingId, warmingRef]);

  const startDrill = async (drill: string) => {
    setStartError(null);
    // Instant path: consume an existing active session — but only one
    // that matches the anchoring (gym sessions for gym mode, this
    // exact deal+meeting for live-fire).
    const ready = history.find(
      (s) =>
        s.drill === drill &&
        s.status === "active" &&
        (liveFire
          ? s.dealId === lfDealId && s.meetingEntryId === lfMeetingId
          : !s.dealId)
    );
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
        body: JSON.stringify({
          drill,
          ...(liveFire ? { dealId: lfDealId, meetingEntryId: lfMeetingId || undefined } : {}),
        }),
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

  // Lazy-load the founder's discovery questions for the side panel
  // (questions-visible mode). Cached after first fetch.
  const loadMyQuestions = async () => {
    if (myQuestions !== null) return;
    try {
      const res = await fetch("/api/discovery-questions/latest");
      if (!res.ok) {
        setMyQuestions("");
        return;
      }
      const d = await res.json();
      const cats: Array<Record<string, unknown>> = d?.version?.content?.categories || [];
      const lines: string[] = [];
      for (const c of cats) {
        const name = (c.name || c.category || c.title) as string | undefined;
        const qs = Array.isArray(c.questions) ? c.questions : [];
        if (!qs.length) continue;
        if (name) lines.push(`▸ ${name}`);
        for (const q of qs) {
          const text = typeof q === "string" ? q : ((q as Record<string, string>)?.question || (q as Record<string, string>)?.text || "");
          if (text) lines.push(`   • ${text}`);
        }
      }
      setMyQuestions(lines.join("\n"));
    } catch {
      setMyQuestions("");
    }
  };

  // Speak persona text in the persona's own TTS voice. Best-effort —
  // audio failure never blocks the drill; the text is always on screen.
  const speakAsPersona = useCallback(
    async (text: string, voice?: string) => {
      if (!voiceOn || !text) return;
      try {
        audioRef.current?.pause();
        const res = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;
        void audio.play();
      } catch {
        /* silent — text is visible regardless */
      }
    },
    [voiceOn]
  );

  // Discovery: send the founder's question, get the in-character
  // answer, speak it.
  const sendDiscoveryTurn = async () => {
    if (!session || sendingTurn || !discInput.trim()) return;
    setGradeError(null);
    setSendingTurn(true);
    try {
      const res = await fetch(`/api/practice/sessions/${session.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: discInput.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Turn failed (${res.status})`);
      setDiscInput("");
      setSession(data.session);
      const turns: Array<{ role: string; text: string }> = data.session?.turns || [];
      const lastReply = [...turns].reverse().find((t) => t.role === "persona");
      if (lastReply) void speakAsPersona(lastReply.text, data.session?.persona?.voice);
      // Two-level: the follow-up's reply IS the end of the rep — grade
      // immediately (while the reply plays) instead of making the
      // founder click a button. Failure leaves the manual button as a
      // retry path.
      const userTurns = turns.filter((t) => t.role === "user").length;
      if (discMode === "two_level" && userTurns >= 2) {
        void submitAnswers();
      }
    } catch (err) {
      setGradeError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSendingTurn(false);
    }
  };

  // Re-drill the exact same buyer (persona snapshot copies verbatim).
  const rematch = async (of: { id: string; drill: string }) => {
    setStarting(of.drill);
    setStartError(null);
    try {
      const res = await fetch("/api/practice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drill: of.drill, rematchSessionId: of.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Rematch failed (${res.status})`);
      await loadHistory();
      router.push(`${basePath}?session=${data.session.id}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Rematch failed");
    } finally {
      setStarting(null);
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
    } else if (session.drill === "agenda") {
      if (!agendaTranscript.trim()) {
        setGradeError("Deliver your agenda set (record it or type it) before submitting.");
        return;
      }
      answers = {
        transcript: agendaTranscript.trim(),
        durationMs: agendaDurationMs,
        mode: agendaMode,
        script: agendaScript.trim(),
      };
    } else if (session.drill === "discovery") {
      answers = { mode: discMode, questionsVisible: discQuestionsVisible };
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
      void prefetchNext(session.drill, session);
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
            {liveFire && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  🎯 Live-Fire: practicing for {lfLabel ? `"${lfLabel}"` : "a real upcoming call"}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  Drills run against the REAL attendee, built from this deal&rsquo;s actual
                  history. Unknowns are flagged honestly — the reveal doubles as call prep.
                </p>
              </div>
            )}
            <div className={focusedDrill ? "" : "grid sm:grid-cols-2 gap-4"}>
              {DRILLS.filter(
                (d) =>
                  (!focusedDrill || d.key === focusedDrill) &&
                  // Live-fire offers the three call-prep drills; rapport
                  // breadcrumbs are synthetic-only by design (we don't
                  // invent personal details about real people).
                  (!liveFire || ["precall_plan", "agenda", "discovery"].includes(d.key))
              ).map((d) => (
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
                  {d.available && (() => {
                    const ready = history.some(
                      (s) =>
                        s.drill === d.key &&
                        s.status === "active" &&
                        (liveFire
                          ? s.dealId === lfDealId && s.meetingEntryId === lfMeetingId
                          : !s.dealId)
                    );
                    return (
                      <button
                        onClick={() => startDrill(d.key)}
                        disabled={starting === d.key}
                        className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm disabled:opacity-50 ${
                          ready
                            ? "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                            : "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                        }`}
                      >
                        {starting === d.key ? (
                          <>
                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Building your buyer…
                          </>
                        ) : ready ? (
                          "✨ Ready — start drill"
                        ) : liveFire ? (
                          <>
                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Preparing scenario…
                          </>
                        ) : (
                          "Start drill"
                        )}
                      </button>
                    );
                  })()}
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
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => router.push(`${basePath}?session=${s.id}`)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") router.push(`${basePath}?session=${s.id}`);
                          }}
                          className="w-full text-left py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 rounded-lg px-2 -mx-2 cursor-pointer group/hrow"
                        >
                          <span>{info.emoji}</span>
                          <span className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-200 truncate">
                            {info.label} — {s.persona.public.name}, {s.persona.public.company.name}
                            {s.dealId && <span className="text-amber-600 dark:text-amber-400"> · 🎯 live-fire</span>}
                          </span>
                          {s.status === "completed" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void rematch(s);
                              }}
                              disabled={starting === s.drill}
                              className="text-[11px] font-medium text-purple-600 dark:text-purple-300 hover:underline opacity-0 group-hover/hrow:opacity-100 transition-opacity disabled:opacity-50"
                              title={`Practice against ${s.persona.public.name.split(" ")[0]} again — same buyer, fresh attempt`}
                            >
                              ↻ Rematch
                            </button>
                          )}
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
                        </div>
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
                  {session.dealId ? "🎯 Live-Fire — your real buyer, from the deal's evidence" : "📅 New meeting on your calendar"}
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

            {session.status !== "completed" && session.drill === "discovery" ? (
              /* ── Discovery: setup → live conversation ───────── */
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
                {!discStarted ? (
                  <>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                        Discovery with {pub?.name.split(" ")[0]} — pick your rep.
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {pub?.name.split(" ")[0]} answers in character and speaks — information is
                        earned. Sharp, open questions get substance; weak ones get polite fluff.
                        Listen for dangled threads and pull them.
                      </p>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <button
                        onClick={() => setDiscMode("two_level")}
                        className={`text-left p-3 rounded-lg border ${
                          discMode === "two_level"
                            ? "border-purple-500 bg-purple-50 dark:bg-purple-900/30"
                            : "border-gray-200 dark:border-gray-600 hover:border-purple-300"
                        }`}
                      >
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">🎯 Two-Level Drill</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          One question, her answer, your follow-up. Graded on digging deeper, not
                          topic-hopping.
                        </p>
                      </button>
                      <button
                        onClick={() => setDiscMode("freestyle")}
                        className={`text-left p-3 rounded-lg border ${
                          discMode === "freestyle"
                            ? "border-purple-500 bg-purple-50 dark:bg-purple-900/30"
                            : "border-gray-200 dark:border-gray-600 hover:border-purple-300"
                        }`}
                      >
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">🌊 Freestyle</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Full discovery conversation — wrap up when you&rsquo;ve got what you need.
                          Graded on coverage, ratios, and the numbers you earned.
                        </p>
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={discQuestionsVisible}
                        onChange={(e) => {
                          setDiscQuestionsVisible(e.target.checked);
                          if (e.target.checked) void loadMyQuestions();
                        }}
                      />
                      Show my discovery questions in a side panel (train with the sheet, then wean off)
                    </label>
                    <button
                      onClick={() => {
                        setDiscStarted(true);
                        if (pub?.intro) void speakAsPersona(pub.intro, session.persona.voice);
                      }}
                      className="px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg shadow-sm"
                    >
                      📞 Start the conversation
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {discMode === "two_level" ? "🎯 Two-Level Drill" : "🌊 Freestyle discovery"} with {pub?.name.split(" ")[0]}
                      </h3>
                      <button
                        onClick={() => {
                          setVoiceOn((v) => !v);
                          if (voiceOn) audioRef.current?.pause();
                        }}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                        title={voiceOn ? "Mute the buyer's voice" : "Unmute the buyer's voice"}
                      >
                        {voiceOn ? "🔊 Voice on" : "🔇 Muted"}
                      </button>
                    </div>
                    {discQuestionsVisible && myQuestions && (
                      <details className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2" open>
                        <summary className="text-xs font-semibold text-gray-600 dark:text-gray-300 cursor-pointer">
                          📋 My discovery questions
                        </summary>
                        <pre className="text-[11px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap mt-2 font-sans max-h-48 overflow-y-auto">{myQuestions}</pre>
                      </details>
                    )}
                    {/* Conversation */}
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      <div className="text-sm rounded-lg px-3.5 py-2.5 max-w-[85%] bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                        <span className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-0.5">
                          {pub?.name}
                        </span>
                        {pub?.intro ||
                          `Hi, I'm ${pub?.name.split(" ")[0]} — ${pub?.title} at ${pub?.company.name}. Happy to chat.`}
                      </div>
                      {(session.turns || []).map((t, i) => (
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
                      {sendingTurn && (
                        <div className="text-sm rounded-lg px-3.5 py-2.5 max-w-[85%] bg-gray-100 dark:bg-gray-700 text-gray-400 italic">
                          {pub?.name.split(" ")[0]} is thinking…
                        </div>
                      )}
                    </div>
                    {(() => {
                      const userTurns = (session.turns || []).filter((t) => t.role === "user").length;
                      const twoLevelDone = discMode === "two_level" && userTurns >= 2;
                      return (
                        <>
                          {!twoLevelDone && (
                            <>
                              {discMode === "two_level" && (
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {userTurns === 0
                                    ? "Ask your opening discovery question."
                                    : "Now the follow-up — dig into what she just said. Don't change topics."}
                                </p>
                              )}
                              {recordingFor === "discovery" ? (
                                <VoiceRecordingInput
                                  isActive
                                  onCancel={() => setRecordingFor(null)}
                                  onTranscriptionComplete={(text) => {
                                    setDiscInput((prev) => (prev ? `${prev} ${text}` : text));
                                    setRecordingFor(null);
                                  }}
                                />
                              ) : (
                                <div className="flex items-end gap-2">
                                  <button
                                    onClick={() => setRecordingFor("discovery")}
                                    className="shrink-0 p-2.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 rounded-lg"
                                    title="Ask by voice"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                    </svg>
                                  </button>
                                  <textarea
                                    value={discInput}
                                    onChange={(e) => setDiscInput(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        void sendDiscoveryTurn();
                                      }
                                    }}
                                    rows={2}
                                    placeholder="Ask your question…"
                                    className="flex-1 text-sm p-2.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
                                  />
                                  <button
                                    onClick={sendDiscoveryTurn}
                                    disabled={sendingTurn || !discInput.trim()}
                                    className="shrink-0 px-3.5 py-2.5 text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
                                  >
                                    Ask
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                          {gradeError && <p className="text-sm text-red-600 dark:text-red-400">{gradeError}</p>}
                          {(twoLevelDone || (discMode === "freestyle" && userTurns > 0)) && (
                            <button
                              onClick={submitAnswers}
                              disabled={grading || sendingTurn}
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
                              ) : twoLevelDone ? (
                                "Get my grade"
                              ) : (
                                "🏁 Wrap up & grade"
                              )}
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            ) : session.status !== "completed" && session.drill === "agenda" ? (
              /* ── Agenda drill: setup → deliver ──────────────── */
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
                {!agendaDelivering ? (
                  /* Setup: approve the script, pick the mode */
                  <>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                        Your script — agenda set + elevator pitch for the call with {pub?.name.split(" ")[0]}.
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {session.persona.scriptSource === "saved_default"
                          ? "Loaded from your saved default."
                          : session.persona.scriptSource === "generated"
                            ? "Drafted from your first-call checklist and value prop."
                            : "Starter skeleton — edit it into your own words."}{" "}
                        Edit freely; you&rsquo;ll be graded against what&rsquo;s in this box.
                      </p>
                    </div>
                    <textarea
                      value={agendaScript}
                      onChange={(e) => {
                        setAgendaScript(e.target.value);
                        setScriptSaved(false);
                      }}
                      rows={10}
                      className="w-full text-sm p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={async () => {
                          if (savingScript || !agendaScript.trim()) return;
                          setSavingScript(true);
                          try {
                            const res = await fetch("/api/practice/agenda-script", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ script: agendaScript.trim() }),
                            });
                            if (res.ok) setScriptSaved(true);
                          } finally {
                            setSavingScript(false);
                          }
                        }}
                        disabled={savingScript}
                        className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg disabled:opacity-60"
                        title="Future agenda drills will start from this script"
                      >
                        {scriptSaved ? "✓ Saved as default" : savingScript ? "Saving…" : "Save as my default"}
                      </button>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">Mode</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAgendaMode("script_visible")}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                            agendaMode === "script_visible"
                              ? "bg-purple-600 text-white"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                          }`}
                        >
                          📜 Script visible
                        </button>
                        <button
                          onClick={() => setAgendaMode("script_hidden")}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                            agendaMode === "script_hidden"
                              ? "bg-purple-600 text-white"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                          }`}
                        >
                          🧠 From memory
                        </button>
                      </div>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                        Graduate to from-memory once script-visible runs score well — the modes
                        trend separately.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        if (!agendaScript.trim()) {
                          setGradeError("Write your script first.");
                          return;
                        }
                        setGradeError(null);
                        setAgendaDelivering(true);
                      }}
                      className="px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg shadow-sm"
                    >
                      🎬 Start delivery
                    </button>
                    {gradeError && <p className="text-sm text-red-600 dark:text-red-400">{gradeError}</p>}
                  </>
                ) : (
                  /* Deliver: teleprompter (or memory), record, submit */
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        Deliver it to {pub?.name.split(" ")[0]} — aim for under 90 seconds.
                      </h3>
                      <button
                        onClick={() => setAgendaDelivering(false)}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                      >
                        ← Back to script
                      </button>
                    </div>
                    {agendaMode === "script_visible" ? (
                      <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-[15px] leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                        {agendaScript}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                        🧠 From memory — the script stays hidden. You&rsquo;ve got this.
                      </p>
                    )}
                    {recordingFor === "agenda" ? (
                      <VoiceRecordingInput
                        isActive
                        onCancel={() => setRecordingFor(null)}
                        onDuration={(ms) =>
                          setAgendaDurationMs((prev) => (prev ? prev + ms : ms))
                        }
                        onTranscriptionComplete={(text) => {
                          setAgendaTranscript((prev) => (prev ? `${prev} ${text}` : text));
                          setRecordingFor(null);
                        }}
                      />
                    ) : (
                      <button
                        onClick={() => setRecordingFor("agenda")}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 rounded-lg"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                        {agendaTranscript ? "Record more" : "Record delivery"}
                      </button>
                    )}
                    {(agendaTranscript || agendaDurationMs) && (
                      <div className="space-y-2">
                        {agendaDurationMs !== null && (
                          <span className="inline-block text-xs font-medium bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-1 rounded-full">
                            ⏱ {Math.round(agendaDurationMs / 1000)}s
                            {agendaDurationMs > 90_000 ? " — over target" : ""}
                          </span>
                        )}
                        <textarea
                          value={agendaTranscript}
                          onChange={(e) => setAgendaTranscript(e.target.value)}
                          rows={5}
                          placeholder="Your transcript lands here — or type your delivery."
                          className="w-full text-sm p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
                        />
                      </div>
                    )}
                    {!agendaTranscript && recordingFor !== "agenda" && (
                      <textarea
                        value={agendaTranscript}
                        onChange={(e) => setAgendaTranscript(e.target.value)}
                        rows={3}
                        placeholder="Or type your delivery here (no clock when typed)."
                        className="w-full text-sm p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    )}
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
                        "Submit delivery for grading"
                      )}
                    </button>
                  </>
                )}
              </div>
            ) : session.status !== "completed" && session.drill === "rapport" ? (
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
                  {(session.drill === "rapport" || session.drill === "discovery") &&
                    (session.turns?.length ?? 0) > 0 && (
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-1">
                        {session.drill === "discovery" ? "The conversation" : "The exchange"}
                      </h3>
                      {[
                        ...session.turns!,
                        ...(session.drill === "rapport" && typeof session.answers?.pivot === "string"
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
                  {session.drill === "agenda" && typeof session.answers?.transcript === "string" && (
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">
                          The delivery
                        </h3>
                        <span className="text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
                          {session.answers.mode === "script_hidden" ? "🧠 from memory" : "📜 script visible"}
                        </span>
                        {typeof session.answers.durationMs === "number" && (
                          <span className="text-[11px] font-medium bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                            ⏱ {Math.round((session.answers.durationMs as number) / 1000)}s
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 italic whitespace-pre-wrap">
                        {session.answers.transcript as string}
                      </p>
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
                      onClick={() => rematch(session)}
                      disabled={starting === session.drill}
                      className="px-4 py-2.5 text-sm font-medium border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/30 disabled:opacity-50"
                      title="Same buyer, fresh attempt"
                    >
                      ↻ Rematch this buyer
                    </button>
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
