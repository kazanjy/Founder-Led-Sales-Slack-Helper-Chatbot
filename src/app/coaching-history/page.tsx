"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import SalesNavBar from "@/components/SalesNavBar";
import CoachingFramework from "@/components/CoachingFramework";
import { useConfirmModal } from "@/components/useConfirmModal";

const RichTextEditor = dynamic(() => import("@/components/RichTextEditor"), { ssr: false });
import { ChatAboutButton } from "@/components/ChatAboutButton";
import SyncReviewOverlay from "@/components/SyncReviewOverlay";
// Synthesis prompt lives in a shared module so the server-side
// auto-on-save synthesizer and this client-side "🧪 Synthesize
// Takeaways" CTA use the same text — one source of truth.
import { TAKEAWAYS_SYNTHESIS_PROMPT } from "@/lib/coaching/synthesis-prompt";

interface CoachingSession {
  id: string;
  title: string;
  sessionDate: string;
  notes: string;
  transcript: string | null;
  recordingUrl: string | null;
  sessionStatus: string;
  maturityStage: string | null;
  // Auto-generated synthesis — regenerated on every save by the
  // /synthesize endpoint. Null until the first save completes.
  synthesis: string | null;
  synthesisAt: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  user?: {
    name: string | null;
    email: string | null;
    slackUserName: string | null;
  };
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function sessionUserName(session: CoachingSession): string | null {
  return session.user?.name || session.user?.slackUserName || session.user?.email || null;
}

function formatSessionForChat(session: CoachingSession): string {
  let text = `### Session: ${session.title} — ${formatDate(session.sessionDate)}\n`;
  if (session.sessionStatus) {
    text += `**Status:** ${session.sessionStatus === "new" ? "Live Session" : session.sessionStatus === "in_progress" ? "Live Sprint" : "Archived"}\n`;
  }
  text += `\n`;
  if (session.notes && session.notes !== "(draft)") {
    text += `#### Notes\n${session.notes}\n\n`;
  }
  if (session.transcript) {
    text += `#### Call Transcript\n${session.transcript}\n\n`;
  }
  return text;
}

interface EnrichedSession {
  session: CoachingSession;
  goals?: Array<{ title: string; description?: string; status: string; tasks: Array<{ title: string; description?: string | null; status: string }> }>;
  metricEntries?: Array<{ currentValue: number; addedSinceLastSession: number; metricDefinition: { name: string; format?: string } }>;
  maturityStage?: string | null;
}

async function fetchEnrichedSession(sessionId: string): Promise<EnrichedSession | null> {
  try {
    const res = await fetch(`/api/coaching-sessions/${sessionId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

function formatEnrichedContext(session: CoachingSession, enriched: EnrichedSession | null): string {
  let text = formatSessionForChat(session);

  if (enriched?.maturityStage) {
    text += `#### Sales Maturity Stage\n${enriched.maturityStage}\n\n`;
  }

  if (enriched?.metricEntries && enriched.metricEntries.length > 0) {
    text += `#### Metrics\n`;
    for (const entry of enriched.metricEntries) {
      const delta = entry.addedSinceLastSession ? ` (${entry.addedSinceLastSession > 0 ? "+" : ""}${entry.addedSinceLastSession} since last)` : "";
      text += `- **${entry.metricDefinition.name}:** ${entry.currentValue}${delta}\n`;
    }
    text += `\n`;
  }

  if (enriched?.goals && enriched.goals.length > 0) {
    text += `#### Goals & Tasks\n`;
    for (const goal of enriched.goals) {
      text += `\n**${goal.title}** [${goal.status}]\n`;
      if (goal.description) text += `${goal.description}\n`;
      for (const task of goal.tasks) {
        const check = task.status === "done" ? "x" : " ";
        text += `- [${check}] ${task.title}`;
        if (task.status === "not_doing") text += ` ~~(not doing)~~`;
        if (task.status === "deprioritized") text += ` *(deprioritized)*`;
        text += `\n`;
        if (task.description) text += `  ${task.description}\n`;
      }
    }
    text += `\n`;
  }

  return text;
}

async function buildEnrichedChatContext(sessions: CoachingSession[]): Promise<string> {
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime()
  );

  // Fetch enriched data for all sessions in parallel
  const enrichedData = await Promise.all(
    sorted.map((s) => fetchEnrichedSession(s.id))
  );

  // Also fetch maturity stage, next goals, and the user's current active
  // goals + tasks (mirrors what CoachingFramework shows in the UI). The
  // per-session enriched data only carries goals natively created in
  // that session; carry-forward active goals from prior sessions are
  // surfaced separately so the chat sees the same live state the user
  // sees, not a session-scoped snapshot.
  let maturityStage: string | null = null;
  let nextGoals: Array<{ title: string; description?: string; tasks: Array<{ title: string; description?: string | null }> }> = [];
  let activeGoals: Array<{ title: string; description?: string | null; status: string; tasks: Array<{ title: string; description?: string | null; status: string }> }> = [];
  try {
    const [stageRes, nextRes, activeRes] = await Promise.all([
      fetch("/api/coaching/maturity-stage"),
      fetch("/api/coaching/next-goals"),
      fetch("/api/coaching/goals?status=active"),
    ]);
    if (stageRes.ok) {
      const d = await stageRes.json();
      maturityStage = d.stage?.currentStage || null;
    }
    if (nextRes.ok) {
      const d = await nextRes.json();
      nextGoals = d.goals || [];
    }
    if (activeRes.ok) {
      const d = await activeRes.json();
      activeGoals = d.goals || [];
    }
  } catch { /* ignore */ }

  let context = "## Coaching History\n\n";
  context += `*${sorted.length} session${sorted.length !== 1 ? "s" : ""} from ${formatDate(sorted[0].sessionDate)} to ${formatDate(sorted[sorted.length - 1].sessionDate)}*\n\n`;

  if (maturityStage) {
    context += `**Current Sales Maturity Stage:** ${maturityStage}\n\n`;
  }

  context += `---\n\n`;
  context += sorted.map((s, i) => formatEnrichedContext(s, enrichedData[i])).join("---\n\n");

  // Current active goals + tasks across every session — this is what the
  // user sees in the Goals & Tasks panel right now. Includes carry-forward
  // goals from prior sessions that the session-scoped enriched view
  // intentionally omits.
  if (activeGoals.length > 0) {
    context += `---\n\n### Current Active Goals & Tasks\n\n`;
    for (const goal of activeGoals) {
      context += `**${goal.title}** [${goal.status}]\n`;
      if (goal.description) context += `${goal.description}\n`;
      for (const task of goal.tasks) {
        const check = task.status === "done" ? "x" : " ";
        context += `- [${check}] ${task.title}`;
        if (task.status === "not_doing") context += ` ~~(not doing)~~`;
        if (task.status === "deprioritized") context += ` *(deprioritized)*`;
        context += `\n`;
        if (task.description) context += `  ${task.description}\n`;
      }
      context += `\n`;
    }
  }

  // Add Up Next items
  if (nextGoals.length > 0) {
    context += `---\n\n### Up Next (Future Goals Queue)\n\n`;
    for (const goal of nextGoals) {
      context += `**${goal.title}**\n`;
      if (goal.description) context += `${goal.description}\n`;
      for (const task of goal.tasks) {
        context += `- ${task.title}\n`;
        if (task.description) context += `  ${task.description}\n`;
      }
      context += `\n`;
    }
  }

  return context;
}

function formatSessionsForChat(sessions: CoachingSession[]): string {
  // Sort chronologically (oldest first) so LLM sees progression
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime()
  );
  let context = "## Coaching History\n\n";
  context += `*${sorted.length} session${sorted.length !== 1 ? "s" : ""} from ${formatDate(sorted[0].sessionDate)} to ${formatDate(sorted[sorted.length - 1].sessionDate)}*\n\n---\n\n`;
  context += sorted.map(formatSessionForChat).join("---\n\n");
  return context;
}

