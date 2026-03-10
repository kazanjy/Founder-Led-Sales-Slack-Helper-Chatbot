"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import SalesNavBar from "@/components/SalesNavBar";

const RichTextEditor = dynamic(() => import("@/components/RichTextEditor"), { ssr: false });
import { ChatAboutButton } from "@/components/ChatAboutButton";

interface CoachingSession {
  id: string;
  title: string;
  sessionDate: string;
  notes: string;
  transcript: string | null;
  createdAt: string;
  updatedAt: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSessionForChat(session: CoachingSession): string {
  let text = `### Session: ${session.title} — ${formatDate(session.sessionDate)}\n\n`;
  text += `#### Notes\n${session.notes}\n\n`;
  if (session.transcript) {
    text += `#### Call Transcript\n${session.transcript}\n\n`;
  }
  return text;
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
  const [sessions, setSessions] = useState<CoachingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"view" | "create" | "edit">("view");

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formTranscript, setFormTranscript] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/coaching-sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions);
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
  };

  const startCreate = () => {
    resetForm();
    setSelectedId(null);
    setMode("create");
  };

  const startEdit = (session: CoachingSession) => {
    setFormTitle(session.title);
    setFormDate(new Date(session.sessionDate).toISOString().split("T")[0]);
    setFormNotes(session.notes);
    setFormTranscript(session.transcript || "");
    setSelectedId(session.id);
    setMode("edit");
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formDate || !formNotes.trim()) return;

    setSaving(true);
    try {
      const payload = {
        title: formTitle,
        sessionDate: formDate,
        notes: formNotes,
        transcript: formTranscript || null,
      };

      let res: Response;
      if (mode === "edit" && selectedId) {
        res = await fetch(`/api/coaching-sessions/${selectedId}`, {
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
        setSelectedId(data.session.id);
        setMode("view");
      }
    } catch (error) {
      console.error("Failed to save session:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/coaching-sessions/${selectedId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSelectedId(null);
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
              <ChatAboutButton
                title="Coaching History — All Sessions"
                getContext={() => formatSessionsForChat(sessions)}
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
                getContext={() => formatSessionsForChat(checkedSessions)}
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
                {sessions.map((session) => {
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
                        setSelectedId(session.id);
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
                          </div>
                          <div className="font-medium text-gray-900 text-sm truncate">
                            {session.title}
                          </div>
                          <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                            {session.notes.substring(0, 120)}
                            {session.notes.length > 120 ? "..." : ""}
                          </div>
                          {session.transcript && (
                            <div className="mt-1">
                              <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                </svg>
                                Transcript
                              </span>
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
                /* Create/Edit Form */
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                  <div className="p-4 border-b border-gray-200">
                    <h2 className="font-semibold text-gray-900">
                      {mode === "edit" ? "Edit Session" : "New Coaching Session"}
                    </h2>
                  </div>
                  <div className="p-6 space-y-5">
                    {/* Title */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Session Title
                      </label>
                      <input
                        type="text"
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        placeholder="e.g. Weekly Coaching Call, Pipeline Review"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Session Date
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
                        Session Notes
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
                      onClick={() => {
                        setMode("view");
                        if (!selectedId && sessions.length > 0) {
                          setSelectedId(sessions[0].id);
                        }
                      }}
                      className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || !formTitle.trim() || !formDate || !formNotes.trim()}
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
              ) : selectedSession ? (
                /* Session Detail View */
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                  <div className="p-4 border-b border-gray-200">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm text-gray-500 mb-1">
                          {formatDate(selectedSession.sessionDate)}
                        </div>
                        <h2 className="text-xl font-semibold text-gray-900">
                          {selectedSession.title}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2">
                        <ChatAboutButton
                          title={`Coaching: ${selectedSession.title}`}
                          getContext={() => formatSessionsForChat([selectedSession])}
                          label="Chat About This"
                        />
                        <button
                          onClick={() => startEdit(selectedSession)}
                          className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={handleDelete}
                          disabled={deleting}
                          className="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {deleting ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="p-6">
                    {/* Notes */}
                    <div className="mb-8">
                      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                        Notes
                      </h3>
                      <div className="prose max-w-none prose-sm prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2">
                        <ReactMarkdown>{selectedSession.notes}</ReactMarkdown>
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
    </div>
  );
}
