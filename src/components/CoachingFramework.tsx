"use client";

import { useState, useEffect, useCallback, useRef, ReactNode } from "react";

// ── Linkify helper ───────────────────────────────────────────────
const URL_REGEX = /(https?:\/\/[^\s<]+)/g;
function Linkify({ children }: { children: string }): ReactNode {
  const parts = children.split(URL_REGEX);
  if (parts.length === 1) return children;
  return parts.map((part, i) =>
    URL_REGEX.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-800 underline break-all">{part}</a>
    ) : part
  );
}

// ── Types ──────────────────────────────────────────────────────────

const MATURITY_STAGES = [
  { value: "PROBLEM_VALIDATION", label: "Do we know what problem we're solving?", short: "Problem Validation" },
  { value: "VALUE_VALIDATION", label: "Does the product solve the problem and create value?", short: "Value Validation" },
  { value: "FIRST_REVENUE", label: "Can we get someone to pay for the product?", short: "First Revenue" },
  { value: "REPEATABLE_REVENUE", label: "Can we get many people to pay for the product?", short: "Repeatable Revenue" },
  { value: "FIRST_SALES_HIRE", label: "Can we get someone other than the founder to sell?", short: "First Sales Hire" },
  { value: "SCALING_SALES", label: "Can we get many people other than the founder to sell?", short: "Scaling Sales" },
];

interface Goal {
  id: string;
  title: string;
  description?: string;
  status: string;
  statusChangedAt?: string;
  order: number;
  tasks: Task[];
}

interface Task {
  id: string;
  title: string;
  status: string;
  statusChangedAt?: string;
  order: number;
}

interface MetricEntry {
  id: string;
  currentValue: number;
  addedSinceLastSession: number;
  metricDefinition: {
    id: string;
    name: string;
    definition?: string;
    isDefault: boolean;
  };
}

interface CoachingFrameworkProps {
  sessionId: string;
  sessionStatus: string;
  isOwner: boolean;
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active", color: "bg-blue-100 text-blue-700" },
  { value: "done", label: "Done", color: "bg-green-100 text-green-700" },
  { value: "not_doing", label: "Not Doing", color: "bg-gray-100 text-gray-500 line-through" },
  { value: "deprioritized", label: "Deprioritized", color: "bg-amber-100 text-amber-700" },
];