export default function CoachingHistoryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4 dark:text-purple-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    }>
      <CoachingHistoryContent />
    </Suspense>
  );
}

function CoachingHistoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sessions, setSessions] = useState<CoachingSession[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("session"));
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"view" | "create" | "edit">("view");
  // Tracks which session id has a synthesis-in-flight so the view
  // panel can render a "Generating synthesis…" placeholder beneath
  // the notes/transcript area until the background job lands.
  const [synthesizingSessionId, setSynthesizingSessionId] = useState<string | null>(null);
  const [headerCompact, setHeaderCompact] = useState(false);

  useEffect(() => {
    const onScroll = () => setHeaderCompact(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formTranscript, setFormTranscript] = useState("");
  // Brief "Copied" badge next to the transcript label after a copy.
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [synthesisCopied, setSynthesisCopied] = useState(false);
  const [formRecordingUrl, setFormRecordingUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoSavedId, setAutoSavedId] = useState<string | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [lastAutoSaved, setLastAutoSaved] = useState<Date | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [showSyncOverlay, setShowSyncOverlay] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [syncData, setSyncData] = useState<any>(null);
  const [whatNextLoading, setWhatNextLoading] = useState(false);
  const { confirm: showConfirm, ConfirmModalElement } = useConfirmModal();

  // Desktop-only collapse for the left history tray. Persisted so the
  // user's preference survives reloads. Mobile keeps its existing
  // selectedId-driven view-vs-list behaviour and ignores this state.
  const [historyOpen, setHistoryOpen] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("coachingHistory:trayOpen");
    if (saved === "false") setHistoryOpen(false);
  }, []);
  const toggleHistory = (next: boolean) => {
    setHistoryOpen(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("coachingHistory:trayOpen", next ? "true" : "false");
    }
  };

  // Sync selectedId with URL query param
  const selectSession = useCallback((id: string | null) => {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set("session", id);
    } else {
      params.delete("session");
    }
    const qs = params.toString();
    router.replace(`/coaching-history${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  const loadSessions = useCallback(async () => {
    try {
      const authRes = await fetch("/api/auth/me");
      const authData = await authRes.json();
      if (!authData.user) {
        router.push("/?error=not_logged_in");
        return;
      }
      const res = await fetch("/api/coaching-sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions);
        if (data.currentUserId) setCurrentUserId(data.currentUserId);
      }
    } catch (error) {
      console.error("Failed to load coaching sessions:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Coaching History - Mikey";
    loadSessions();
  }, [loadSessions]);

  // Default-select the most recent session on initial nav from the
  // nav bar (no ?session= in the URL). Runs once after the first
  // sessions fetch resolves. Drafts are skipped — the autosaved
  // draft sits at the top of the list whenever the user has clicked
  // "New Session" but hasn't promoted yet, and landing on a draft
  // would be confusing.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (loading) return;
    if (selectedId) {
      autoSelectedRef.current = true;
      return;
    }
    if (searchParams.get("session")) return;
    const mostRecent = sessions.find((s) => s.notes !== "(draft)");
    if (mostRecent) {
      autoSelectedRef.current = true;
      selectSession(mostRecent.id);
    }
  }, [loading, sessions, selectedId, searchParams, selectSession]);

  const selectedSession = sessions.find((s) => s.id === selectedId) || null;
  const checkedSessions = sessions.filter((s) => checkedIds.has(s.id));

  const resetForm = () => {
    setFormTitle("");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormNotes("");
    setFormTranscript("");
    setFormRecordingUrl("");
  };

  const startCreate = async () => {
    if (creatingDraft) return; // Prevent double-click
    resetForm();
    setAutoSavedId(null);
    setCreatingDraft(true);
    setMode("create");

    // Immediately create a draft session so CoachingFramework has a
    // sessionId. lockPrior=true tells the server to lock every other
    // open session for this user as part of creating the draft —
    // clicking "New Session" is a strong enough signal that the prior
    // session is done. handleSave will pass the same flag on the
    // promotion PUT as a belt-and-suspenders against any abandoned-
    // draft / out-of-order edge case.
    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await fetch("/api/coaching-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionDate: today, notes: "(draft)", lockPrior: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setAutoSavedId(data.session.id);
        selectSession(data.session.id);
        // Refresh from the server so the now-locked prior sessions
        // show their updated status pills in the sidebar.
        await loadSessions();
      }
    } catch { /* will auto-save later */ }
    setCreatingDraft(false);
  };

  const startEdit = (session: CoachingSession) => {
    setFormTitle(session.title);
    setFormDate(new Date(session.sessionDate).toISOString().split("T")[0]);
    setFormNotes(session.notes);
    setFormTranscript(session.transcript || "");
    setFormRecordingUrl(session.recordingUrl || "");
    selectSession(session.id);
    setMode("edit");
  };

  const handleSave = async () => {
    if (!formDate) return;

    setSaving(true);
    try {
      // lockPrior is set on the explicit "Create Session" click only —
      // the 3-second autosave below uses the same PUT endpoint without
      // this flag, so prior sessions don't get locked while the user
      // is mid-draft.
      const isPromotingDraft = mode === "create" && !!autoSavedId;
      const payload = {
        title: formTitle,
        sessionDate: formDate,
        notes: formNotes,
        transcript: formTranscript || null,
        recordingUrl: formRecordingUrl || null,
        ...(isPromotingDraft ? { lockPrior: true } : {}),
      };

      // Always update existing session — draft is created on "New Session" click
      const updateId = selectedId || autoSavedId;
      let res: Response;
      if (updateId) {
        res = await fetch(`/api/coaching-sessions/${updateId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/coaching-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        const data = await res.json();
        await loadSessions();
        selectSession(data.session.id);
        setMode("view");
        // Fire-and-forget synthesis. We don't await it — the save UX
        // completes immediately; the synthesis panel renders its own
        // "Generating..." state until this resolves, then refreshes.
        const sid = data.session.id as string;
        setSynthesizingSessionId(sid);
        fetch(`/api/coaching-sessions/${sid}/synthesize`, { method: "POST" })
          .then(async (r) => {
            if (r.ok) {
              // Refresh sessions so the new synthesis lands in state.
              await loadSessions();
            } else {
              console.error("[synthesize] non-200 from synthesize endpoint:", r.status);
            }
          })
          .catch((err) => {
            console.error("[synthesize] background synthesis failed:", err);
          })
          .finally(() => {
            setSynthesizingSessionId((cur) => (cur === sid ? null : cur));
          });
      }
    } catch (error) {
      console.error("Failed to save session:", error);
    } finally {
      setSaving(false);
    }
  };

  // Auto-save in create mode — debounced 3 seconds after any change
  useEffect(() => {
    if (mode !== "create" || !formDate || !autoSavedId) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(async () => {
      const payload = {
        title: formTitle || undefined,
        sessionDate: formDate,
        notes: formNotes,
        transcript: formTranscript || null,
        recordingUrl: formRecordingUrl || null,
      };

      try {
        // Always update the existing draft — never create a new one
        await fetch(`/api/coaching-sessions/${autoSavedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setLastAutoSaved(new Date());
      } catch {
        // Silently fail — user can still manually save
      }
    }, 3000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [mode, formTitle, formDate, formNotes, formTranscript, formRecordingUrl, autoSavedId]);

  // When manually saving a session that was auto-saved, use the auto-saved ID
  const handleSaveWrapper = async () => {
    if (mode === "create" && autoSavedId) {
      // Switch to edit mode with the auto-saved ID so handleSave updates it
      selectSession(autoSavedId);
      setMode("edit");
      // Small delay to let state settle, then save
      setTimeout(() => handleSave(), 100);
      return;
    }
    handleSave();
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const confirmed = await showConfirm({
      title: "Delete Session",
      message: "Are you sure you want to delete this coaching session? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/coaching-sessions/${selectedId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        selectSession(null);
        setMode("view");
        setCheckedIds((prev) => {
          const next = new Set(prev);
          next.delete(selectedId);
          return next;
        });
        await loadSessions();
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
    } finally {
      setDeleting(false);
    }
  };

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Fire the readiness sync silently in the background and open the
  // review overlay only if the LLM proposed any changes (or a new
  // maturity stage). Used by the auto-trigger on Start Sprint so the
  // common "nothing to review" case doesn't pop a modal in the user's
  // face every time they advance a session.
  //
  // Flips the same syncLoading flag the manual "Sync to GTM Readiness"
  // button uses, so the header button shows its spinner while the
  // LLM call is in flight — gives the user a visible signal that
  // something is happening without yet committing to the modal.
  const runReadinessSyncSilentIfEmpty = async () => {
    setSyncLoading(true);
    try {
      const res = await fetch("/api/sales-readiness/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "coaching" }),
      });
      if (!res.ok) return;
      const data = await res.json();
      // Open the review overlay only when the LLM actually proposed
      // something to review. The endpoint doesn't currently return the
      // user's current maturity stage, so we don't compare against it
      // here — recommendedStage alone is rarely the only signal in
      // practice, and adding a noisy stage-only popup wasn't worth
      // chasing in this pass.
      const hasChanges = (data.proposedChanges?.length ?? 0) > 0;
      if (hasChanges) {
        setSyncData(data);
        setShowSyncOverlay(true);
      }
    } catch (err) {
      // Auto-sync failure shouldn't disrupt the originating action.
      console.error("[readiness-sync] auto-trigger failed:", err);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleStartSprint = async (sessionId: string) => {
    await fetch(`/api/coaching-sessions/${sessionId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });
    loadSessions();
    // Kick off the readiness sync in the background — Start Sprint is
    // the moment the user has just locked in their plan from the most
    // recent coaching, so it's a good time to surface any readiness
    // moves the LLM has spotted. Don't await — we don't want to block
    // the click and we don't want to keep a spinner up.
    void runReadinessSyncSilentIfEmpty();
  };

  const handleSyncCoachingToReadiness = async () => {
    setSyncLoading(true);
    try {
      const res = await fetch("/api/sales-readiness/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "coaching" }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncData(data);
        setShowSyncOverlay(true);
      } else {
        console.error("Sync failed:", data.error);
      }
    } catch (error) {
      console.error("Error syncing:", error);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleApplySync = async (selectedItemIds: string[], acceptStage: boolean) => {
    if (!syncData) return;

    const changes = syncData.proposedChanges.filter((c: { itemId: string }) =>
      selectedItemIds.includes(c.itemId)
    );

    await Promise.all(
      changes.map((change: { itemId: string; proposedStatus: string; evidenceText: string }) =>
        fetch(`/api/sales-readiness/${change.itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: change.proposedStatus,
            evidenceUrl: change.evidenceText,
          }),
        })
      )
    );

    if (acceptStage && syncData.recommendedStage) {
      await fetch("/api/coaching/maturity-stage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentStage: syncData.recommendedStage.stage }),
      });
    }

    // Save sync history
    await fetch("/api/sales-readiness/sync-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "coaching",
        sourceContent: syncData.sourceContent || "",
        analysisResult: {
          proposedChanges: syncData.proposedChanges,
          recommendedStage: syncData.recommendedStage,
        },
        acceptedItemIds: selectedItemIds,
        stageAccepted: acceptStage && !!syncData.recommendedStage,
        totalProposed: syncData.proposedChanges.length,
        totalAccepted: selectedItemIds.length,
      }),
    }).catch(() => {});

    setShowSyncOverlay(false);
    setSyncData(null);
  };

  const handleWhatNext = async () => {
    setWhatNextLoading(true);
    try {
      // Build context from readiness state + coaching sessions.
      // The headline question goes first so the model reads it before
      // wading through the structured state below.
      let context = "Based on the most recent coaching discussions, where did we leave off and what's next?\n\n---\n\n";

      // Fetch readiness state
      try {
        const readinessRes = await fetch("/api/sales-readiness");
        if (readinessRes.ok) {
          const data = await readinessRes.json();
          context += "## Current GTM Readiness Progression State\n\n";
          if (data.currentMaturityStage) {
            context += `**Current Maturity Stage:** ${data.currentMaturityStage}\n\n`;
          }
          if (data.overall) {
            context += `**Overall Progress:** ${data.overall.done}/${data.overall.total} done, ${data.overall.inProgress} in progress, ${data.overall.upNext} up next, ${data.overall.toDo} to do\n\n`;
          }
          for (const stage of data.stages || []) {
            context += `### ${stage.label} (${stage.doneCount}/${stage.totalCount})\n`;
            for (const cat of stage.categories) {
              const nonTodoItems = cat.items.filter((i: { status: string }) => i.status !== "to_do");
              if (nonTodoItems.length > 0) {
                context += `**${cat.name}** (${cat.doneCount}/${cat.totalCount})\n`;
                for (const item of nonTodoItems) {
                  context += `- [${item.status}] ${item.title}`;
                  if (item.evidenceUrl) context += ` — Evidence: ${item.evidenceUrl}`;
                  context += "\n";
                }
                context += "\n";
              }
            }
          }
        }
      } catch { /* no readiness data */ }

      // Add last 3 coaching sessions
      const recentSessions = [...sessions]
        .sort((a, b) => new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime())
        .slice(0, 3);

      if (recentSessions.length > 0) {
        context += "\n---\n\n## Recent Coaching Sessions\n\n";
        for (const session of recentSessions) {
          try {
            const enrichedRes = await fetch(`/api/coaching-sessions/${session.id}`);
            if (enrichedRes.ok) {
              const enriched = await enrichedRes.json();
              const sessionDate = new Date(session.sessionDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              context += `### ${session.title} (${sessionDate})\n\n`;
              if (session.notes) {
                const notesTruncated = session.notes.length > 2000
                  ? session.notes.substring(0, 2000) + "...[truncated]"
                  : session.notes;
                context += `**Notes:**\n${notesTruncated}\n\n`;
              }
              if (enriched.goals?.length > 0) {
                context += "**Goals:**\n";
                for (const goal of enriched.goals) {
                  context += `- [${goal.status.toUpperCase()}] ${goal.title}`;
                  if (goal.description) context += `: ${goal.description}`;
                  context += "\n";
                  if (goal.tasks) {
                    for (const task of goal.tasks) {
                      context += `  - [${task.status.toUpperCase()}] ${task.title}\n`;
                    }
                  }
                }
                context += "\n";
              }
              // Transcripts ride alongside notes so the model has the
              // verbatim record of what was discussed, not just the
              // post-hoc summary. Cap at 30k chars per transcript so
              // one long call doesn't dominate; with 3 sessions that's
              // ~90k chars / ~22k tokens, well within GPT's window.
              if (session.transcript) {
                const transcriptTruncated = session.transcript.length > 30000
                  ? session.transcript.substring(0, 30000) + "\n...[transcript truncated]"
                  : session.transcript;
                context += `**Transcript:**\n${transcriptTruncated}\n\n`;
              }
            }
          } catch { /* skip */ }
        }
      }

      context += "\n---\n\n## Your Request\n\n";
      context += "Based on my current GTM Readiness Progression state and recent coaching sessions above, what should I focus on next? ";
      context += "Please recommend the top 3-5 specific actions I should take, considering:\n";
      context += "1. What capabilities I'm missing or have in progress at my current maturity stage\n";
      context += "2. What my coaching goals and tasks suggest I should prioritize\n";
      context += "3. What would have the highest impact on moving to the next maturity stage\n\n";
      context += "For each recommendation, explain WHY it matters and link it to specific readiness items or coaching goals.";

      const res = await fetch("/api/conversations/from-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "What Next? — Coaching & Readiness Recommendations",
          context,
          autoSend: true,
          // GPT direct mode so the model gets the full context window
          // (transcripts + readiness state + coaching goals/tasks)
          // rather than going through Chatbase's RAG pipeline.
          mode: "DIRECT",
        }),
      });
      const data = await res.json();
      if (data.conversationId) {
        sessionStorage.setItem(`autoSend-${data.conversationId}`, context);
        window.open(`/chat/${data.conversationId}?autoSend=true`, "_blank");
      }
    } catch (error) {
      console.error("Error creating What Next chat:", error);
    } finally {
      setWhatNextLoading(false);
    }
  };

  const toggleCheckAll = () => {
    if (checkedIds.size === sessions.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(sessions.map((s) => s.id)));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SalesNavBar />

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Coaching History</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Log coaching sessions with notes and transcripts, then chat with Mikey about your progress.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {sessions.length > 0 && (
              <button
                onClick={handleSyncCoachingToReadiness}
                disabled={syncLoading}
                title={syncLoading ? "Analyzing coaching sessions for readiness updates…" : undefined}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors font-medium text-sm disabled:opacity-70 dark:text-purple-300 dark:bg-purple-900/30"
              >
                {syncLoading ? (
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {syncLoading ? "Syncing to GTM Readiness…" : "Sync to GTM Readiness"}
              </button>
            )}
            {sessions.length > 0 && (
              <button
                onClick={handleWhatNext}
                disabled={whatNextLoading}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium text-sm shadow-sm hover:shadow-md disabled:opacity-50"
              >
                {whatNextLoading ? (
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                What Next?
              </button>
            )}
            {sessions.length > 0 && (
              <ChatAboutButton
                title="Coaching History — All Sessions"
                getContext={() => buildEnrichedChatContext(sessions)}
                label="Chat All Sessions"
              />
            )}
            <button
              onClick={startCreate}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Session
            </button>
          </div>
        </div>

        {/* Chat with selected banner */}
        {checkedSessions.length > 1 && (
          <div className="mb-4 p-3 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-lg flex items-center justify-between">
            <span className="text-sm text-purple-700 dark:text-purple-300">
              {checkedSessions.length} sessions selected
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCheckedIds(new Set())}
                className="text-sm text-purple-600 hover:text-purple-800 hover:underline dark:text-purple-300"
              >
                Clear
              </button>
              <ChatAboutButton
                title={`Coaching History — ${checkedSessions.length} Sessions`}
                getContext={() => buildEnrichedChatContext(checkedSessions)}
                label={`Chat About ${checkedSessions.length} Sessions`}
              />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin h-8 w-8 text-purple-600 dark:text-purple-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : sessions.length === 0 && mode !== "create" ? (
          /* Empty state */
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/40 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-purple-600 dark:text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">No coaching sessions yet</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
              Log your coaching calls and sessions here. Add notes, paste transcripts, and chat with Mikey about your coaching progress over time.
            </p>
            <button
              onClick={startCreate}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Your First Session
            </button>
          </div>
        ) : (
          /* Two-panel layout */
          <div className="flex gap-6">
            {/* Collapsed-state rail — desktop only, swaps in for the
                full panel when historyOpen is false. Shows a narrow
                column of date-only chips so users still have one-click
                access to recent sessions without the full sidebar
                taking up real estate. Mobile ignores this state. */}
            {!historyOpen && (
              <div className="hidden md:flex flex-col flex-shrink-0 gap-2 w-16">
                <button
                  onClick={() => toggleHistory(true)}
                  title="Show history"
                  aria-label="Show history"
                  className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 self-start"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto pr-0.5">
                  {sessions
                    .filter((s) => {
                      if (s.notes === "(draft)" && s.id !== autoSavedId) return false;
                      if (s.notes === "(draft)" && mode !== "create") return false;
                      return true;
                    })
                    .map((session) => {
                      const isActive =
                        mode === "create"
                          ? session.id === autoSavedId
                          : selectedId === session.id;
                      const date = new Date(session.sessionDate);
                      const month = date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
                      const day = date.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
                      const dotColor =
                        session.sessionStatus === "new" ? "bg-blue-500" :
                        session.sessionStatus === "in_progress" ? "bg-orange-500" :
                        "bg-gray-400";
                      const statusLabel =
                        session.sessionStatus === "new" ? "Live Session" :
                        session.sessionStatus === "in_progress" ? "Live Sprint" :
                        "Locked";
                      return (
                        <div
                          key={session.id}
                          role="button"
                          tabIndex={0}
                          title={`${formatDate(session.sessionDate)} · ${statusLabel}\n${session.title}`}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey) {
                              window.open(`/coaching-history?session=${session.id}`, "_blank");
                              return;
                            }
                            selectSession(session.id);
                            setMode("view");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectSession(session.id);
                              setMode("view");
                            }
                          }}
                          className={`relative w-16 h-16 rounded-lg border cursor-pointer flex flex-col items-center justify-center transition-colors ${
                            isActive
                              ? "border-purple-300 bg-purple-50"
                              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                          }`}
                        >
                          <span className={`absolute top-1 right-1 inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
                          <div className="text-[10px] uppercase text-gray-500 dark:text-gray-400 leading-none tracking-wide">{month}</div>
                          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 leading-none mt-1">{day}</div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
            {/* Left panel: Session list — hidden on mobile when viewing
                a session, hidden on desktop when collapsed. */}
            <div className={`w-full md:w-80 flex-shrink-0 ${selectedId && mode === "view" ? "hidden md:block" : ""} ${!historyOpen ? "md:hidden" : ""}`}>
              <div className="mb-2 px-2 flex items-center justify-between min-h-[20px]">
                {sessions.length > 1 ? (
                  <button
                    onClick={toggleCheckAll}
                    className="text-xs text-purple-600 hover:text-purple-800 hover:underline dark:text-purple-300"
                  >
                    {checkedIds.size === sessions.length ? "Deselect all" : "Select all"}
                  </button>
                ) : <span />}
                <button
                  onClick={() => toggleHistory(false)}
                  title="Hide history"
                  aria-label="Hide history"
                  className="hidden md:inline-flex p-1 -mr-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              </div>
              <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
                {sessions.filter((s) => {
                  // Hide draft sessions from sidebar unless it's the active draft in create mode
                  if (s.notes === "(draft)" && s.id !== autoSavedId) return false;
                  if (s.notes === "(draft)" && mode !== "create") return false;
                  return true;
                }).map((session) => {
                  const isActive =
                    mode === "create"
                      ? session.id === autoSavedId
                      : selectedId === session.id;
                  return (
                    <div
                      key={session.id}
                      className={`group relative rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                        isActive
                          ? "border-purple-300 bg-purple-50"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                      }`}
                      onClick={(e) => {
                        // Cmd+click or Ctrl+click: open in new tab
                        if (e.metaKey || e.ctrlKey) {
                          window.open(`/coaching-history?session=${session.id}`, "_blank");
                          return;
                        }
                        selectSession(session.id);
                        setMode("view");
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={checkedIds.has(session.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleCheck(session.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 rounded border-gray-300 dark:border-gray-700 text-purple-600 focus:ring-purple-500 dark:text-purple-300"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {formatDate(session.sessionDate)}
                              {sessionUserName(session) && (
                                <span className="ml-1.5 text-gray-400">· {sessionUserName(session)}</span>
                              )}
                            </div>
                            <span className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                              session.sessionStatus === "new" ? "bg-blue-100 text-blue-700" :
                              session.sessionStatus === "in_progress" ? "bg-orange-100 text-orange-700" :
                              "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
                            }`}>
                              {session.sessionStatus === "new" ? "Live Session" :
                               session.sessionStatus === "in_progress" ? "Live Sprint" :
                               "Locked"}
                            </span>
                          </div>
                          <div className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate" title={session.title}>
                            {session.title}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right panel: Detail or Form — full width on mobile */}
            <div className={`flex-1 min-w-0 ${!selectedId && mode === "view" ? "hidden md:block" : ""}`}>
              {mode === "create" || mode === "edit" ? (
                creatingDraft ? (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 flex items-center justify-center">
                    <div className="flex items-center gap-3 text-gray-400">
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="text-sm font-medium">Setting up session...</span>
                    </div>
                  </div>
                ) :
                /* Create/Edit Form */
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                  <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                      {mode === "edit" ? "Edit Session" : "New Coaching Session"}
                    </h2>
                    <button
                      onClick={handleSaveWrapper}
                      disabled={saving || !formDate}
                      className="inline-flex items-center gap-2 px-5 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-sm"
                    >
                      {saving && (
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      {mode === "edit" ? "Save Changes" : "Create Session"}
                    </button>
                  </div>

                  {/* Coaching Framework — at top of form. Edit mode mirrors
                      the view-mode mount's prop set so the same session data
                      loads in both views. Hardcoding sessionStatus="new" /
                      omitting sessionUserId here caused goals to appear in
                      edit mode (querying the current user's active goals)
                      and disappear on save (view mode queries the session
                      owner's goals via sessionUserId), even though the
                      underlying session never changed. */}
                  {((mode === "edit" && selectedId) || (mode === "create" && autoSavedId)) && (
                    <div className="px-6 pt-6">
                      <CoachingFramework
                        sessionId={(mode === "edit" ? selectedId : autoSavedId)!}
                        sessionStatus={mode === "edit" ? (selectedSession?.sessionStatus || "new") : "new"}
                        isOwner={true}
                        sessionCreatedAt={mode === "edit" ? selectedSession?.createdAt : undefined}
                        sessionUpdatedAt={mode === "edit" ? selectedSession?.updatedAt : undefined}
                        sessionUserId={mode === "edit" && selectedSession && selectedSession.userId !== currentUserId ? selectedSession.userId : undefined}
                      />
                    </div>
                  )}

                  <div className="p-6 space-y-5">
                    {/* Title */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                        Session Title <span className="font-normal text-gray-400">(optional — auto-generated if blank)</span>
                      </label>
                      <input
                        type="text"
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        placeholder="e.g. Weekly Coaching Call, Pipeline Review"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    {/* Recording URL */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                        Meeting Recording <span className="font-normal text-gray-400">(optional)</span>
                      </label>
                      <input
                        type="url"
                        value={formRecordingUrl}
                        onChange={(e) => setFormRecordingUrl(e.target.value)}
                        placeholder="https://zoom.us/rec/... or any recording link"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                        Session Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={formDate}
                        onChange={(e) => setFormDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    {/* Notes — rich text */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                        Session Notes <span className="font-normal text-gray-400">(optional)</span>
                      </label>
                      <RichTextEditor
                        value={formNotes}
                        onChange={setFormNotes}
                        height={250}
                        placeholder="Key takeaways, action items, coaching feedback, areas to work on..."
                      />
                    </div>

                    {/* Transcript */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                          Call Transcript <span className="font-normal text-gray-400">(optional)</span>
                        </label>
                        {formTranscript.trim().length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(formTranscript);
                              setTranscriptCopied(true);
                              setTimeout(() => setTranscriptCopied(false), 1500);
                            }}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-300 inline-flex items-center gap-1"
                            title="Copy transcript to clipboard"
                          >
                            {transcriptCopied ? (
                              <>
                                <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                                Copied
                              </>
                            ) : (
                              <>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                Copy
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      <textarea
                        value={formTranscript}
                        onChange={(e) => setFormTranscript(e.target.value)}
                        placeholder="Paste your call transcript here..."
                        rows={6}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y font-mono text-sm"
                      />
                    </div>

                  </div>

                  {/* Form actions */}
                  <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 rounded-b-xl flex items-center justify-between dark:bg-gray-900/30">
                    <button
                      onClick={async () => {
                        // Delete the draft session if canceling create mode
                        if (mode === "create" && autoSavedId) {
                          await fetch(`/api/coaching-sessions/${autoSavedId}`, { method: "DELETE" });
                          setSessions((prev) => prev.filter((s) => s.id !== autoSavedId));
                          setAutoSavedId(null);
                        }
                        setMode("view");
                        if (!selectedId && sessions.length > 0) {
                          const firstReal = sessions.find((s) => s.id !== autoSavedId);
                          selectSession(firstReal?.id || sessions[0]?.id || null);
                        }
                      }}
                      className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                    >
                      Cancel
                    </button>
                    <div className="flex items-center gap-3">
                      {lastAutoSaved && mode === "create" && (
                        <span className="text-xs text-green-500 flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Auto-saved {lastAutoSaved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </span>
                      )}
                      {!saving && !formDate && (
                        <span className="text-xs text-gray-400">Date required</span>
                      )}
                    <button
                      onClick={handleSaveWrapper}
                      disabled={saving || !formDate}
                      className="inline-flex items-center gap-2 px-5 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                    >
                      {saving && (
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      {mode === "edit" ? "Save Changes" : "Create Session"}
                    </button>
                    </div>
                  </div>
                </div>
              ) : selectedSession ? (
                /* Session Detail View */
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                  {/* Mobile back button */}
                  <button
                    onClick={() => selectSession(null)}
                    className="md:hidden flex items-center gap-1 px-4 pt-3 text-sm text-purple-600 hover:text-purple-800 dark:text-purple-300"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    All Sessions
                  </button>
                  <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 rounded-t-xl p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                        <span>{formatDate(selectedSession.sessionDate)}</span>
                        {sessionUserName(selectedSession) && (
                          <span className="text-gray-400">· {sessionUserName(selectedSession)}</span>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          selectedSession.sessionStatus === "new" ? "bg-blue-100 text-blue-700" :
                          selectedSession.sessionStatus === "in_progress" ? "bg-orange-100 text-orange-700" :
                          "bg-gray-100 text-gray-500 dark:text-gray-400"
                        }`}>
                          {selectedSession.sessionStatus === "new" ? "Live Session" :
                           selectedSession.sessionStatus === "in_progress" ? "Live Sprint" :
                           "Locked"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {true /* any account member can take session actions */ && selectedSession.sessionStatus === "new" && (
                          <button
                            onClick={() => handleStartSprint(selectedSession.id)}
                            className="px-2.5 py-1.5 text-xs bg-orange-50 text-orange-600 hover:bg-orange-100 rounded-lg transition-colors font-medium dark:bg-orange-900/30 dark:text-orange-300"
                          >
                            Start Sprint
                          </button>
                        )}
                        {true /* any account member can take session actions */ && (selectedSession.sessionStatus === "new" || selectedSession.sessionStatus === "in_progress") && (
                          <button
                            onClick={async () => {
                              await fetch(`/api/coaching-sessions/${selectedSession.id}/status`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "locked" }),
                              });
                              loadSessions();
                            }}
                            className="px-2.5 py-1.5 text-xs bg-gray-100 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors font-medium dark:bg-gray-900/40"
                          >
                            Lock Session
                          </button>
                        )}
                        {true /* any account member can take session actions */ && (
                          <>
                            <button
                              onClick={() => startEdit(selectedSession)}
                              className="px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={handleDelete}
                              disabled={deleting}
                              className="px-2.5 py-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {deleting ? "..." : "Delete"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2 truncate" title={selectedSession.title}>{selectedSession.title}</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <ChatAboutButton
                        title={`Coaching: ${selectedSession.title}`}
                        getContext={() => buildEnrichedChatContext([selectedSession])}
                        label="Chat About This"
                        compact={headerCompact}
                      />
                      <ChatAboutButton
                        title={`Takeaways: ${selectedSession.title}`}
                        // Prompt FIRST, then the session context. The
                        // synthesis instructions need to anchor the
                        // model's reading of everything below — putting
                        // them at the bottom risks them getting
                        // out-weighted by the transcript's bulk.
                        getContext={async () => {
                          const ctx = await buildEnrichedChatContext([selectedSession]);
                          return `${TAKEAWAYS_SYNTHESIS_PROMPT}\n\n---\n\n${ctx}`;
                        }}
                        // DIRECT mode: the enriched session context
                        // (notes + transcript + goals/tasks) regularly
                        // blows past Chatbase's 7,500-char ceiling, and
                        // synthesis quality depends on the model seeing
                        // the full transcript not a RAG-retrieved slice.
                        mode="DIRECT"
                        label="🧪 Synthesize Takeaways"
                        compact={headerCompact}
                      />
                      {selectedSession.recordingUrl && (
                        <a
                          href={selectedSession.recordingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 rounded-lg transition-all ${headerCompact ? "gap-1 px-2 py-1 text-xs" : "gap-1.5 px-3 py-2 text-sm"}`}
                        >
                          <svg className={headerCompact ? "w-3 h-3" : "w-4 h-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Recording
                          <svg className={headerCompact ? "w-2.5 h-2.5" : "w-3 h-3"} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="p-6">
                    {/* Session Synthesis — auto-generated after every save
                        using the same prompt as the manual "Synthesize
                        Takeaways" CTA. Sits between the session header
                        and the Coaching Framework (which carries Up Next
                        + Goals/Tasks below) so the founder sees the
                        rollup of "what we discussed / agreed / will do
                        next" before any of the working surface. Renders
                        an inline placeholder while the background job
                        runs; hides entirely when there's no synthesis
                        yet AND no job in flight (legacy sessions saved
                        before this feature). */}
                    {(selectedSession.synthesis ||
                      synthesizingSessionId === selectedSession.id) && (
                      <div className="mb-8 bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-900 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-purple-700 dark:text-purple-200 uppercase tracking-wider inline-flex items-center gap-2">
                            🧪 Session Synthesis
                            {synthesizingSessionId === selectedSession.id && (
                              <span className="text-xs text-purple-500 dark:text-purple-300 font-normal normal-case inline-flex items-center gap-1">
                                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                </svg>
                                Generating…
                              </span>
                            )}
                            {selectedSession.synthesisAt && synthesizingSessionId !== selectedSession.id && (
                              <span className="text-[11px] text-purple-500 dark:text-purple-400 font-normal normal-case">
                                · updated {new Date(selectedSession.synthesisAt).toLocaleString()}
                              </span>
                            )}
                          </h3>
                          {selectedSession.synthesis && (
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(selectedSession.synthesis || "");
                                setSynthesisCopied(true);
                                setTimeout(() => setSynthesisCopied(false), 1500);
                              }}
                              className="text-xs text-purple-600 dark:text-purple-300 hover:text-purple-800 dark:hover:text-purple-100 inline-flex items-center gap-1"
                              title="Copy synthesis to clipboard"
                            >
                              {synthesisCopied ? (
                                <>
                                  <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                  Copied
                                </>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                  Copy
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        {selectedSession.synthesis ? (
                          <div className="prose dark:prose-invert max-w-none prose-sm prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1.5 prose-ul:my-1.5 prose-li:my-0">
                            <ReactMarkdown>{selectedSession.synthesis}</ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-sm text-purple-600 dark:text-purple-300 italic">
                            Synthesizing what you discussed, agreed, and what's next…
                          </p>
                        )}
                      </div>
                    )}

                    {/* Coaching Framework — Maturity Stage, Metrics, Goals & Tasks */}
                    <CoachingFramework
                      sessionId={selectedSession.id}
                      sessionStatus={selectedSession.sessionStatus || "new"}
                      // Account members can now edit each other's
                      // sessions, so any visible session in the list
                      // grants edit rights. The API still enforces
                      // same-account membership per request.
                      isOwner={true}
                      sessionCreatedAt={selectedSession.createdAt}
                      sessionUpdatedAt={selectedSession.updatedAt}
                      sessionUserId={selectedSession.userId !== currentUserId ? selectedSession.userId : undefined}
                      onNavigateToItem={({ sessionId: targetId, anchorId }) => {
                        // Switch to the target session, then scroll to
                        // the goal/task/subtask anchor once it's
                        // rendered. The framework re-mounts on
                        // sessionId change, so we wait a beat for the
                        // new render before scrolling.
                        if (targetId !== selectedSession.id) selectSession(targetId);
                        setTimeout(() => {
                          const el = document.getElementById(anchorId);
                          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                        }, targetId !== selectedSession.id ? 400 : 50);
                      }}
                    />


                    {/* Notes */}
                    <div className="mb-8">
                      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                        Notes
                      </h3>
                      <div className="prose dark:prose-invert max-w-none prose-sm prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2">
                        <ReactMarkdown
                          components={{
                            a: ({ href, children, ...props }) => (
                              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                                {children}
                              </a>
                            ),
                          }}
                        >{selectedSession.notes}</ReactMarkdown>
                      </div>
                    </div>

                    {/* Transcript */}
                    {selectedSession.transcript && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Call Transcript
                          </h3>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(selectedSession.transcript || "");
                              setTranscriptCopied(true);
                              setTimeout(() => setTranscriptCopied(false), 1500);
                            }}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-300 inline-flex items-center gap-1"
                            title="Copy transcript to clipboard"
                          >
                            {transcriptCopied ? (
                              <>
                                <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                                Copied
                              </>
                            ) : (
                              <>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                Copy
                              </>
                            )}
                          </button>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto dark:bg-gray-900/30">
                          <pre className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap font-mono">
                            {selectedSession.transcript}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* No session selected */
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
                  <p className="text-gray-500 dark:text-gray-400">
                    Select a session from the list or create a new one.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {ConfirmModalElement}

      {/* Sync Review Overlay */}
      {syncData && (
        <SyncReviewOverlay
          isOpen={showSyncOverlay}
          onClose={() => { setShowSyncOverlay(false); setSyncData(null); }}
          source="coaching"
          proposedChanges={syncData.proposedChanges}
          recommendedStage={syncData.recommendedStage}
          onApply={handleApplySync}
        />
      )}
    </div>
  );
}
