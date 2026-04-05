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

interface CoachingSession {
  id: string;
  title: string;
  sessionDate: string;
  notes: string;
  transcript: string | null;
  recordingUrl: string | null;
  sessionStatus: string;
  maturityStage: string | null;
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

  // Also fetch maturity stage and next goals
  let maturityStage: string | null = null;
  let nextGoals: Array<{ title: string; description?: string; tasks: Array<{ title: string; description?: string | null }> }> = [];
  try {
    const [stageRes, nextRes] = await Promise.all([
      fetch("/api/coaching/maturity-stage"),
      fetch("/api/coaching/next-goals"),
    ]);
    if (stageRes.ok) {
      const d = await stageRes.json();
      maturityStage = d.stage?.currentStage || null;
    }
    if (nextRes.ok) {
      const d = await nextRes.json();
      nextGoals = d.goals || [];
    }
  } catch { /* ignore */ }

  let context = "## Coaching History\n\n";
  context += `*${sorted.length} session${sorted.length !== 1 ? "s" : ""} from ${formatDate(sorted[0].sessionDate)} to ${formatDate(sorted[sorted.length - 1].sessionDate)}*\n\n`;

  if (maturityStage) {
    context += `**Current Sales Maturity Stage:** ${maturityStage}\n\n`;
  }