export default function CoachingFramework({ sessionId, sessionStatus, isOwner }: CoachingFrameworkProps) {
  const isLocked = sessionStatus === "locked";
  const canEdit = isOwner && !isLocked;

  // ── State ──────────────────────────────────────────────────────

  const [maturityStage, setMaturityStage] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [metricEntries, setMetricEntries] = useState<MetricEntry[]>([]);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newTaskTitles, setNewTaskTitles] = useState<Record<string, string>>({});
  const [addingMetric, setAddingMetric] = useState(false);
  const [newMetricName, setNewMetricName] = useState("");
  const [newMetricDefinition, setNewMetricDefinition] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [archivedMetrics, setArchivedMetrics] = useState<Array<{ id: string; name: string; definition?: string }>>([]);
  const metricSaveTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // ── Load data ──────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [stageRes, goalsRes, metricsRes] = await Promise.all([
        fetch("/api/coaching/maturity-stage"),
        fetch("/api/coaching/goals?status=active"),
        fetch(`/api/coaching-sessions/${sessionId}/metrics`),
      ]);

      if (stageRes.ok) {
        const d = await stageRes.json();
        setMaturityStage(d.stage?.currentStage || null);
      }
      if (goalsRes.ok) {
        const d = await goalsRes.json();
        setGoals(d.goals || []);
      }
      if (metricsRes.ok) {
        const d = await metricsRes.json();
        setMetricEntries(d.entries || []);
      }
    } catch { /* ignore */ }
  }, [sessionId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Cleanup metric save timers on unmount
  useEffect(() => {
    const timers = metricSaveTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  // ── Handlers ───────────────────────────────────────────────────

  const updateMaturityStage = async (stage: string) => {
    setMaturityStage(stage);
    await fetch("/api/coaching/maturity-stage", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentStage: stage }),
    });
  };

  const addGoal = async () => {
    if (!newGoalTitle.trim()) return;
    const title = newGoalTitle.trim();
    setNewGoalTitle("");
    const res = await fetch("/api/coaching/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, title }),
    });
    if (res.ok) {
      const data = await res.json();
      setGoals((prev) => [...prev, { ...data.goal, tasks: [] }]);
    }
  };

  const updateGoalStatus = async (goalId: string, status: string) => {
    // Optimistic update
    setGoals((prev) => prev.map((g) => g.id === goalId ? { ...g, status } : g));
    await fetch(`/api/coaching/goals/${goalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  const addTask = async (goalId: string) => {
    const title = newTaskTitles[goalId]?.trim();
    if (!title) return;
    setNewTaskTitles((prev) => ({ ...prev, [goalId]: "" }));
    const res = await fetch(`/api/coaching/goals/${goalId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const data = await res.json();
      setGoals((prev) => prev.map((g) =>
        g.id === goalId ? { ...g, tasks: [...g.tasks, data.task] } : g
      ));
    }
  };

  const updateTaskStatus = async (taskId: string, status: string) => {
    // Optimistic update
    setGoals((prev) => prev.map((g) => ({
      ...g,
      tasks: g.tasks.map((t) => t.id === taskId ? { ...t, status } : t),
    })));
    await fetch(`/api/coaching/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  const updateMetricValue = async (entryId: string, metricDefId: string, value: number) => {
    // Already optimistically updated in the onChange handler
    await fetch(`/api/coaching/metrics/${metricDefId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, currentValue: value }),
    });
  };

  const addMetricDefinition = async () => {
    if (!newMetricName.trim()) return;
    const name = newMetricName.trim();
    const definition = newMetricDefinition.trim() || undefined;
    setNewMetricName("");
    setNewMetricDefinition("");
    setAddingMetric(false);
    const res = await fetch("/api/coaching/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, definition }),
    });
    if (res.ok) {
      const data = await res.json();
      // Create empty entry for this session
      const entryRes = await fetch(`/api/coaching/metrics/${data.metric.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, currentValue: 0 }),
      });
      if (entryRes.ok) {
        const entryData = await entryRes.json();
        setMetricEntries((prev) => [...prev, {
          id: entryData.entry.id,
          currentValue: 0,
          addedSinceLastSession: 0,
          metricDefinition: { id: data.metric.id, name, definition, isDefault: false },
        }]);
      }
    }
  };

  const archiveMetric = async (metricDefId: string) => {
    // Optimistic: remove from active entries
    const archived = metricEntries.find((e) => e.metricDefinition.id === metricDefId);
    setMetricEntries((prev) => prev.filter((e) => e.metricDefinition.id !== metricDefId));
    if (archived) {
      setArchivedMetrics((prev) => [...prev, { id: archived.metricDefinition.id, name: archived.metricDefinition.name, definition: archived.metricDefinition.definition }]);
    }
    await fetch(`/api/coaching/metrics/${metricDefId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
  };

  const unarchiveMetric = async (metricDefId: string) => {
    const metric = archivedMetrics.find((m) => m.id === metricDefId);
    setArchivedMetrics((prev) => prev.filter((m) => m.id !== metricDefId));
    await fetch(`/api/coaching/metrics/${metricDefId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
    if (metric) {
      // Create entry for the current session
      const entryRes = await fetch(`/api/coaching/metrics/${metricDefId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, currentValue: 0 }),
      });
      if (entryRes.ok) {
        const entryData = await entryRes.json();
        setMetricEntries((prev) => [...prev, {
          id: entryData.entry.id,
          currentValue: 0,
          addedSinceLastSession: 0,
          metricDefinition: { id: metricDefId, name: metric.name, definition: metric.definition, isDefault: false },
        }]);
      }
    }
  };

  const deleteMetric = async (metricDefId: string) => {
    setMetricEntries((prev) => prev.filter((e) => e.metricDefinition.id !== metricDefId));
    await fetch(`/api/coaching/metrics/${metricDefId}`, { method: "DELETE" });
  };

  const loadArchivedMetrics = async () => {
    const res = await fetch("/api/coaching/metrics?includeArchived=true");
    if (res.ok) {
      const data = await res.json();
      const archived = (data.metrics || []).filter((m: { archived: boolean }) => m.archived);
      setArchivedMetrics(archived.map((m: { id: string; name: string; definition?: string }) => ({ id: m.id, name: m.name, definition: m.definition })));
    }
  };

  const getStatusColor = (status: string) =>
    STATUS_OPTIONS.find((s) => s.value === status)?.color || "bg-gray-100 text-gray-600";

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-6 mb-8">
      {/* ── Maturity Stage ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span>🔄</span> Sales Maturity Stage
        </h3>
        <select
          value={maturityStage || ""}
          onChange={(e) => canEdit && e.target.value && updateMaturityStage(e.target.value)}
          disabled={!canEdit}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white disabled:bg-gray-50 disabled:cursor-default"
        >
          <option value="">Select your current stage...</option>
          {MATURITY_STAGES.map((stage) => (
            <option key={stage.value} value={stage.value}>
              {stage.short} — {stage.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Metrics ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span>📊</span> Metrics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {metricEntries.map((entry) => (
            <div key={entry.id} className="bg-gray-50 rounded-lg p-3 text-center relative group">
              {canEdit && (
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                  <button
                    onClick={() => archiveMetric(entry.metricDefinition.id)}
                    title="Archive metric"
                    className="p-1 text-gray-400 hover:text-amber-500 rounded"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                  </button>
                  {!entry.metricDefinition.isDefault && (
                    <button
                      onClick={() => deleteMetric(entry.metricDefinition.id)}
                      title="Delete metric"
                      className="p-1 text-gray-400 hover:text-red-500 rounded"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                </div>
              )}
              <div className="text-xs text-gray-500 mb-1 font-medium">{entry.metricDefinition.name}</div>
              {entry.metricDefinition.definition && (
                <div className="text-[10px] text-gray-400 mb-1.5 leading-tight">{entry.metricDefinition.definition}</div>
              )}
              {canEdit ? (
                <input
                  type="number"
                  value={entry.currentValue || ""}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setMetricEntries((prev) =>
                      prev.map((me) => me.id === entry.id ? { ...me, currentValue: val } : me)
                    );
                    // Debounced auto-save (2s after last keystroke)
                    const key = entry.id;
                    if (metricSaveTimers.current[key]) clearTimeout(metricSaveTimers.current[key]);
                    metricSaveTimers.current[key] = setTimeout(() => {
                      updateMetricValue(entry.id, entry.metricDefinition.id, val);
                      delete metricSaveTimers.current[key];
                    }, 2000);
                  }}
                  onBlur={(e) => {
                    // Flush any pending debounce immediately on blur
                    const key = entry.id;
                    if (metricSaveTimers.current[key]) {
                      clearTimeout(metricSaveTimers.current[key]);
                      delete metricSaveTimers.current[key];
                    }
                    const val = parseFloat(e.target.value) || 0;
                    updateMetricValue(entry.id, entry.metricDefinition.id, val);
                  }}
                  className="w-full text-center text-lg font-semibold bg-white border border-gray-200 rounded px-2 py-1 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              ) : (
                <div className="text-lg font-semibold text-gray-900">{entry.currentValue}</div>
              )}
              {entry.addedSinceLastSession !== 0 && (
                <div className={`text-xs mt-1 font-medium ${entry.addedSinceLastSession > 0 ? "text-green-600" : "text-red-500"}`}>
                  {entry.addedSinceLastSession > 0 ? "+" : ""}{entry.addedSinceLastSession} since last
                </div>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="mt-3 space-y-2">
            {addingMetric ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={newMetricName}
                  onChange={(e) => setNewMetricName(e.target.value)}
                  placeholder="Metric name (e.g. MRR, Pipeline Value)..."
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && addMetricDefinition()}
                  autoFocus
                />
                <input
                  type="text"
                  value={newMetricDefinition}
                  onChange={(e) => setNewMetricDefinition(e.target.value)}
                  placeholder="Definition / description (optional)..."
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 focus:ring-2 focus:ring-purple-500"
                  onKeyDown={(e) => e.key === "Enter" && addMetricDefinition()}
                />
                <div className="flex items-center gap-2">
                  <button onClick={addMetricDefinition} disabled={!newMetricName.trim()} className="text-sm text-purple-600 font-medium disabled:opacity-50">Add Metric</button>
                  <button onClick={() => { setAddingMetric(false); setNewMetricName(""); setNewMetricDefinition(""); }} className="text-sm text-gray-400">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setAddingMetric(true)}
                  className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                >
                  + Add Metric
                </button>
                {!showArchived && (
                  <button
                    onClick={() => { setShowArchived(true); loadArchivedMetrics(); }}
                    className="text-sm text-gray-400 hover:text-gray-600"
                  >
                    Show Archived
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Archived metrics */}
        {showArchived && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Archived Metrics</h4>
              <button onClick={() => setShowArchived(false)} className="text-xs text-gray-400 hover:text-gray-600">Hide</button>
            </div>
            {archivedMetrics.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-2">No archived metrics.</p>
            ) : (
              <div className="space-y-1.5">
                {archivedMetrics.map((m) => (
                  <div key={m.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-sm text-gray-500">{m.name}</span>
                      {m.definition && <span className="text-xs text-gray-400 ml-2">— {m.definition}</span>}
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => unarchiveMetric(m.id)}
                        className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                      >
                        Unarchive
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Goals & Tasks ───────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span>🎯</span> Goals &amp; Tasks
        </h3>
        <div className="space-y-4">
          {goals.map((goal) => (
            <div key={goal.id} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Goal header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-medium text-gray-900 text-sm"><Linkify>{goal.title}</Linkify></span>
                  {goal.description && (
                    <span className="text-xs text-gray-400 hidden sm:inline">— <Linkify>{goal.description}</Linkify></span>
                  )}
                </div>
                {canEdit ? (
                  <select
                    value={goal.status}
                    onChange={(e) => updateGoalStatus(goal.id, e.target.value)}
                    className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${getStatusColor(goal.status)}`}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${getStatusColor(goal.status)}`}>
                    {STATUS_OPTIONS.find((s) => s.value === goal.status)?.label || goal.status}
                  </span>
                )}
              </div>

              {/* Tasks */}
              <div className="divide-y divide-gray-100">
                {goal.tasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between px-4 py-2.5 pl-8">
                    <div className="flex items-center gap-2">
                      {task.status === "done" ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <div className="w-4 h-4 rounded border-2 border-gray-300" />
                      )}
                      <span className={`text-sm ${task.status === "done" ? "text-gray-400 line-through" : task.status === "not_doing" ? "text-gray-400 line-through" : "text-gray-700"}`}>
                        <Linkify>{task.title}</Linkify>
                      </span>
                    </div>
                    {canEdit && (
                      <select
                        value={task.status}
                        onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                        className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer ${getStatusColor(task.status)}`}
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}

                {/* Add task */}
                {canEdit && (
                  <div className="flex items-center gap-2 px-4 py-2 pl-8">
                    <input
                      type="text"
                      value={newTaskTitles[goal.id] || ""}
                      onChange={(e) => setNewTaskTitles((prev) => ({ ...prev, [goal.id]: e.target.value }))}
                      placeholder="Add a task..."
                      className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      onKeyDown={(e) => e.key === "Enter" && addTask(goal.id)}
                    />
                    <button
                      onClick={() => addTask(goal.id)}
                      disabled={!newTaskTitles[goal.id]?.trim()}
                      className="text-xs text-purple-600 font-medium disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Add goal */}
          {canEdit && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newGoalTitle}
                onChange={(e) => setNewGoalTitle(e.target.value)}
                placeholder="Add a goal..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                onKeyDown={(e) => e.key === "Enter" && addGoal()}
              />
              <button
                onClick={addGoal}
                disabled={!newGoalTitle.trim()}
                className="px-4 py-2 text-sm text-purple-600 font-medium hover:bg-purple-50 rounded-lg disabled:opacity-50"
              >
                + Add Goal
              </button>
            </div>
          )}

          {goals.length === 0 && !canEdit && (
            <p className="text-sm text-gray-400 text-center py-4">No goals set for this session.</p>
          )}
        </div>
      </div>
    </div>
  );
}