  context += `---\n\n`;
  context += sorted.map((s, i) => formatEnrichedContext(s, enrichedData[i])).join("---\n\n");

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading...</p>
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

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formTranscript, setFormTranscript] = useState("");
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
    loadSessions();
  }, [loadSessions]);

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

    // Immediately create a draft session so CoachingFramework has a sessionId
    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await fetch("/api/coaching-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionDate: today, notes: "(draft)" }),
      });
      if (res.ok) {
        const data = await res.json();
        setAutoSavedId(data.session.id);
        selectSession(data.session.id);
        setSessions((prev) => [data.session, ...prev]);
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
      const payload = {
        title: formTitle,
        sessionDate: formDate,
        notes: formNotes,
        transcript: formTranscript || null,
        recordingUrl: formRecordingUrl || null,
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
      // Build context from readiness state + coaching sessions
      let context = "";

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
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Coaching History</h1>
            <p className="text-gray-500 text-sm mt-1">
              Log coaching sessions with notes and transcripts, then chat with Mikey about your progress.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {sessions.length > 0 && (
              <button
                onClick={handleSyncCoachingToReadiness}
                disabled={syncLoading}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
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
                Sync to GTM Readiness
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
          <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg flex items-center justify-between">
            <span className="text-sm text-purple-700">
              {checkedSessions.length} sessions selected
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCheckedIds(new Set())}
                className="text-sm text-purple-600 hover:text-purple-800 hover:underline"
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
            <svg className="animate-spin h-8 w-8 text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : sessions.length === 0 && mode !== "create" ? (
          /* Empty state */
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">No coaching sessions yet</h2>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
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
            {/* Left panel: Session list */}
            <div className="w-80 flex-shrink-0">
              {sessions.length > 1 && (
                <div className="mb-2 px-2">
                  <button
                    onClick={toggleCheckAll}
                    className="text-xs text-purple-600 hover:text-purple-800 hover:underline"
                  >
                    {checkedIds.size === sessions.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
              )}
              <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
                {sessions.filter((s) => {
                  // Hide draft sessions from sidebar unless it's the active draft in create mode
                  if (s.notes === "(draft)" && s.id !== autoSavedId) return false;
                  if (s.notes === "(draft)" && mode !== "create") return false;
                  return true;
                }).map((session) => {
                  const isActive = selectedId === session.id && mode === "view";
                  return (
                    <div
                      key={session.id}
                      className={`group relative rounded-lg border p-3 cursor-pointer transition-colors ${
                        isActive
                          ? "border-purple-300 bg-purple-50"
                          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                      }`}
                      onClick={() => {
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
                          className="mt-1 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-500 mb-0.5">
                            {formatDate(session.sessionDate)}
                            {sessionUserName(session) && (
                              <span className="ml-1.5 text-gray-400">· {sessionUserName(session)}</span>
                            )}
                          </div>
                          <div className="font-medium text-gray-900 text-sm truncate">
                            {session.title}
                          </div>
                          <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                            {session.notes.substring(0, 120)}
                            {session.notes.length > 120 ? "..." : ""}
                          </div>
                          {(session.transcript || session.recordingUrl) && (
                            <div className="mt-1 flex items-center gap-1.5">
                              {session.transcript && (
                                <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                  </svg>
                                  Transcript
                                </span>
                              )}
                              {session.recordingUrl && (
                                <span className="inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  Recording
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right panel: Detail or Form */}
            <div className="flex-1 min-w-0">
              {mode === "create" || mode === "edit" ? (
                creatingDraft ? (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 flex items-center justify-center">
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
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                  <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="font-semibold text-gray-900">
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

                  {/* Coaching Framework — at top of form */}
                  {((mode === "edit" && selectedId) || (mode === "create" && autoSavedId)) && (
                    <div className="px-6 pt-6">
                      <CoachingFramework
                        sessionId={(mode === "edit" ? selectedId : autoSavedId)!}
                        sessionStatus="new"
                        isOwner={true}
                      />
                    </div>
                  )}

                  <div className="p-6 space-y-5">
                    {/* Title */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Session Title <span className="font-normal text-gray-400">(optional — auto-generated if blank)</span>
                      </label>
                      <input
                        type="text"
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        placeholder="e.g. Weekly Coaching Call, Pipeline Review"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    {/* Recording URL */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Meeting Recording <span className="font-normal text-gray-400">(optional)</span>
                      </label>
                      <input
                        type="url"
                        value={formRecordingUrl}
                        onChange={(e) => setFormRecordingUrl(e.target.value)}
                        placeholder="https://zoom.us/rec/... or any recording link"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Session Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={formDate}
                        onChange={(e) => setFormDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    {/* Notes — rich text */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
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
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Call Transcript <span className="font-normal text-gray-400">(optional)</span>
                      </label>
                      <textarea
                        value={formTranscript}
                        onChange={(e) => setFormTranscript(e.target.value)}
                        placeholder="Paste your call transcript here..."
                        rows={6}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y font-mono text-sm"
                      />
                    </div>

                  </div>

                  {/* Form actions */}
                  <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex items-center justify-between">
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
                      className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
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
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                  <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span>{formatDate(selectedSession.sessionDate)}</span>
                        {sessionUserName(selectedSession) && (
                          <span className="text-gray-400">· {sessionUserName(selectedSession)}</span>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          selectedSession.sessionStatus === "new" ? "bg-blue-100 text-blue-700" :
                          selectedSession.sessionStatus === "in_progress" ? "bg-orange-100 text-orange-700" :
                          "bg-gray-100 text-gray-500"
                        }`}>
                          {selectedSession.sessionStatus === "new" ? "Live Session" :
                           selectedSession.sessionStatus === "in_progress" ? "Live Sprint" :
                           "Archived"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {selectedSession.userId === currentUserId && selectedSession.sessionStatus === "new" && (
                          <button
                            onClick={async () => {
                              await fetch(`/api/coaching-sessions/${selectedSession.id}/status`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "in_progress" }),
                              });
                              loadSessions();
                            }}
                            className="px-2.5 py-1.5 text-xs bg-orange-50 text-orange-600 hover:bg-orange-100 rounded-lg transition-colors font-medium"
                          >
                            Start Sprint
                          </button>
                        )}
                        {selectedSession.userId === currentUserId && (selectedSession.sessionStatus === "new" || selectedSession.sessionStatus === "in_progress") && (
                          <button
                            onClick={async () => {
                              await fetch(`/api/coaching-sessions/${selectedSession.id}/status`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "locked" }),
                              });
                              loadSessions();
                            }}
                            className="px-2.5 py-1.5 text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors font-medium"
                          >
                            Lock Session
                          </button>
                        )}
                        {selectedSession.userId === currentUserId && (
                          <>
                            <button
                              onClick={() => startEdit(selectedSession)}
                              className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
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
                    <h2 className="text-lg font-semibold text-gray-900 mb-2">{selectedSession.title}</h2>
                    <ChatAboutButton
                      title={`Coaching: ${selectedSession.title}`}
                      getContext={() => buildEnrichedChatContext([selectedSession])}
                      label="Chat About This"
                    />
                  </div>

                  <div className="p-6">
                    {/* Coaching Framework — Maturity Stage, Metrics, Goals & Tasks */}
                    <CoachingFramework
                      sessionId={selectedSession.id}
                      sessionStatus={selectedSession.sessionStatus || "new"}
                      isOwner={selectedSession.userId === currentUserId}
                      sessionCreatedAt={selectedSession.createdAt}
                    />

                    {/* Recording link */}
                    {selectedSession.recordingUrl && (
                      <div className="mb-6">
                        <a
                          href={selectedSession.recordingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-3 py-2 rounded-lg transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Watch Meeting Recording
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </div>
                    )}

                    {/* Notes */}
                    <div className="mb-8">
                      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                        Notes
                      </h3>
                      <div className="prose max-w-none prose-sm prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2">
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
                        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                          Call Transcript
                        </h3>
                        <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                            {selectedSession.transcript}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* No session selected */
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                  <p className="text-gray-500">
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
