"use client";

import { useState, useEffect, useCallback, useRef, Fragment, ReactNode } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TaskComments } from "@/components/TaskComments";

// Loaded only on the client — TipTap pulls in a chunk we don't want to
// pay for on SSR. Same pattern used by TaskComments for its comment
// editor, reused here for goal / task / subtask descriptions.
const RichTextCommentEditor = dynamic(
  () => import("@/components/RichTextCommentEditor"),
  { ssr: false }
);

// Shared read-only renderer for description prose. Markdown via
// remark-gfm, with anchor override that opens links in a new tab.
function DescriptionMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, ...rest }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 hover:text-purple-800 underline break-all dark:text-purple-300 dark:hover:text-purple-200"
            onClick={(e) => e.stopPropagation()}
            {...rest}
          >
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

// ── Linkify helper ───────────────────────────────────────────────
const URL_REGEX = /(https?:\/\/[^\s<]+)/g;
function Linkify({ children }: { children: string }): ReactNode {
  const parts = children.split(URL_REGEX);
  if (parts.length === 1) return children;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-800 underline break-all dark:text-purple-300" onClick={(e) => e.stopPropagation()}>{part}</a>
    ) : part
  );
}

// ── Types ──────────────────────────────────────────────────────────

const MATURITY_STAGES = [
  {
    value: "PROBLEM_VALIDATION",
    label: "Do we know what problem we're solving?",
    short: "Problem Validation",
    entry: "You have a hypothesis: target persona(s), pain, and why now. You can name 50\u2013200 target accounts you think have the problem.",
    exit: "20\u201340+ structured customer interviews completed (users + buyers), synthesized into top pains + current workflows. Clear \u201cwho has the problem\u201d + \u201ccost of problem\u201d bullets. Minimum viable feature list / MVP scope agreed.",
  },
  {
    value: "VALUE_VALIDATION",
    label: "Does it solve it and create value?",
    short: "Value Validation",
    entry: "MVP exists enough to show/deliver a wedge.",
    exit: "3\u20135+ design partners using it in real workflow. Documented proof points with at least one quantified KPI (hours saved, reduced data spend, turnaround time). Crisp sales narrative + ICP v1 written. Implementation path is known.",
  },
  {
    value: "FIRST_REVENUE",
    label: "Can we get someone to pay?",
    short: "First Revenue",
    entry: "Pricing hypothesis + packaging exists. A basic discovery \u2192 demo \u2192 pricing \u2192 next steps flow.",
    exit: "1\u20133 paying customers (not pilot-for-free), still believing they get value after onboarding. Can articulate top 3 closed-lost reasons. Baseline funnel metrics exist (meetings held, opps created, wins).",
  },
  {
    value: "REPEATABLE_REVENUE",
    label: "Can we get many people to pay?",
    short: "Repeatable Revenue",
    entry: "Can close deals founder-led with some consistency.",
    exit: "30\u201350+ non-friendly prospects run through the process. 10\u201320 customers closed/won, onboarded, and reaching value. Repeatable lead source(s) identified + tracked in CRM. Basic CS motions exist (kickoff, time-to-value target, renewal owner).",
  },
  {
    value: "FIRST_SALES_HIRE",
    label: "Can a non-founder sell this?",
    short: "First Sales Hire",
    entry: "Repeatable revenue signals + stable-ish ICP and pitch.",
    exit: "Sales playbook v1 exists (ICP, discovery questions, demo script, pricing/ROI, objection handling, stages + exit criteria). First AE/SDR ramps to first meetings and at least 1\u20132 closes with founder support. Call recording + review cadence in place.",
  },
  {
    value: "SCALING_SALES",
    label: "Can many non-founders sell this?",
    short: "Scaling Sales",
    entry: "First hire can close; motion is teachable.",
    exit: "Multiple reps consistently hit activity + pipeline creation targets; forecasting becomes meaningful. Sales stages enforced with clear entry/exit criteria in CRM. Repeatable hiring + onboarding (curriculum, certification), plus manager rhythm (1:1s, pipeline reviews).",
  },
];

interface Goal {
  id: string;
  title: string;
  description?: string;
  status: string;
  statusChangedAt?: string;
  createdAt?: string;
  order: number;
  tasks: Task[];
}

interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  statusChangedAt?: string;
  createdAt?: string;
  order: number;
  // Null for top-level tasks; set to the parent task's id for subtasks.
  // Capped at one level deep — a subtask cannot have its own subtasks.
  parentTaskId?: string | null;
}

interface NextGoal {
  id: string;
  title: string;
  description?: string | null;
  order: number;
  createdAt?: string;
  tasks: NextTask[];
}

interface NextTask {
  id: string;
  title: string;
  description?: string | null;
  order: number;
}

interface MetricHistoryEntry {
  sessionId: string;
  sessionTitle: string;
  sessionDate: string; // ISO
  value: number;
}

interface MetricEntry {
  id: string;
  currentValue: number;
  addedSinceLastSession: number;
  previousValue: number | null;
  history: MetricHistoryEntry[];
  metricDefinition: {
    id: string;
    name: string;
    definition?: string;
    format?: string;
    isDefault: boolean;
    /** "metric" (default) — a value tile.
     *  "section" — a layout-only header strip used to break the grid
     *  into named sections. Section items share the entries array but
     *  their currentValue / previousValue / history fields are unused. */
    kind?: "metric" | "section";
  };
}

const METRIC_FORMATS = [
  { value: "number", label: "#", title: "Number" },
  { value: "currency", label: "$", title: "Currency (USD)" },
];

function formatMetricValue(value: number, format?: string): string {
  if (value === null || value === undefined) return "";
  if (format === "currency") {
    if (value === 0) return "$0";
    const abs = Math.abs(value);
    const sign = value < 0 ? "-" : "";
    if (abs >= 1_000_000) {
      const v = abs / 1_000_000;
      return `${sign}$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}m`;
    }
    if (abs >= 10_000) {
      const v = abs / 1_000;
      return `${sign}$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`;
    }
    if (abs >= 1_000) {
      return `${sign}$${abs.toLocaleString()}`;
    }
    return `${sign}$${abs}`;
  }
  return value.toLocaleString();
}

function formatMetricDelta(value: number, format?: string): string {
  if (value === 0) return "";
  const s = value > 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (format === "currency") {
    if (abs >= 1_000_000) {
      const v = abs / 1_000_000;
      return `${s}$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}m`;
    }
    if (abs >= 10_000) {
      const v = abs / 1_000;
      return `${s}$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`;
    }
    if (abs >= 1_000) {
      return `${s}$${abs.toLocaleString()}`;
    }
    return `${s}$${abs}`;
  }
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}

interface CoachingFrameworkProps {
  sessionId: string;
  sessionStatus: string;
  isOwner: boolean;
  sessionCreatedAt?: string;
  sessionUpdatedAt?: string;
  sessionUserId?: string; // Pass the session owner's userId for cross-account viewing
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "done", label: "Done", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  { value: "not_doing", label: "Not Doing", color: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 line-through" },
  { value: "deprioritized", label: "Deprioritized", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
];

export default function CoachingFramework({ sessionId, sessionStatus, isOwner, sessionCreatedAt, sessionUpdatedAt, sessionUserId }: CoachingFrameworkProps) {
  const isLocked = sessionStatus === "locked";
  const canEdit = isOwner && !isLocked;

  // ── State ──────────────────────────────────────────────────────

  const [dataLoaded, setDataLoaded] = useState(false);
  const [maturityStage, setMaturityStage] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [metricEntries, setMetricEntries] = useState<MetricEntry[]>([]);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newTaskTitles, setNewTaskTitles] = useState<Record<string, string>>({});
  // Per-parent draft text for the inline "Add subtask…" input.
  const [newSubtaskTitles, setNewSubtaskTitles] = useState<Record<string, string>>({});
  // Set of parent-task IDs whose subtask groups are currently collapsed.
  // Default: subtasks expanded; toggling adds the id here.
  const [collapsedSubtaskParents, setCollapsedSubtaskParents] = useState<Set<string>>(new Set());
  // Set of parent-task IDs whose hidden (settled) subtasks have been
  // explicitly revealed despite the hide-completed filter being on.
  // Cleared whenever the master Hide/Show All toggle flips.
  const [revealedHiddenSubsParents, setRevealedHiddenSubsParents] = useState<Set<string>>(new Set());
  const [addingMetric, setAddingMetric] = useState(false);
  const [newMetricName, setNewMetricName] = useState("");
  const [newMetricDefinition, setNewMetricDefinition] = useState("");
  const [newMetricFormat, setNewMetricFormat] = useState("number");
  const [showArchived, setShowArchived] = useState(false);
  const [archivedMetrics, setArchivedMetrics] = useState<Array<{ id: string; name: string; definition?: string }>>([]);
  const [editingDescTask, setEditingDescTask] = useState<string | null>(null);
  const [focusedMetric, setFocusedMetric] = useState<string | null>(null);
  const [metricInputValue, setMetricInputValue] = useState("");
  const [editingDescriptions, setEditingDescriptions] = useState<Record<string, string>>({});
  const [hideCompletedGlobal, setHideCompletedGlobal] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("coaching:hideCompleted") === "true";
  });
  const [hideCompletedPerGoal, setHideCompletedPerGoal] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("coaching:hideCompletedPerGoal") || "{}"); } catch { return {}; }
  });
  const [collapsedGoals, setCollapsedGoals] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const arr = JSON.parse(localStorage.getItem("coaching:collapsedGoals") || "[]");
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  });
  // Up Next state
  const [nextGoals, setNextGoals] = useState<NextGoal[]>([]);
  const [newNextGoalTitle, setNewNextGoalTitle] = useState("");
  const [newNextTaskTitles, setNewNextTaskTitles] = useState<Record<string, string>>({});
  const [editingNextDescTask, setEditingNextDescTask] = useState<string | null>(null);
  const [editingNextDescriptions, setEditingNextDescriptions] = useState<Record<string, string>>({});
  const [editingGoalDescId, setEditingGoalDescId] = useState<string | null>(null);
  const [editingNextGoalDescId, setEditingNextGoalDescId] = useState<string | null>(null);
  const [dragNextGoal, setDragNextGoal] = useState<string | null>(null);
  const [dragOverNextGoal, setDragOverNextGoal] = useState<string | null>(null);
  const [dragNextTask, setDragNextTask] = useState<{ goalId: string; taskId: string } | null>(null);
  const [dragOverNextTask, setDragOverNextTask] = useState<string | null>(null);
  const [dragGoal, setDragGoal] = useState<string | null>(null);
  const [dragTask, setDragTask] = useState<{ goalId: string; taskId: string } | null>(null);
  const [dragOverGoal, setDragOverGoal] = useState<string | null>(null);
  const [dragOverTask, setDragOverTask] = useState<string | null>(null);
  // Subtask drag — scoped to one parent at a time, since subtasks
  // can't be moved across parents (the model doesn't reparent on drop).
  const [dragSubtask, setDragSubtask] = useState<{ parentTaskId: string; subId: string } | null>(null);
  const [dragOverSubtask, setDragOverSubtask] = useState<string | null>(null);
  // Metric history popover — id of the metric whose history popover
  // is currently "pinned" open via click. Null = no pin (popover only
  // shows on hover). Click-outside (handled in a useEffect below)
  // clears the pin so the user can dismiss without finding the
  // trigger again.
  const [pinnedHistoryDefId, setPinnedHistoryDefId] = useState<string | null>(null);
  // Tracks which task/subtask is currently waiting on the Ask-Mikey
  // context handler. The handler bundles the last 10 sessions
  // (including transcripts) and creates a Conversation before
  // window.open()-ing the chat, which takes a couple seconds — without
  // a spinner the user gets no feedback and may click again.
  const [askingMikeyFor, setAskingMikeyFor] = useState<string | null>(null);
  // Per-metric placement for the history popover. "right" by default;
  // flips to "left" when the trigger is close enough to the viewport
  // edge that a right-side popover would clip. Set on hover/pin via a
  // bounding-rect measurement.
  const [historyPlacement, setHistoryPlacement] = useState<Record<string, "left" | "right">>({});
  // Drag state for metric tiles. Keyed on the metric *definition* id so
  // the persist call hits /api/coaching/metrics/[id] (the definition is
  // the authority on order; per-session entries inherit it).
  const [dragMetricDefId, setDragMetricDefId] = useState<string | null>(null);
  const [dragOverMetricDefId, setDragOverMetricDefId] = useState<string | null>(null);
  const metricSaveTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const descSaveTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // ── Load data ──────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const userParam = sessionUserId ? `&userId=${sessionUserId}` : "";
      // For locked sessions, show all goals that existed at the time (any status)
      // For active sessions, show only active goals. Either way, pass
      // a time cutoff so this session's view stays bounded — locked
      // uses updatedAt (the lock time), non-locked uses the session's
      // own createdAt + a sessionId match so own-session goals show
      // alongside earlier carry-forwards but NEWER sessions' goals
      // don't pollute this view.
      const isLockedSession = sessionStatus === "locked";
      const goalsStatusParam = isLockedSession ? "" : "status=active";
      let scopeParams = "";
      if (isLockedSession && sessionUpdatedAt) {
        scopeParams = `&createdBefore=${sessionUpdatedAt}`;
      } else if (!isLockedSession && sessionCreatedAt) {
        scopeParams = `&sessionId=${sessionId}&createdBefore=${sessionCreatedAt}`;
      }
      const [stageRes, goalsRes, metricsRes, nextGoalsRes] = await Promise.all([
        fetch("/api/coaching/maturity-stage"),
        fetch(`/api/coaching/goals?${goalsStatusParam}${userParam}${scopeParams}`),
        fetch(`/api/coaching-sessions/${sessionId}/metrics`),
        fetch(`/api/coaching/next-goals?_=1${userParam}`),
      ]);

      if (stageRes.ok) {
        const d = await stageRes.json();
        setMaturityStage(d.stage?.currentStage || null);
      }
      if (goalsRes.ok) {
        const d = await goalsRes.json();
        // Sort tasks within each goal: active first, done at bottom (most recently completed on top)
        const sortedGoals = (d.goals || []).map((g: Goal) => {
          const active = g.tasks.filter((t: Task) => t.status !== "done");
          const done = g.tasks.filter((t: Task) => t.status === "done")
            .sort((a: Task, b: Task) => new Date(b.statusChangedAt || 0).getTime() - new Date(a.statusChangedAt || 0).getTime());
          return { ...g, tasks: [...active, ...done] };
        });
        setGoals(sortedGoals);
      }
      if (metricsRes.ok) {
        const d = await metricsRes.json();
        setMetricEntries(d.entries || []);
      }
      if (nextGoalsRes.ok) {
        const d = await nextGoalsRes.json();
        setNextGoals(d.goals || []);
      }
    } catch { /* ignore */ }
    setDataLoaded(true);
  }, [sessionId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Dismiss a pinned metric-history popover when the user clicks
  // anywhere outside it (or its trigger). Only attached when a pin
  // is active so we don't pay for a global listener at rest.
  useEffect(() => {
    if (!pinnedHistoryDefId) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-history-popover]") || target.closest("[data-history-trigger]")) return;
      setPinnedHistoryDefId(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [pinnedHistoryDefId]);

  // Pick "right" or "left" for the history popover based on whether
  // there's room to its right of the trigger. Called on hover/click
  // so the measurement reflects the trigger's current viewport
  // position (tiles can be at the right edge of the grid).
  const measureHistoryPlacement = (defId: string, triggerEl: HTMLElement | null) => {
    if (!triggerEl || typeof window === "undefined") return;
    const POPOVER_WIDTH = 240; // matches min-w-[200px] + padding
    const SAFETY = 16;
    const rect = triggerEl.getBoundingClientRect();
    const fitsRight = rect.right + POPOVER_WIDTH + SAFETY <= window.innerWidth;
    setHistoryPlacement((prev) => {
      const next: "left" | "right" = fitsRight ? "right" : "left";
      if (prev[defId] === next) return prev;
      return { ...prev, [defId]: next };
    });
  };

  // Scroll to anchor after data loads. If the hash targets a subtask,
  // make sure its parent's subtask group isn't collapsed before we
  // try to scroll — the target won't be in the DOM otherwise.
  useEffect(() => {
    if (goals.length === 0) return;
    const hash = window.location.hash;
    if (!hash) return;

    const targetId = hash.slice(1);
    if (targetId.startsWith("task-")) {
      const taskId = targetId.slice("task-".length);
      const parent = goals
        .flatMap((g) => g.tasks)
        .find((t) => t.id === taskId);
      if (parent?.parentTaskId) {
        setCollapsedSubtaskParents((prev) => {
          if (!prev.has(parent.parentTaskId!)) return prev;
          const next = new Set(prev);
          next.delete(parent.parentTaskId!);
          return next;
        });
      }
    }

    // Defer the scroll a tick so any expand caused above paints first.
    setTimeout(() => {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-purple-400", "ring-offset-2");
        setTimeout(() => el.classList.remove("ring-2", "ring-purple-400", "ring-offset-2"), 3000);
      }
    }, 60);
  }, [goals.length]); // only run once after goals load

  const copyAnchorLink = (anchorId: string) => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#${anchorId}`;
    navigator.clipboard.writeText(url);
    // Use a separate copied-key namespace from copy-as-markdown so the
    // two buttons on the same row don't share their feedback state.
    showCopied(`anchor-${anchorId}`);
  };

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const showCopied = (id: string) => { setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); };

  const copyGoalAsMarkdown = (goal: Goal) => {
    let md = `## ${goal.title}\n`;
    if (goal.description) md += `${goal.description}\n`;
    md += `\n`;
    for (const task of goal.tasks) {
      md += `- [ ] ${task.title}\n`;
      if (task.description) md += `  ${task.description.split("\n").join("\n  ")}\n`;
    }
    navigator.clipboard.writeText(md.trim());
    showCopied(`goal-${goal.id}`);
  };

  const copyTaskAsMarkdown = (task: Task) => {
    let md = `- [ ] ${task.title}\n`;
    if (task.description) md += `  ${task.description.split("\n").join("\n  ")}\n`;
    navigator.clipboard.writeText(md.trim());
    showCopied(`task-${task.id}`);
  };

  const copyAllGoalsAsMarkdown = () => {
    let md = "";
    for (const goal of goals) {
      // Copy All is for active to-dos. Skip goals (and their tasks)
      // marked done or not-doing; deprioritized still counts as
      // something on the list, just lower priority.
      if (goal.status === "done" || goal.status === "not_doing") continue;
      md += `## ${goal.title}\n`;
      if (goal.description) md += `${goal.description}\n`;
      md += `\n`;
      const topLevel = goal.tasks.filter((t) => !t.parentTaskId);
      for (const task of topLevel) {
        if (task.status === "done" || task.status === "not_doing") continue;
        md += `- [ ] ${task.title}\n`;
        if (task.description) md += `  ${task.description.split("\n").join("\n  ")}\n`;
        // Nest subtasks as second-level bullets under their parent,
        // applying the same skip-settled rule recursively.
        const subs = goal.tasks
          .filter((t) => t.parentTaskId === task.id && t.status !== "done" && t.status !== "not_doing")
          .sort((a, b) => a.order - b.order);
        for (const sub of subs) {
          md += `  - [ ] ${sub.title}\n`;
          if (sub.description) md += `    ${sub.description.split("\n").join("\n    ")}\n`;
        }
      }
      md += `\n`;
    }
    navigator.clipboard.writeText(md.trim());
    showCopied("all-goals");
  };

  // Cleanup save timers on unmount
  useEffect(() => {
    const mTimers = metricSaveTimers.current;
    const dTimers = descSaveTimers.current;
    return () => {
      Object.values(mTimers).forEach(clearTimeout);
      Object.values(dTimers).forEach(clearTimeout);
    };
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
      setGoals((prev) => [{ ...data.goal, tasks: [] }, ...prev]);
    }
  };

  const updateGoalStatus = async (goalId: string, status: string) => {
    // Optimistic update
    setGoals((prev) => prev.map((g) => g.id === goalId ? { ...g, status, statusChangedAt: new Date().toISOString() } : g));
    await fetch(`/api/coaching/goals/${goalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  const persistGoalOrder = (reordered: Goal[]) => {
    reordered.forEach((g, i) => {
      fetch(`/api/coaching/goals/${g.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: i }),
      });
    });
  };

  // Persist the new metric tile order by PATCHing each definition with
  // its new index. Order lives on CoachingMetricDefinition, so we patch
  // the definition (not the per-session entry) and the reorder sticks
  // across every session that displays this metric.
  const persistMetricOrder = (reordered: MetricEntry[]) => {
    reordered.forEach((entry, i) => {
      fetch(`/api/coaching/metrics/${entry.metricDefinition.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: i }),
      });
    });
  };

  const handleMetricDrop = (targetDefId: string) => {
    if (!dragMetricDefId || dragMetricDefId === targetDefId) return;
    setMetricEntries((prev) => {
      const fromIdx = prev.findIndex((m) => m.metricDefinition.id === dragMetricDefId);
      const toIdx = prev.findIndex((m) => m.metricDefinition.id === targetDefId);
      if (fromIdx < 0 || toIdx < 0) return prev;

      const dragged = prev[fromIdx];
      const target = prev[toIdx];

      // Special-case: dragging a metric tile onto a section header
      // means "add this to that section" — append it to the end of
      // that section (just before the next section header, or end of
      // list). Without this, dropping on a section would just swap
      // their order positions, which is rarely what the user wants
      // and leaves the section row stranded with empty cells.
      if (
        dragged.metricDefinition.kind !== "section" &&
        target.metricDefinition.kind === "section"
      ) {
        // Find the index of the next section header after target.
        let endOfSectionIdx = prev.length;
        for (let i = toIdx + 1; i < prev.length; i++) {
          if (prev[i].metricDefinition.kind === "section") {
            endOfSectionIdx = i;
            break;
          }
        }
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        // Splice may have shifted the target end-index by one if the
        // dragged tile lived before it in the original array.
        const insertAt = fromIdx < endOfSectionIdx ? endOfSectionIdx - 1 : endOfSectionIdx;
        next.splice(insertAt, 0, moved);
        persistMetricOrder(next);
        return next;
      }

      // Default: standard reorder — splice the dragged item into the
      // target's slot. Works for metric→metric, section→section, and
      // section→metric.
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      persistMetricOrder(next);
      return next;
    });
    setDragMetricDefId(null);
    setDragOverMetricDefId(null);
  };

  const persistTaskOrder = (tasks: Task[]) => {
    tasks.forEach((t, i) => {
      fetch(`/api/coaching/tasks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: i }),
      });
    });
  };

  const sendGoalToTop = (goalId: string) => {
    setGoals((prev) => {
      const idx = prev.findIndex((g) => g.id === goalId);
      if (idx <= 0) return prev;
      const reordered = [prev[idx], ...prev.filter((g) => g.id !== goalId)];
      persistGoalOrder(reordered);
      return reordered;
    });
  };

  const sendGoalToBottom = (goalId: string) => {
    setGoals((prev) => {
      const idx = prev.findIndex((g) => g.id === goalId);
      if (idx === -1 || idx === prev.length - 1) return prev;
      const reordered = [...prev.filter((g) => g.id !== goalId), prev[idx]];
      persistGoalOrder(reordered);
      return reordered;
    });
  };

  const sendTaskToTop = (goalId: string, taskId: string) => {
    setGoals((prev) => prev.map((g) => {
      if (g.id !== goalId) return g;
      const idx = g.tasks.findIndex((t) => t.id === taskId);
      if (idx <= 0) return g;
      const reordered = [g.tasks[idx], ...g.tasks.filter((t) => t.id !== taskId)];
      persistTaskOrder(reordered);
      return { ...g, tasks: reordered };
    }));
  };

  const sendTaskToBottom = (goalId: string, taskId: string) => {
    setGoals((prev) => prev.map((g) => {
      if (g.id !== goalId) return g;
      const idx = g.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1 || idx === g.tasks.length - 1) return g;
      const reordered = [...g.tasks.filter((t) => t.id !== taskId), g.tasks[idx]];
      persistTaskOrder(reordered);
      return { ...g, tasks: reordered };
    }));
  };

  // Subtask top/bottom — scoped to siblings sharing the same parent.
  // The order column is shared with top-level tasks but the render
  // sorts per-parent (subtasksByParent), so subtasks have their own
  // independent sort space.
  const reorderSubtasksWithinParent = (parentTaskId: string, fromIdx: number, toIdx: number) => {
    setGoals((prev) =>
      prev.map((g) => {
        const hasParent = g.tasks.some((t) => t.id === parentTaskId);
        if (!hasParent) return g;
        const siblings = g.tasks
          .filter((t) => t.parentTaskId === parentTaskId)
          .sort((a, b) => a.order - b.order);
        if (fromIdx < 0 || fromIdx >= siblings.length) return g;
        if (toIdx < 0 || toIdx >= siblings.length) return g;
        const reordered = [...siblings];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        const reorderedWithIndex = reordered.map((t, i) => ({ ...t, order: i }));
        persistTaskOrder(reorderedWithIndex);
        const updatedTasks = g.tasks.map((t) => {
          if (t.parentTaskId !== parentTaskId) return t;
          return reorderedWithIndex.find((r) => r.id === t.id) ?? t;
        });
        return { ...g, tasks: updatedTasks };
      })
    );
  };

  const sendSubtaskToTop = (parentTaskId: string, subId: string) => {
    const siblings = goals.flatMap((g) => g.tasks).filter((t) => t.parentTaskId === parentTaskId);
    const fromIdx = siblings.findIndex((s) => s.id === subId);
    if (fromIdx <= 0) return;
    reorderSubtasksWithinParent(parentTaskId, fromIdx, 0);
  };

  const sendSubtaskToBottom = (parentTaskId: string, subId: string) => {
    const siblings = goals.flatMap((g) => g.tasks).filter((t) => t.parentTaskId === parentTaskId);
    const fromIdx = siblings.findIndex((s) => s.id === subId);
    if (fromIdx === -1 || fromIdx === siblings.length - 1) return;
    reorderSubtasksWithinParent(parentTaskId, fromIdx, siblings.length - 1);
  };

  const moveSubtaskUp = (parentTaskId: string, subId: string) => {
    const siblings = goals.flatMap((g) => g.tasks).filter((t) => t.parentTaskId === parentTaskId);
    const fromIdx = siblings.findIndex((s) => s.id === subId);
    if (fromIdx <= 0) return;
    reorderSubtasksWithinParent(parentTaskId, fromIdx, fromIdx - 1);
  };

  const moveSubtaskDown = (parentTaskId: string, subId: string) => {
    const siblings = goals.flatMap((g) => g.tasks).filter((t) => t.parentTaskId === parentTaskId);
    const fromIdx = siblings.findIndex((s) => s.id === subId);
    if (fromIdx === -1 || fromIdx === siblings.length - 1) return;
    reorderSubtasksWithinParent(parentTaskId, fromIdx, fromIdx + 1);
  };

  const moveGoalUp = (goalId: string) => {
    setGoals((prev) => {
      const idx = prev.findIndex((g) => g.id === goalId);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      persistGoalOrder(next);
      return next;
    });
  };

  const moveGoalDown = (goalId: string) => {
    setGoals((prev) => {
      const idx = prev.findIndex((g) => g.id === goalId);
      if (idx === -1 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      persistGoalOrder(next);
      return next;
    });
  };

  const moveTaskUp = (goalId: string, taskId: string) => {
    setGoals((prev) => prev.map((g) => {
      if (g.id !== goalId) return g;
      const idx = g.tasks.findIndex((t) => t.id === taskId);
      if (idx <= 0) return g;
      const next = [...g.tasks];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      persistTaskOrder(next);
      return { ...g, tasks: next };
    }));
  };

  const moveTaskDown = (goalId: string, taskId: string) => {
    setGoals((prev) => prev.map((g) => {
      if (g.id !== goalId) return g;
      const idx = g.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1 || idx >= g.tasks.length - 1) return g;
      const next = [...g.tasks];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      persistTaskOrder(next);
      return { ...g, tasks: next };
    }));
  };

  const handleGoalDrop = (targetGoalId: string) => {
    if (!dragGoal || dragGoal === targetGoalId) return;
    setGoals((prev) => {
      const fromIdx = prev.findIndex((g) => g.id === dragGoal);
      const toIdx = prev.findIndex((g) => g.id === targetGoalId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      persistGoalOrder(next);
      return next;
    });
    setDragGoal(null);
    setDragOverGoal(null);
  };

  const handleTaskDrop = (goalId: string, targetTaskId: string) => {
    if (!dragTask || (dragTask.taskId === targetTaskId && dragTask.goalId === goalId)) return;
    setGoals((prev) => {
      // Find source goal and task
      const srcGoal = prev.find((g) => g.id === dragTask.goalId);
      if (!srcGoal) return prev;
      const task = srcGoal.tasks.find((t) => t.id === dragTask.taskId);
      if (!task) return prev;

      if (dragTask.goalId === goalId) {
        // Reorder within same goal
        return prev.map((g) => {
          if (g.id !== goalId) return g;
          const tasks = [...g.tasks];
          const fromIdx = tasks.findIndex((t) => t.id === dragTask.taskId);
          const toIdx = tasks.findIndex((t) => t.id === targetTaskId);
          if (fromIdx === -1 || toIdx === -1) return g;
          const [moved] = tasks.splice(fromIdx, 1);
          tasks.splice(toIdx, 0, moved);
          persistTaskOrder(tasks);
          return { ...g, tasks };
        });
      } else {
        // Move between goals
        return prev.map((g) => {
          if (g.id === dragTask.goalId) {
            const tasks = g.tasks.filter((t) => t.id !== dragTask.taskId);
            persistTaskOrder(tasks);
            return { ...g, tasks };
          }
          if (g.id === goalId) {
            const tasks = [...g.tasks];
            const toIdx = tasks.findIndex((t) => t.id === targetTaskId);
            tasks.splice(toIdx === -1 ? tasks.length : toIdx, 0, task);
            persistTaskOrder(tasks);
            // Update task's goalId on server
            fetch(`/api/coaching/tasks/${task.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ goalId }),
            });
            return { ...g, tasks };
          }
          return g;
        });
      }
    });
    setDragTask(null);
    setDragOverTask(null);
  };

  const handleSubtaskDrop = (parentTaskId: string, targetSubId: string) => {
    if (!dragSubtask || dragSubtask.parentTaskId !== parentTaskId) {
      setDragSubtask(null);
      setDragOverSubtask(null);
      return;
    }
    if (dragSubtask.subId === targetSubId) {
      setDragSubtask(null);
      setDragOverSubtask(null);
      return;
    }
    setGoals((prev) =>
      prev.map((g) => {
        const hasParent = g.tasks.some((t) => t.id === parentTaskId);
        if (!hasParent) return g;
        const siblings = g.tasks
          .filter((t) => t.parentTaskId === parentTaskId)
          .sort((a, b) => a.order - b.order);
        const fromIdx = siblings.findIndex((t) => t.id === dragSubtask.subId);
        const toIdx = siblings.findIndex((t) => t.id === targetSubId);
        if (fromIdx === -1 || toIdx === -1) return g;
        const reordered = [...siblings];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        // Reassign order on the reordered siblings and persist. Top-
        // level tasks share the order column but live in their own
        // sort space (subtasksByParent sorts per-parent), so we don't
        // need to renumber them.
        const reorderedWithIndex = reordered.map((t, i) => ({ ...t, order: i }));
        persistTaskOrder(reorderedWithIndex);
        // Splice the updated subtasks back into the goal's tasks array
        // in place of the originals.
        const updatedTasks = g.tasks.map((t) => {
          if (t.parentTaskId !== parentTaskId) return t;
          return reorderedWithIndex.find((r) => r.id === t.id) ?? t;
        });
        return { ...g, tasks: updatedTasks };
      })
    );
    setDragSubtask(null);
    setDragOverSubtask(null);
  };

  const handleTaskDropOnGoal = (goalId: string) => {
    // Drop task at end of a goal (when dropping on goal header or empty task area)
    if (!dragTask || dragTask.goalId === goalId) return;
    setGoals((prev) => {
      const srcGoal = prev.find((g) => g.id === dragTask.goalId);
      if (!srcGoal) return prev;
      const task = srcGoal.tasks.find((t) => t.id === dragTask.taskId);
      if (!task) return prev;
      return prev.map((g) => {
        if (g.id === dragTask.goalId) {
          const tasks = g.tasks.filter((t) => t.id !== dragTask.taskId);
          persistTaskOrder(tasks);
          return { ...g, tasks };
        }
        if (g.id === goalId) {
          const tasks = [...g.tasks, task];
          persistTaskOrder(tasks);
          fetch(`/api/coaching/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ goalId }),
          });
          return { ...g, tasks };
        }
        return g;
      });
    });
    setDragTask(null);
    setDragOverTask(null);
    setDragOverGoal(null);
  };

  const deleteGoal = async (goalId: string) => {
    if (!window.confirm("Are you sure you want to delete this goal and all its tasks?")) return;
    setGoals((prev) => prev.filter((g) => g.id !== goalId));
    await fetch(`/api/coaching/goals/${goalId}`, { method: "DELETE" });
  };

  const deleteTask = async (goalId: string, taskId: string) => {
    if (!window.confirm("Are you sure you want to delete this task?")) return;
    setGoals((prev) => prev.map((g) =>
      g.id === goalId ? { ...g, tasks: g.tasks.filter((t) => t.id !== taskId) } : g
    ));
    await fetch(`/api/coaching/tasks/${taskId}`, { method: "DELETE" });
  };

  const updateMetricName = (metricDefId: string, name: string) => {
    setMetricEntries((prev) => prev.map((e) =>
      e.metricDefinition.id === metricDefId ? { ...e, metricDefinition: { ...e.metricDefinition, name } } : e
    ));
    const key = `metric-name-${metricDefId}`;
    if (descSaveTimers.current[key]) clearTimeout(descSaveTimers.current[key]);
    descSaveTimers.current[key] = setTimeout(async () => {
      await fetch(`/api/coaching/metrics/${metricDefId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      delete descSaveTimers.current[key];
    }, 1500);
  };

  const updateMetricDefinition = (metricDefId: string, definition: string) => {
    setMetricEntries((prev) => prev.map((e) =>
      e.metricDefinition.id === metricDefId ? { ...e, metricDefinition: { ...e.metricDefinition, definition: definition || undefined } } : e
    ));
    const key = `metric-def-${metricDefId}`;
    if (descSaveTimers.current[key]) clearTimeout(descSaveTimers.current[key]);
    descSaveTimers.current[key] = setTimeout(async () => {
      await fetch(`/api/coaching/metrics/${metricDefId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: definition || null }),
      });
      delete descSaveTimers.current[key];
    }, 1500);
  };

  const updateMetricFormat = (metricDefId: string, format: string) => {
    setMetricEntries((prev) => prev.map((e) =>
      e.metricDefinition.id === metricDefId ? { ...e, metricDefinition: { ...e.metricDefinition, format } } : e
    ));
    fetch(`/api/coaching/metrics/${metricDefId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format }),
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
      // Prepend new task to top of active tasks (before completed ones)
      setGoals((prev) => prev.map((g) => {
        if (g.id !== goalId) return g;
        const active = g.tasks.filter((t) => t.status !== "done");
        const done = g.tasks.filter((t) => t.status === "done");
        return { ...g, tasks: [data.task, ...active, ...done] };
      }));
    }
  };

  const addSubtask = async (goalId: string, parentTaskId: string) => {
    const title = newSubtaskTitles[parentTaskId]?.trim();
    if (!title) return;
    setNewSubtaskTitles((prev) => ({ ...prev, [parentTaskId]: "" }));
    const res = await fetch(`/api/coaching/goals/${goalId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, parentTaskId }),
    });
    if (res.ok) {
      const data = await res.json();
      // Insert the new subtask immediately after its parent in the
      // flat goal.tasks array so it appears at the top of the parent's
      // subtask group when we re-derive subtasksByParent on render.
      setGoals((prev) => prev.map((g) => {
        if (g.id !== goalId) return g;
        const parentIdx = g.tasks.findIndex((t) => t.id === parentTaskId);
        const updated = [...g.tasks];
        updated.splice(parentIdx >= 0 ? parentIdx + 1 : updated.length, 0, data.task);
        return { ...g, tasks: updated };
      }));
    }
  };

  const [animatingTaskId, setAnimatingTaskId] = useState<string | null>(null);

  const updateTaskStatus = async (taskId: string, status: string) => {
    if (status === "done") {
      // Step 1: Mark as done visually (strikethrough, green check) + start fade animation
      setAnimatingTaskId(taskId);
      setGoals((prev) => prev.map((g) => ({
        ...g,
        tasks: g.tasks.map((t) => t.id === taskId ? { ...t, status, statusChangedAt: new Date().toISOString() } : t),
      })));
      // Step 2: After animation, reorder
      setTimeout(() => {
        setAnimatingTaskId(null);
        setGoals((prev) => prev.map((g) => {
          const activeTasks = g.tasks.filter((t) => t.status !== "done");
          const doneTasks = g.tasks.filter((t) => t.status === "done")
            .sort((a, b) => new Date(b.statusChangedAt || 0).getTime() - new Date(a.statusChangedAt || 0).getTime());
          return { ...g, tasks: [...activeTasks, ...doneTasks] };
        }));
      }, 600);
    } else {
      // Unchecking: reorder immediately (move back to active section)
      setGoals((prev) => prev.map((g) => {
        const updatedTasks = g.tasks.map((t) => t.id === taskId ? { ...t, status, statusChangedAt: new Date().toISOString() } : t);
        const activeTasks = updatedTasks.filter((t) => t.status !== "done");
        const doneTasks = updatedTasks.filter((t) => t.status === "done")
          .sort((a, b) => new Date(b.statusChangedAt || 0).getTime() - new Date(a.statusChangedAt || 0).getTime());
        return { ...g, tasks: [...activeTasks, ...doneTasks] };
      }));
    }
    await fetch(`/api/coaching/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  const updateTaskDescription = (taskId: string, description: string) => {
    setEditingDescriptions((prev) => ({ ...prev, [taskId]: description }));
    // Optimistic update
    setGoals((prev) => prev.map((g) => ({
      ...g,
      tasks: g.tasks.map((t) => t.id === taskId ? { ...t, description } : t),
    })));
    // Debounced save
    if (descSaveTimers.current[taskId]) clearTimeout(descSaveTimers.current[taskId]);
    descSaveTimers.current[taskId] = setTimeout(async () => {
      await fetch(`/api/coaching/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      delete descSaveTimers.current[taskId];
    }, 1500);
  };

  const updateGoalTitle = (goalId: string, title: string) => {
    setGoals((prev) => prev.map((g) => g.id === goalId ? { ...g, title } : g));
    if (descSaveTimers.current[`goal-title-${goalId}`]) clearTimeout(descSaveTimers.current[`goal-title-${goalId}`]);
    descSaveTimers.current[`goal-title-${goalId}`] = setTimeout(async () => {
      await fetch(`/api/coaching/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      delete descSaveTimers.current[`goal-title-${goalId}`];
    }, 1500);
  };

  const updateGoalDescription = (goalId: string, description: string) => {
    setGoals((prev) => prev.map((g) => g.id === goalId ? { ...g, description } : g));
    if (descSaveTimers.current[`goal-desc-${goalId}`]) clearTimeout(descSaveTimers.current[`goal-desc-${goalId}`]);
    descSaveTimers.current[`goal-desc-${goalId}`] = setTimeout(async () => {
      await fetch(`/api/coaching/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      delete descSaveTimers.current[`goal-desc-${goalId}`];
    }, 1500);
  };

  const updateTaskTitle = (taskId: string, title: string) => {
    setGoals((prev) => prev.map((g) => ({
      ...g,
      tasks: g.tasks.map((t) => t.id === taskId ? { ...t, title } : t),
    })));
    if (descSaveTimers.current[`task-title-${taskId}`]) clearTimeout(descSaveTimers.current[`task-title-${taskId}`]);
    descSaveTimers.current[`task-title-${taskId}`] = setTimeout(async () => {
      await fetch(`/api/coaching/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      delete descSaveTimers.current[`task-title-${taskId}`];
    }, 1500);
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
    const format = newMetricFormat;
    setNewMetricName("");
    setNewMetricDefinition("");
    setNewMetricFormat("number");
    setAddingMetric(false);
    const res = await fetch("/api/coaching/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, definition, format }),
    });
    if (res.ok) {
      const data = await res.json();
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
          previousValue: null,
          history: [],
          metricDefinition: { id: data.metric.id, name, definition, format, isDefault: false },
        }]);
      }
    }
  };

  // Insert a new section header into the metrics grid. Sections share
  // the order column with metric tiles; the API picks max(order)+1 so
  // the new section lands at the end and the user can drag it into
  // place.
  const addSection = async () => {
    const res = await fetch("/api/coaching/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New section", kind: "section" }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setMetricEntries((prev) => [...prev, {
      id: `section-${data.metric.id}`,
      currentValue: 0,
      addedSinceLastSession: 0,
      previousValue: null,
      history: [],
      metricDefinition: {
        id: data.metric.id,
        name: data.metric.name,
        isDefault: false,
        kind: "section",
      },
    }]);
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
          previousValue: null,
          history: [],
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
    STATUS_OPTIONS.find((s) => s.value === status)?.color || "bg-gray-100 text-gray-600 dark:text-gray-300";

  // ── Up Next handlers ───────────────────────────────────────────

  const addNextGoal = async () => {
    if (!newNextGoalTitle.trim()) return;
    const title = newNextGoalTitle.trim();
    setNewNextGoalTitle("");
    const res = await fetch("/api/coaching/next-goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const data = await res.json();
      setNextGoals((prev) => [...prev, { ...data.goal, tasks: [] }]);
    }
  };

  const addNextTask = async (goalId: string) => {
    const title = newNextTaskTitles[goalId]?.trim();
    if (!title) return;
    setNewNextTaskTitles((prev) => ({ ...prev, [goalId]: "" }));
    const res = await fetch(`/api/coaching/next-goals/${goalId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const data = await res.json();
      setNextGoals((prev) => prev.map((g) =>
        g.id === goalId ? { ...g, tasks: [...g.tasks, data.task] } : g
      ));
    }
  };

  const updateNextGoalTitle = (goalId: string, title: string) => {
    setNextGoals((prev) => prev.map((g) => g.id === goalId ? { ...g, title } : g));
    const key = `next-goal-title-${goalId}`;
    if (descSaveTimers.current[key]) clearTimeout(descSaveTimers.current[key]);
    descSaveTimers.current[key] = setTimeout(async () => {
      await fetch(`/api/coaching/next-goals/${goalId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      delete descSaveTimers.current[key];
    }, 1500);
  };

  const updateNextGoalDescription = (goalId: string, description: string) => {
    setNextGoals((prev) => prev.map((g) => g.id === goalId ? { ...g, description } : g));
    const key = `next-goal-desc-${goalId}`;
    if (descSaveTimers.current[key]) clearTimeout(descSaveTimers.current[key]);
    descSaveTimers.current[key] = setTimeout(async () => {
      await fetch(`/api/coaching/next-goals/${goalId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }) });
      delete descSaveTimers.current[key];
    }, 1500);
  };

  const updateNextTaskTitle = (taskId: string, title: string) => {
    setNextGoals((prev) => prev.map((g) => ({ ...g, tasks: g.tasks.map((t) => t.id === taskId ? { ...t, title } : t) })));
    const key = `next-task-title-${taskId}`;
    if (descSaveTimers.current[key]) clearTimeout(descSaveTimers.current[key]);
    descSaveTimers.current[key] = setTimeout(async () => {
      await fetch(`/api/coaching/next-tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      delete descSaveTimers.current[key];
    }, 1500);
  };

  const updateNextTaskDescription = (taskId: string, description: string) => {
    setEditingNextDescriptions((prev) => ({ ...prev, [taskId]: description }));
    setNextGoals((prev) => prev.map((g) => ({ ...g, tasks: g.tasks.map((t) => t.id === taskId ? { ...t, description } : t) })));
    const key = `next-task-desc-${taskId}`;
    if (descSaveTimers.current[key]) clearTimeout(descSaveTimers.current[key]);
    descSaveTimers.current[key] = setTimeout(async () => {
      await fetch(`/api/coaching/next-tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }) });
      delete descSaveTimers.current[key];
    }, 1500);
  };

  // Flush helpers — cancel the pending 1500ms debounce and fire the
  // PATCH immediately with the latest value already in optimistic
  // state. Used by description editors on blur so click-out commits
  // the edit synchronously instead of relying on the debounce timer
  // (which the user could outrun by navigating away).
  const flushTaskDescriptionSave = (taskId: string) => {
    if (descSaveTimers.current[taskId]) {
      clearTimeout(descSaveTimers.current[taskId]);
      delete descSaveTimers.current[taskId];
    }
    const task = goals.flatMap((g) => g.tasks).find((t) => t.id === taskId);
    if (!task) return;
    void fetch(`/api/coaching/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: task.description ?? "" }),
    });
  };

  const flushGoalDescriptionSave = (goalId: string) => {
    const key = `goal-desc-${goalId}`;
    if (descSaveTimers.current[key]) {
      clearTimeout(descSaveTimers.current[key]);
      delete descSaveTimers.current[key];
    }
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    void fetch(`/api/coaching/goals/${goalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: goal.description ?? "" }),
    });
  };

  const flushNextGoalDescriptionSave = (goalId: string) => {
    const key = `next-goal-desc-${goalId}`;
    if (descSaveTimers.current[key]) {
      clearTimeout(descSaveTimers.current[key]);
      delete descSaveTimers.current[key];
    }
    const goal = nextGoals.find((g) => g.id === goalId);
    if (!goal) return;
    void fetch(`/api/coaching/next-goals/${goalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: goal.description ?? "" }),
    });
  };

  const flushNextTaskDescriptionSave = (taskId: string) => {
    const key = `next-task-desc-${taskId}`;
    if (descSaveTimers.current[key]) {
      clearTimeout(descSaveTimers.current[key]);
      delete descSaveTimers.current[key];
    }
    const task = nextGoals.flatMap((g) => g.tasks).find((t) => t.id === taskId);
    if (!task) return;
    void fetch(`/api/coaching/next-tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: task.description ?? "" }),
    });
  };

  const deleteNextGoal = async (goalId: string) => {
    if (!window.confirm("Delete this future goal and all its tasks?")) return;
    setNextGoals((prev) => prev.filter((g) => g.id !== goalId));
    await fetch(`/api/coaching/next-goals/${goalId}`, { method: "DELETE" });
  };

  // Open a new chat (DIRECT mode) pre-seeded with a question asking
  // Mikey to find the coaching discussion that created the given task.
  // Bundles the most recent 10 non-draft sessions (notes + transcripts,
  // each transcript capped at 30k chars). If the target is a subtask,
  // its parent task is included so the model can reason about both
  // levels of context.
  const askMikeyForTaskContext = async (task: Task, parentTask: Task | null) => {
    if (askingMikeyFor) return; // ignore double-click while one is in flight
    setAskingMikeyFor(task.id);
    try {
    const createdStr = task.createdAt
      ? new Date(task.createdAt).toLocaleDateString("en-US", {
          month: "long", day: "numeric", year: "numeric",
        })
      : "an unknown date";
    let context = `This is a task that was created on ${createdStr} from a coaching session. Please look through the below context and find the relevant discussion that prompted the creation of the task, and synthesize what the discussion covered and what the outcomes were.\n\n---\n\n`;

    context += `## The Task in Question\n\n`;
    context += `**Title:** ${task.title}\n`;
    if (task.description) context += `**Description:** ${task.description}\n`;
    context += `**Status:** ${task.status}\n`;
    context += `**Created:** ${createdStr}\n\n`;

    if (parentTask) {
      context += `### Parent Task (this is a subtask of:)\n\n`;
      context += `**Title:** ${parentTask.title}\n`;
      if (parentTask.description) context += `**Description:** ${parentTask.description}\n`;
      context += `**Status:** ${parentTask.status}\n\n`;
    }

    try {
      const res = await fetch("/api/coaching-sessions");
      if (res.ok) {
        const data = await res.json();
        const recent = (data.sessions || [])
          .filter((s: { notes: string }) => s.notes !== "(draft)")
          .slice(0, 10);
        if (recent.length > 0) {
          context += `\n---\n\n## Recent Coaching Sessions (most recent ${recent.length})\n\n`;
          for (const session of recent) {
            const sessionDate = new Date(session.sessionDate).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
            });
            context += `### ${session.title || "Untitled"} (${sessionDate})\n\n`;
            if (session.notes) {
              const notesTruncated = session.notes.length > 4000
                ? session.notes.substring(0, 4000) + "...[truncated]"
                : session.notes;
              context += `**Notes:**\n${notesTruncated}\n\n`;
            }
            if (session.transcript) {
              const transcriptTruncated = session.transcript.length > 30000
                ? session.transcript.substring(0, 30000) + "\n...[transcript truncated]"
                : session.transcript;
              context += `**Transcript:**\n${transcriptTruncated}\n\n`;
            }
            context += `---\n\n`;
          }
        }
      }
    } catch (err) {
      console.error("[ask-mikey-task] failed to load sessions:", err);
    }

    try {
      const res = await fetch("/api/conversations/from-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `🌊 Context for: ${task.title.slice(0, 60)}`,
          context,
          autoSend: true,
          // GPT direct mode — full transcripts in one window, no
          // Chatbase RAG between us and the transcripts.
          mode: "DIRECT",
        }),
      });
      const data = await res.json();
      if (data.conversationId) {
        sessionStorage.setItem(`autoSend-${data.conversationId}`, context);
        window.open(`/chat/${data.conversationId}?autoSend=true`, "_blank");
      }
    } catch (err) {
      console.error("[ask-mikey-task] failed to open chat:", err);
    }
    } finally {
      setAskingMikeyFor(null);
    }
  };

  const deleteNextTask = async (goalId: string, taskId: string) => {
    if (!window.confirm("Delete this future task?")) return;
    setNextGoals((prev) => prev.map((g) => g.id === goalId ? { ...g, tasks: g.tasks.filter((t) => t.id !== taskId) } : g));
    await fetch(`/api/coaching/next-tasks/${taskId}`, { method: "DELETE" });
  };

  const promoteNextGoal = async (goalId: string) => {
    const res = await fetch(`/api/coaching/next-goals/${goalId}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (res.ok) {
      const data = await res.json();
      // Move from next to active
      setNextGoals((prev) => prev.filter((g) => g.id !== goalId));
      setGoals((prev) => [...prev, data.goal]);
    }
  };

  const handleNextGoalDrop = (targetId: string) => {
    if (!dragNextGoal || dragNextGoal === targetId) return;
    setNextGoals((prev) => {
      const fromIdx = prev.findIndex((g) => g.id === dragNextGoal);
      const toIdx = prev.findIndex((g) => g.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      next.forEach((g, i) => { fetch(`/api/coaching/next-goals/${g.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: i }) }); });
      return next;
    });
    setDragNextGoal(null);
    setDragOverNextGoal(null);
  };

  const handleNextTaskDrop = (goalId: string, targetTaskId: string) => {
    if (!dragNextTask || dragNextTask.taskId === targetTaskId) return;
    setNextGoals((prev) => prev.map((g) => {
      if (g.id !== goalId) return g;
      const tasks = [...g.tasks];
      const fromIdx = tasks.findIndex((t) => t.id === dragNextTask.taskId);
      const toIdx = tasks.findIndex((t) => t.id === targetTaskId);
      if (fromIdx === -1 || toIdx === -1) return g;
      const [moved] = tasks.splice(fromIdx, 1);
      tasks.splice(toIdx, 0, moved);
      tasks.forEach((t, i) => { fetch(`/api/coaching/next-tasks/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: i }) }); });
      return { ...g, tasks };
    }));
    setDragNextTask(null);
    setDragOverNextTask(null);
  };

  // ── Render ─────────────────────────────────────────────────────

  if (!dataLoaded) {
    return (
      <div className="space-y-6 mb-8">
        {/* Up Next skeleton */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-4 w-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800" />
            <div className="h-4 w-24 bg-gray-200 rounded animate-pulse dark:bg-gray-800" />
          </div>
          <div className="space-y-3">
            <div className="h-10 bg-gray-100 rounded-lg animate-pulse dark:bg-gray-900/40" />
            <div className="h-10 bg-gray-100 rounded-lg animate-pulse dark:bg-gray-900/40" />
          </div>
        </div>
        {/* Maturity Stage skeleton */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-4 w-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800" />
            <div className="h-4 w-36 bg-gray-200 rounded animate-pulse dark:bg-gray-800" />
          </div>
          <div className="h-10 bg-gray-100 rounded-lg animate-pulse dark:bg-gray-900/40" />
        </div>
        {/* Metrics skeleton */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-4 w-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800" />
            <div className="h-4 w-20 bg-gray-200 rounded animate-pulse dark:bg-gray-800" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="h-16 bg-gray-100 rounded-lg animate-pulse dark:bg-gray-900/40" />
            <div className="h-16 bg-gray-100 rounded-lg animate-pulse dark:bg-gray-900/40" />
            <div className="h-16 bg-gray-100 rounded-lg animate-pulse dark:bg-gray-900/40" />
          </div>
        </div>
        {/* Goals & Tasks skeleton */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-4 w-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800" />
            <div className="h-4 w-28 bg-gray-200 rounded animate-pulse dark:bg-gray-800" />
          </div>
          <div className="space-y-4">
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 dark:bg-gray-900/30">
                <div className="h-4 w-48 bg-gray-200 rounded animate-pulse dark:bg-gray-800" />
              </div>
              <div className="divide-y divide-gray-100">
                <div className="px-4 py-2.5 pl-8"><div className="h-4 w-64 bg-gray-100 rounded animate-pulse dark:bg-gray-900/40" /></div>
                <div className="px-4 py-2.5 pl-8"><div className="h-4 w-56 bg-gray-100 rounded animate-pulse dark:bg-gray-900/40" /></div>
                <div className="px-4 py-2.5 pl-8"><div className="h-4 w-44 bg-gray-100 rounded animate-pulse dark:bg-gray-900/40" /></div>
              </div>
            </div>
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 dark:bg-gray-900/30">
                <div className="h-4 w-40 bg-gray-200 rounded animate-pulse dark:bg-gray-800" />
              </div>
              <div className="divide-y divide-gray-100">
                <div className="px-4 py-2.5 pl-8"><div className="h-4 w-52 bg-gray-100 rounded animate-pulse dark:bg-gray-900/40" /></div>
                <div className="px-4 py-2.5 pl-8"><div className="h-4 w-60 bg-gray-100 rounded animate-pulse dark:bg-gray-900/40" /></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 mb-8">
      {/* ── Up Next Queue ──────────────────────────────────────── */}
      {(() => {
        // In read-only mode, only show next goals that existed when this session was created
        const visibleNextGoals = !canEdit && sessionCreatedAt
          ? nextGoals.filter((g) => new Date(g.createdAt || 0) <= new Date(sessionCreatedAt))
          : nextGoals;
        return visibleNextGoals.length > 0 || canEdit ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-2">
            <span>📋</span> Up Next
          </h3>
          <p className="text-xs text-gray-400 mb-3">Future goals and tasks to promote into your current session when ready.</p>
          <div className="space-y-3">
            {visibleNextGoals.map((goal) => (
              <div
                key={goal.id}
                id={`next-goal-${goal.id}`}
                draggable
                onDragStart={(e) => { setDragNextGoal(goal.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => { setDragNextGoal(null); setDragOverNextGoal(null); }}
                onDragOver={(e) => { if (dragNextGoal && dragNextGoal !== goal.id) { e.preventDefault(); setDragOverNextGoal(goal.id); } }}
                onDragLeave={() => setDragOverNextGoal(null)}
                onDrop={() => handleNextGoalDrop(goal.id)}
                className={`border rounded-lg overflow-hidden scroll-mt-24 transition-all ${dragNextGoal === goal.id ? "opacity-40" : ""} ${dragOverNextGoal === goal.id ? "border-purple-400 shadow-md" : "border-gray-200 dark:border-gray-700"}`}
              >
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/50 dark:bg-gray-700/30 gap-2 group/ngoal">
                  {canEdit && (
                  <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 mr-1">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                  </div>
                  )}
                  <div className="flex-1 min-w-0">
                    {canEdit ? (
                      <>
                        <input type="text" value={goal.title} onChange={(e) => updateNextGoalTitle(goal.id, e.target.value)} className="font-medium text-gray-900 dark:text-gray-100 text-sm bg-transparent border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-purple-500 focus:ring-0 w-full px-0 py-0" />
                        {editingNextGoalDescId === goal.id ? (
                          <div className="mt-1" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditingNextGoalDescId(null); } }}>
                            <RichTextCommentEditor
                              value={goal.description || ""}
                              onChange={(md) => updateNextGoalDescription(goal.id, md)}
                              onSubmit={() => { flushNextGoalDescriptionSave(goal.id); setEditingNextGoalDescId(null); }}
                              onBlur={() => { flushNextGoalDescriptionSave(goal.id); setEditingNextGoalDescId(null); }}
                              autoFocus
                              minHeight={48}
                              placeholder="Add description…"
                            />
                            <div className="text-[10px] text-gray-400 mt-1">⌘↵ to save · Esc to cancel · click outside to save</div>
                          </div>
                        ) : goal.description ? (
                          <div
                            onClick={(e) => {
                              if (!(e.target instanceof HTMLAnchorElement)) setEditingNextGoalDescId(goal.id);
                            }}
                            className="text-xs text-gray-600 dark:text-gray-300 block mt-0.5 prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 cursor-text hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1 -mx-1"
                          >
                            <DescriptionMarkdown>{goal.description}</DescriptionMarkdown>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingNextGoalDescId(goal.id)}
                            className="text-xs text-purple-500 hover:text-purple-700 font-medium mt-0.5"
                          >
                            Add description
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{goal.title}</span>
                        {goal.description && (
                          <div className="text-xs text-gray-600 dark:text-gray-300 block mt-0.5 prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                            <DescriptionMarkdown>{goal.description}</DescriptionMarkdown>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <button onClick={() => copyAnchorLink(`next-goal-${goal.id}`)} className="flex-shrink-0 p-1 text-gray-500 dark:text-gray-400 hover:text-purple-600 opacity-0 group-hover/ngoal:opacity-100 transition-opacity" title="Copy link">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                  </button>
                  {canEdit && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => promoteNextGoal(goal.id)} className="text-xs font-medium text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 px-2 py-1 rounded-full transition-colors dark:text-green-300 dark:bg-green-900/30" title="Promote to active goals">Promote</button>
                    <button onClick={() => deleteNextGoal(goal.id)} className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover/ngoal:opacity-100 transition-opacity" title="Delete goal">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                  )}
                </div>
                <div className="divide-y divide-gray-100">
                  {goal.tasks.map((task) => {
                    const descText = editingNextDescriptions[task.id] ?? task.description ?? "";
                    return (
                      <div key={task.id} id={`next-task-${task.id}`} draggable={canEdit}
                        onDragStart={canEdit ? (e) => { e.stopPropagation(); setDragNextTask({ goalId: goal.id, taskId: task.id }); e.dataTransfer.effectAllowed = "move"; } : undefined}
                        onDragEnd={canEdit ? () => { setDragNextTask(null); setDragOverNextTask(null); } : undefined}
                        onDragOver={canEdit ? (e) => { if (dragNextTask && dragNextTask.taskId !== task.id) { e.preventDefault(); e.stopPropagation(); setDragOverNextTask(task.id); } } : undefined}
                        onDragLeave={canEdit ? () => setDragOverNextTask(null) : undefined}
                        onDrop={canEdit ? (e) => { e.stopPropagation(); handleNextTaskDrop(goal.id, task.id); } : undefined}
                        className={`px-4 py-2 pl-8 group/ntask transition-all ${dragNextTask?.taskId === task.id ? "opacity-40" : ""} ${dragOverNextTask === task.id ? "bg-purple-50 border-t-2 border-purple-400" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            {canEdit && (
                            <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 mt-0.5 mr-0.5">
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/></svg>
                            </div>
                            )}
                            <div className="min-w-0 flex-1">
                              {canEdit ? (
                                <textarea value={task.title} onChange={(e) => { updateNextTaskTitle(task.id, e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }} ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }} rows={1} className="text-sm text-gray-700 dark:text-gray-200 bg-transparent border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-purple-500 focus:ring-0 w-full px-0 py-0 resize-none overflow-hidden" />
                              ) : (
                                <span className="text-sm text-gray-700 dark:text-gray-200"><Linkify>{task.title}</Linkify></span>
                              )}
                              {canEdit && editingNextDescTask === task.id ? (
                                <div className="mt-1" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditingNextDescTask(null); } }}>
                                  <RichTextCommentEditor
                                    value={descText}
                                    onChange={(md) => updateNextTaskDescription(task.id, md)}
                                    onSubmit={() => { flushNextTaskDescriptionSave(task.id); setEditingNextDescTask(null); }}
                                    onBlur={() => { flushNextTaskDescriptionSave(task.id); setEditingNextDescTask(null); }}
                                    autoFocus
                                    minHeight={48}
                                    placeholder="Add details, links, notes…"
                                  />
                                  <div className="text-[10px] text-gray-400 mt-1">⌘↵ to save · Esc to cancel · click outside to save</div>
                                </div>
                              ) : descText ? (
                                <div onClick={canEdit ? (e) => { if (!(e.target instanceof HTMLAnchorElement)) setEditingNextDescTask(task.id); } : undefined} className={`text-sm text-gray-500 dark:text-gray-400 mt-0.5 prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 ${canEdit ? "cursor-text hover:bg-gray-50 dark:hover:bg-gray-700" : ""} rounded px-1 -mx-1`}><DescriptionMarkdown>{descText}</DescriptionMarkdown></div>
                              ) : canEdit ? (
                                <button onClick={() => setEditingNextDescTask(task.id)} className="text-xs text-purple-500 hover:text-purple-700 font-medium mt-0.5">Add description</button>
                              ) : null}
                            </div>
                          </div>
                          {canEdit && (
                          <button onClick={() => deleteNextTask(goal.id, task.id)} className="flex-shrink-0 p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover/ntask:opacity-100 transition-opacity mt-0.5" title="Delete task">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {canEdit && (
                  <div className="flex items-center gap-2 px-4 py-2 pl-8">
                    <input type="text" value={newNextTaskTitles[goal.id] || ""} onChange={(e) => setNewNextTaskTitles((prev) => ({ ...prev, [goal.id]: e.target.value }))} placeholder="Add a future task..." className="flex-1 px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" onKeyDown={(e) => e.key === "Enter" && addNextTask(goal.id)} />
                    <button onClick={() => addNextTask(goal.id)} disabled={!newNextTaskTitles[goal.id]?.trim()} className="text-xs text-purple-600 font-medium disabled:opacity-50 dark:text-purple-300">Add</button>
                  </div>
                  )}
                </div>
              </div>
            ))}
            {canEdit && (
            <div className="flex items-center gap-2">
              <input type="text" value={newNextGoalTitle} onChange={(e) => setNewNextGoalTitle(e.target.value)} placeholder="Add a future goal..." className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500" onKeyDown={(e) => e.key === "Enter" && addNextGoal()} />
              <button onClick={addNextGoal} disabled={!newNextGoalTitle.trim()} className="px-4 py-2 text-sm text-purple-600 font-medium hover:bg-purple-50 rounded-lg disabled:opacity-50 dark:text-purple-300">+ Add Goal</button>
            </div>
            )}
          </div>
        </div>
      ) : null;
      })()}

      {/* ── Maturity Stage ──────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span>🔄</span> Sales Maturity Stage
        </h3>
        <select
          value={maturityStage || ""}
          onChange={(e) => canEdit && e.target.value && updateMaturityStage(e.target.value)}
          disabled={!canEdit}
          className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white dark:bg-gray-800 disabled:bg-gray-50 disabled:cursor-default"
        >
          <option value="">Select your current stage...</option>
          {MATURITY_STAGES.map((stage) => (
            <option key={stage.value} value={stage.value}>
              {stage.short} — {stage.label}
            </option>
          ))}
        </select>
        {(() => {
          const selected = MATURITY_STAGES.find((s) => s.value === maturityStage);
          if (!selected) return null;
          return (
            <div className="mt-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg p-4 text-sm space-y-2">
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Entry criteria: </span>
                <span className="text-gray-600 dark:text-gray-300">{selected.entry}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Exit criteria: </span>
                <span className="text-gray-600 dark:text-gray-300">{selected.exit}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Metrics ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span>📊</span> Metrics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {metricEntries.map((entry) => {
            // Section markers render as a full-width header strip so
            // the next tile starts on a fresh row. They share the same
            // drag/drop wiring as tiles since order is the only thing
            // that matters for reordering.
            if (entry.metricDefinition.kind === "section") {
              return (
                <div
                  key={entry.id}
                  draggable={canEdit}
                  onDragStart={canEdit ? (e) => { setDragMetricDefId(entry.metricDefinition.id); e.dataTransfer.effectAllowed = "move"; } : undefined}
                  onDragEnd={canEdit ? () => { setDragMetricDefId(null); setDragOverMetricDefId(null); } : undefined}
                  onDragOver={canEdit ? (e) => { if (dragMetricDefId && dragMetricDefId !== entry.metricDefinition.id) { e.preventDefault(); setDragOverMetricDefId(entry.metricDefinition.id); } } : undefined}
                  onDragLeave={canEdit ? () => setDragOverMetricDefId((cur) => (cur === entry.metricDefinition.id ? null : cur)) : undefined}
                  onDrop={canEdit ? () => handleMetricDrop(entry.metricDefinition.id) : undefined}
                  className={`col-span-2 sm:col-span-3 px-3 py-2 mt-2 first:mt-0 border-t-2 border-gray-200 dark:border-gray-700 flex items-center gap-2 group group/metric transition-colors ${canEdit ? "cursor-grab active:cursor-grabbing" : ""} ${dragMetricDefId === entry.metricDefinition.id ? "opacity-40" : ""} ${dragOverMetricDefId === entry.metricDefinition.id && dragMetricDefId ? "ring-2 ring-purple-400 ring-offset-1 rounded" : ""}`}
                >
                  {canEdit && (
                    <div className="flex-shrink-0 text-gray-300 dark:text-gray-500 opacity-0 group-hover/metric:opacity-100 transition-opacity pointer-events-none">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                        <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                        <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                      </svg>
                    </div>
                  )}
                  {canEdit ? (
                    <input
                      type="text"
                      value={entry.metricDefinition.name}
                      onChange={(e) => updateMetricName(entry.metricDefinition.id, e.target.value)}
                      placeholder="Section name"
                      className="flex-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-transparent border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-purple-500 focus:ring-0 px-0 py-0"
                    />
                  ) : (
                    <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      {entry.metricDefinition.name || "Section"}
                    </span>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => deleteMetric(entry.metricDefinition.id)}
                      title="Delete section"
                      className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover/metric:opacity-100 transition-opacity rounded"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                </div>
              );
            }
            return (
            <div
              key={entry.id}
              draggable={canEdit}
              onDragStart={canEdit ? (e) => { setDragMetricDefId(entry.metricDefinition.id); e.dataTransfer.effectAllowed = "move"; } : undefined}
              onDragEnd={canEdit ? () => { setDragMetricDefId(null); setDragOverMetricDefId(null); } : undefined}
              onDragOver={canEdit ? (e) => { if (dragMetricDefId && dragMetricDefId !== entry.metricDefinition.id) { e.preventDefault(); setDragOverMetricDefId(entry.metricDefinition.id); } } : undefined}
              onDragLeave={canEdit ? () => setDragOverMetricDefId((cur) => (cur === entry.metricDefinition.id ? null : cur)) : undefined}
              onDrop={canEdit ? () => handleMetricDrop(entry.metricDefinition.id) : undefined}
              className={`bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3 text-center relative group group/metric transition-all ${canEdit ? "cursor-grab active:cursor-grabbing" : ""} ${dragMetricDefId === entry.metricDefinition.id ? "opacity-40" : ""} ${dragOverMetricDefId === entry.metricDefinition.id && dragMetricDefId ? "ring-2 ring-purple-400 ring-offset-1" : ""}`}
            >
              {/* Drag handle — six-dot grip in the top-left, fades in
                  on tile hover. Visible affordance for the
                  drag-to-reorder behavior wired on the tile div. */}
              {canEdit && (
                <div className="absolute top-1 left-1 text-gray-300 dark:text-gray-500 opacity-0 group-hover/metric:opacity-100 transition-opacity pointer-events-none">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                    <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                    <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                  </svg>
                </div>
              )}
              {/* Fast popover tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover/metric:opacity-100 transition-opacity duration-100 pointer-events-none z-10 max-w-xs">
                <div className="font-medium">{entry.metricDefinition.name}</div>
                {entry.metricDefinition.definition && (
                  <div className="text-gray-300 font-normal mt-0.5 whitespace-normal">{entry.metricDefinition.definition}</div>
                )}
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
              </div>
              {canEdit && (
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                  {METRIC_FORMATS.map((fmt) => (
                    <button
                      key={fmt.value}
                      onClick={() => updateMetricFormat(entry.metricDefinition.id, fmt.value)}
                      title={fmt.title}
                      className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${entry.metricDefinition.format === fmt.value ? "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
                    >
                      {fmt.label}
                    </button>
                  ))}
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
              {canEdit ? (
                <input
                  type="text"
                  value={entry.metricDefinition.name}
                  onChange={(e) => updateMetricName(entry.metricDefinition.id, e.target.value)}
                  className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1 bg-transparent border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-purple-500 focus:ring-0 w-full text-center px-0 py-0"
                />
              ) : (
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">{entry.metricDefinition.name}</div>
              )}
              {canEdit ? (
                <input
                  type="text"
                  value={entry.metricDefinition.definition || ""}
                  onChange={(e) => updateMetricDefinition(entry.metricDefinition.id, e.target.value)}
                  placeholder="Add definition..."
                  className="text-[10px] text-gray-400 mb-1.5 leading-tight bg-transparent border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-purple-500 focus:ring-0 w-full text-center px-0 py-0"
                />
              ) : entry.metricDefinition.definition ? (
                <div className="text-[10px] text-gray-400 mb-1.5 leading-tight">{entry.metricDefinition.definition}</div>
              ) : null}
              {entry.previousValue != null && (() => {
                const isPinned = pinnedHistoryDefId === entry.metricDefinition.id;
                const placement = historyPlacement[entry.metricDefinition.id] ?? "right";
                const sidePos = placement === "right" ? "left-full ml-2" : "right-full mr-2";
                return (
                  <div className="relative group/history mb-1">
                    <div
                      data-history-trigger="1"
                      onMouseEnter={(e) => measureHistoryPlacement(entry.metricDefinition.id, e.currentTarget)}
                      onClick={(e) => {
                        e.stopPropagation();
                        measureHistoryPlacement(entry.metricDefinition.id, e.currentTarget);
                        setPinnedHistoryDefId((cur) => (cur === entry.metricDefinition.id ? null : entry.metricDefinition.id));
                      }}
                      className="text-[10px] text-gray-400 leading-tight cursor-pointer select-none"
                    >
                      Last session: <span className="font-medium text-gray-500 dark:text-gray-300 underline decoration-dotted underline-offset-2">{formatMetricValue(entry.previousValue, entry.metricDefinition.format)}</span>
                    </div>
                    {entry.history.length > 0 && (
                      <div
                        data-history-popover="1"
                        onClick={(e) => e.stopPropagation()}
                        className={`absolute ${sidePos} top-0 z-30 px-3 py-2 min-w-[200px] bg-gray-900 text-white text-xs rounded-lg shadow-xl transition-opacity ${
                          isPinned
                            ? "opacity-100 pointer-events-auto"
                            : "opacity-0 pointer-events-none group-hover/history:opacity-100"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="font-semibold text-[11px] text-gray-200">Last {entry.history.length} session{entry.history.length === 1 ? "" : "s"}</div>
                          {isPinned && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setPinnedHistoryDefId(null); }}
                              aria-label="Close history"
                              className="text-gray-400 hover:text-white text-sm leading-none -mr-1"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <div className="space-y-0.5">
                          {entry.history.map((h) => {
                            const d = new Date(h.sessionDate);
                            const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
                            return (
                              <div key={h.sessionId} className="flex items-baseline justify-between gap-3 whitespace-nowrap">
                                <span className="text-gray-300">{dateStr}</span>
                                <span className="font-medium tabular-nums">{formatMetricValue(h.value, entry.metricDefinition.format)}</span>
                              </div>
                            );
                          })}
                        </div>
                        {/* Arrow back to the trigger. Right-placed
                            popovers get a left-pointing arrow on
                            their left edge (border-r-color); left-
                            placed popovers get a right-pointing
                            arrow on their right edge
                            (border-l-color). */}
                        {placement === "right" ? (
                          <div className="absolute right-full top-3 -mr-px border-4 border-transparent border-r-gray-900" />
                        ) : (
                          <div className="absolute left-full top-3 -ml-px border-4 border-transparent border-l-gray-900" />
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              {canEdit ? (
                focusedMetric === entry.id ? (
                <input
                  type="number"
                  value={metricInputValue}
                  onChange={(e) => setMetricInputValue(e.target.value)}
                  onBlur={() => {
                    const val = parseFloat(metricInputValue) || 0;
                    setMetricEntries((prev) =>
                      prev.map((me) => me.id === entry.id ? { ...me, currentValue: val } : me)
                    );
                    updateMetricValue(entry.id, entry.metricDefinition.id, val);
                    setFocusedMetric(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Tab") {
                      e.preventDefault();
                      // Save current value
                      const val = parseFloat(metricInputValue) || 0;
                      setMetricEntries((prev) =>
                        prev.map((me) => me.id === entry.id ? { ...me, currentValue: val } : me)
                      );
                      updateMetricValue(entry.id, entry.metricDefinition.id, val);
                      // Find next metric in the list
                      const currentIdx = metricEntries.findIndex((me) => me.id === entry.id);
                      const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;
                      if (nextIdx >= 0 && nextIdx < metricEntries.length) {
                        const nextEntry = metricEntries[nextIdx];
                        setMetricInputValue(nextEntry.currentValue ? String(nextEntry.currentValue) : "");
                        setFocusedMetric(nextEntry.id);
                      } else {
                        setFocusedMetric(null);
                      }
                    }
                  }}
                  autoFocus
                  className="w-full text-center text-lg font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
                ) : (
                <button
                  onClick={() => { setMetricInputValue(entry.currentValue ? String(entry.currentValue) : ""); setFocusedMetric(entry.id); }}
                  className="w-full text-center text-lg font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 hover:border-gray-300 dark:hover:border-gray-600 cursor-text"
                >
                  {entry.currentValue != null && entry.currentValue !== 0 ? formatMetricValue(entry.currentValue, entry.metricDefinition.format) : <span className="text-gray-300">{entry.metricDefinition.format === "currency" ? "$0" : "0"}</span>}
                </button>
                )
              ) : (
                <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatMetricValue(entry.currentValue, entry.metricDefinition.format)}</div>
              )}
              {entry.addedSinceLastSession !== 0 && (
                <div className={`text-xs mt-1 font-medium ${entry.addedSinceLastSession > 0 ? "text-green-600" : "text-red-500"}`}>
                  {formatMetricDelta(entry.addedSinceLastSession, entry.metricDefinition.format)} since last
                </div>
              )}
            </div>
            );
          })}
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
                  className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && addMetricDefinition()}
                  autoFocus
                />
                <input
                  type="text"
                  value={newMetricDefinition}
                  onChange={(e) => setNewMetricDefinition(e.target.value)}
                  placeholder="Definition / description (optional)..."
                  className="w-full px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300 focus:ring-2 focus:ring-purple-500"
                  onKeyDown={(e) => e.key === "Enter" && addMetricDefinition()}
                />
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    {METRIC_FORMATS.map((fmt) => (
                      <button
                        key={fmt.value}
                        onClick={() => setNewMetricFormat(fmt.value)}
                        className={`px-2.5 py-1 text-xs font-medium transition-colors ${newMetricFormat === fmt.value ? "bg-purple-100 text-purple-700" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
                        title={fmt.title}
                      >
                        {fmt.title}
                      </button>
                    ))}
                  </div>
                  <button onClick={addMetricDefinition} disabled={!newMetricName.trim()} className="text-sm text-purple-600 font-medium disabled:opacity-50 dark:text-purple-300">Add Metric</button>
                  <button onClick={() => { setAddingMetric(false); setNewMetricName(""); setNewMetricDefinition(""); setNewMetricFormat("number"); }} className="text-sm text-gray-400">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setAddingMetric(true)}
                  className="text-sm text-purple-600 hover:text-purple-700 font-medium dark:text-purple-300"
                >
                  + Add Metric
                </button>
                <button
                  onClick={addSection}
                  className="text-sm text-purple-600 hover:text-purple-700 font-medium dark:text-purple-300"
                  title="Insert a section header — full-width strip that breaks tiles into a new visual group below it"
                >
                  + Add Section
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
          <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Archived Metrics</h4>
              <button onClick={() => setShowArchived(false)} className="text-xs text-gray-400 hover:text-gray-600">Hide</button>
            </div>
            {archivedMetrics.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-2">No archived metrics.</p>
            ) : (
              <div className="space-y-1.5">
                {archivedMetrics.map((m) => (
                  <div key={m.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/40 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">{m.name}</span>
                      {m.definition && <span className="text-xs text-gray-400 ml-2">— {m.definition}</span>}
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => unarchiveMetric(m.id)}
                        className="text-xs text-purple-600 hover:text-purple-700 font-medium dark:text-purple-300"
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
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <span>🎯</span> Goals &amp; Tasks
          </h3>
          <div className="flex items-center gap-3">
            {goals.length > 0 && (() => {
              const visibleIds = goals
                .filter((g) => !(hideCompletedGlobal && (g.status === "done" || g.status === "not_doing" || g.status === "deprioritized")))
                .map((g) => g.id);
              const allCollapsed = visibleIds.length > 0 && visibleIds.every((id) => collapsedGoals.has(id));
              return (
                <button
                  onClick={() => {
                    const next = allCollapsed ? new Set<string>() : new Set(visibleIds);
                    setCollapsedGoals(next);
                    try { localStorage.setItem("coaching:collapsedGoals", JSON.stringify([...next])); } catch {}
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {allCollapsed ? "Show all" : "Collapse all"}
                </button>
              );
            })()}
            {(goals.some((g) => g.status === "done" || g.status === "not_doing" || g.status === "deprioritized") || goals.some((g) => g.tasks.some((t) => t.status === "done" || t.status === "not_doing" || t.status === "deprioritized"))) && (
              <button
                onClick={() => {
                  const next = !hideCompletedGlobal;
                  setHideCompletedGlobal(next);
                  localStorage.setItem("coaching:hideCompleted", String(next));
                  // The master toggle is the master — wipe any per-goal
                  // overrides AND any per-parent subtask-reveals so
                  // every level of the tree honors the new global
                  // setting. Without this, anything the user
                  // previously toggled individually would silently
                  // ignore this click.
                  setHideCompletedPerGoal({});
                  localStorage.setItem("coaching:hideCompletedPerGoal", "{}");
                  setRevealedHiddenSubsParents(new Set());
                }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {hideCompletedGlobal ? "Show all completed tasks" : "Hide all completed tasks"}
              </button>
            )}
            {goals.length > 0 && (
            <button
              onClick={copyAllGoalsAsMarkdown}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              title="Copy all goals & tasks as markdown"
            >
              {copiedId === "all-goals" ? (
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              )}
              {copiedId === "all-goals" ? "Copied!" : "Copy All"}
            </button>
          )}
          </div>
        </div>
        <div className="space-y-4">
          {/* Add goal — at top */}
          {canEdit && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newGoalTitle}
                onChange={(e) => setNewGoalTitle(e.target.value)}
                placeholder="Add a goal..."
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                onKeyDown={(e) => e.key === "Enter" && addGoal()}
              />
              <button
                onClick={addGoal}
                disabled={!newGoalTitle.trim()}
                className="px-4 py-2 text-sm text-purple-600 font-medium hover:bg-purple-50 rounded-lg disabled:opacity-50 dark:text-purple-300"
              >
                + Add Goal
              </button>
            </div>
          )}
          {goals
            .filter((goal) => {
              // Master switch hides goals that are done or not_doing
              // entirely. Per-goal overrides only affect that goal's
              // task list, not the goal itself.
              if (hideCompletedGlobal && (goal.status === "done" || goal.status === "not_doing" || goal.status === "deprioritized")) return false;
              return true;
            })
            .map((goal) => (
            <div
              key={goal.id}
              id={`goal-${goal.id}`}
              draggable={canEdit}
              onDragStart={(e) => { setDragGoal(goal.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { setDragGoal(null); setDragOverGoal(null); }}
              onDragOver={(e) => { if (dragGoal && dragGoal !== goal.id) { e.preventDefault(); setDragOverGoal(goal.id); } if (dragTask) { e.preventDefault(); setDragOverGoal(goal.id); } }}
              onDragLeave={() => setDragOverGoal(null)}
              onDrop={() => { if (dragGoal) handleGoalDrop(goal.id); if (dragTask) handleTaskDropOnGoal(goal.id); }}
              className={`border rounded-lg overflow-hidden scroll-mt-24 transition-all ${dragGoal === goal.id ? "opacity-40" : ""} ${dragOverGoal === goal.id && dragGoal ? "border-purple-400 shadow-md" : dragOverGoal === goal.id && dragTask ? "border-blue-400 shadow-md" : "border-gray-200 dark:border-gray-700"}`}
            >
              {/* Goal header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/40 gap-2 group/goal">
                <button
                  type="button"
                  onClick={() => {
                    setCollapsedGoals((prev) => {
                      const next = new Set(prev);
                      if (next.has(goal.id)) next.delete(goal.id);
                      else next.add(goal.id);
                      try { localStorage.setItem("coaching:collapsedGoals", JSON.stringify([...next])); } catch {}
                      return next;
                    });
                  }}
                  aria-label={collapsedGoals.has(goal.id) ? "Expand goal" : "Collapse goal"}
                  aria-expanded={!collapsedGoals.has(goal.id)}
                  className="flex-shrink-0 p-0.5 text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${collapsedGoals.has(goal.id) ? "" : "rotate-90"}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                {/* Open-task count badge — shown on every goal header
                    (collapsed or expanded) so the user has at-a-glance
                    progress signal without scanning the task list. */}
                {(() => {
                  const openCount = goal.tasks.filter((t) => t.status === "active").length;
                  if (openCount === 0) return null;
                  return (
                    <span
                      className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                      title={`${openCount} open task${openCount === 1 ? "" : "s"}`}
                    >
                      {openCount} open
                    </span>
                  );
                })()}
                {canEdit && (
                  <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 mr-1">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {canEdit ? (
                    <input
                      type="text"
                      value={goal.title}
                      onChange={(e) => updateGoalTitle(goal.id, e.target.value)}
                      className="font-medium text-gray-900 dark:text-gray-100 text-sm bg-transparent border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-purple-500 focus:ring-0 w-full px-0 py-0"
                    />
                  ) : (
                    <span className="font-medium text-gray-900 dark:text-gray-100 text-sm"><Linkify>{goal.title}</Linkify></span>
                  )}
                  {canEdit && editingGoalDescId === goal.id ? (
                    <div className="mt-1" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditingGoalDescId(null); } }}>
                      <RichTextCommentEditor
                        value={goal.description || ""}
                        onChange={(md) => updateGoalDescription(goal.id, md)}
                        onSubmit={() => { flushGoalDescriptionSave(goal.id); setEditingGoalDescId(null); }}
                        onBlur={() => { flushGoalDescriptionSave(goal.id); setEditingGoalDescId(null); }}
                        autoFocus
                        minHeight={48}
                        placeholder="Add description…"
                      />
                      <div className="text-[10px] text-gray-400 mt-1">⌘↵ to save · Esc to cancel · click outside to save</div>
                    </div>
                  ) : goal.description ? (
                    <div
                      onClick={(e) => {
                        if (canEdit && !(e.target instanceof HTMLAnchorElement)) setEditingGoalDescId(goal.id);
                      }}
                      className={`text-xs text-gray-600 dark:text-gray-300 block mt-0.5 prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 ${canEdit ? "cursor-text hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1 -mx-1" : ""}`}
                    >
                      <DescriptionMarkdown>{goal.description}</DescriptionMarkdown>
                    </div>
                  ) : canEdit ? (
                    <button
                      onClick={() => setEditingGoalDescId(goal.id)}
                      className="text-xs text-purple-500 hover:text-purple-700 font-medium mt-0.5"
                    >
                      Add description
                    </button>
                  ) : null}
                  {goal.createdAt && (
                    <span className="text-[10px] text-gray-400 mt-0.5 block">Created {new Date(goal.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                  {goal.status === "done" && goal.statusChangedAt && (
                    <span className="text-[10px] text-green-600 mt-0.5 block dark:text-green-300">Completed {new Date(goal.statusChangedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                </div>
                {canEdit && (
                  <>
                    <div className="relative group/btn flex-shrink-0">
                      <button onClick={() => sendGoalToTop(goal.id)} className="p-1 text-gray-400 hover:text-purple-600 opacity-0 group-hover/goal:opacity-100 transition-opacity">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 11l7-7 7 7M5 19l7-7 7 7" /></svg>
                      </button>
                      <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Send to top</span>
                    </div>
                    <div className="relative group/btn flex-shrink-0">
                      <button onClick={() => moveGoalUp(goal.id)} className="p-1 text-gray-400 hover:text-purple-600 opacity-0 group-hover/goal:opacity-100 transition-opacity">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                      </button>
                      <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Move up</span>
                    </div>
                    <div className="relative group/btn flex-shrink-0">
                      <button onClick={() => moveGoalDown(goal.id)} className="p-1 text-gray-400 hover:text-purple-600 opacity-0 group-hover/goal:opacity-100 transition-opacity">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Move down</span>
                    </div>
                    <div className="relative group/btn flex-shrink-0">
                      <button onClick={() => sendGoalToBottom(goal.id)} className="p-1 text-gray-400 hover:text-purple-600 opacity-0 group-hover/goal:opacity-100 transition-opacity">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l7 7 7-7M5 5l7 7 7-7" /></svg>
                      </button>
                      <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Send to bottom</span>
                    </div>
                  </>
                )}
                <div className="relative group/btn flex-shrink-0">
                  <button
                    onClick={() => copyGoalAsMarkdown(goal)}
                    className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-0 group-hover/goal:opacity-100 transition-opacity"
                  >
                    {copiedId === `goal-${goal.id}` ? (
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    )}
                  </button>
                  <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">
                    {copiedId === `goal-${goal.id}` ? "Copied!" : "Copy goal as markdown"}
                  </span>
                </div>
                <div className="relative group/btn flex-shrink-0">
                  <button
                    onClick={() => copyAnchorLink(`goal-${goal.id}`)}
                    className="p-1 text-gray-500 dark:text-gray-400 hover:text-purple-600 opacity-0 group-hover/goal:opacity-100 transition-opacity"
                  >
                    {copiedId === `anchor-goal-${goal.id}` ? (
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                    )}
                  </button>
                  <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">
                    {copiedId === `anchor-goal-${goal.id}` ? "Copied!" : "Copy link to goal"}
                  </span>
                </div>
                {canEdit ? (
                  <select
                    value={goal.status}
                    onChange={(e) => {
                      if (e.target.value === "__delete__") { deleteGoal(goal.id); e.target.value = goal.status; return; }
                      updateGoalStatus(goal.id, e.target.value);
                    }}
                    className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${getStatusColor(goal.status)}`}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                    <option value="__delete__" className="text-red-600 dark:text-red-300">🗑 Delete Goal</option>
                  </select>
                ) : (
                  <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${getStatusColor(goal.status)}`}>
                    {STATUS_OPTIONS.find((s) => s.value === goal.status)?.label || goal.status}
                  </span>
                )}
              </div>

              {/* Add task — at top so it's always visible */}
              {canEdit && !collapsedGoals.has(goal.id) && (
                <div className="flex items-center gap-2 px-4 py-2 pl-8 border-b border-gray-100 dark:border-gray-800">
                  <input
                    type="text"
                    value={newTaskTitles[goal.id] || ""}
                    onChange={(e) => setNewTaskTitles((prev) => ({ ...prev, [goal.id]: e.target.value }))}
                    placeholder="Add a task..."
                    className="flex-1 px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    onKeyDown={(e) => e.key === "Enter" && addTask(goal.id)}
                  />
                  <button
                    onClick={() => addTask(goal.id)}
                    disabled={!newTaskTitles[goal.id]?.trim()}
                    className="text-xs text-purple-600 font-medium disabled:opacity-50 dark:text-purple-300"
                  >
                    Add
                  </button>
                </div>
              )}

              {/* Tasks */}
              <div className={`divide-y divide-gray-100 ${collapsedGoals.has(goal.id) ? "hidden" : ""}`}>
                {(() => {
                  const hideForGoal = hideCompletedPerGoal[goal.id] ?? hideCompletedGlobal;
                  // Treat done + not_doing as the same "settled, hide
                  // it" bucket — the user thinks of both as "I'm not
                  // working on this anymore."
                  const isSettled = (t: Task) => t.status === "done" || t.status === "not_doing" || t.status === "deprioritized";
                  const completedCount = goal.tasks.filter(isSettled).length;

                  // Group tasks: top-level (no parent) vs. subtasks
                  // keyed by their parent task id. The flat goal.tasks
                  // array stays the source of truth; this just gives
                  // us a tree shape to render.
                  const topLevelTasks = goal.tasks.filter((t) => !t.parentTaskId);
                  const subtasksByParent: Record<string, Task[]> = {};
                  for (const t of goal.tasks) {
                    if (t.parentTaskId) {
                      (subtasksByParent[t.parentTaskId] ||= []).push(t);
                    }
                  }
                  for (const k of Object.keys(subtasksByParent)) {
                    subtasksByParent[k].sort((a, b) => a.order - b.order);
                  }

                  const visibleTopLevel = hideForGoal
                    ? topLevelTasks.filter((t) => !isSettled(t))
                    : topLevelTasks;
                  // Per-parent visible subtasks, settled count, and a
                  // currently-hidden count. The user can override the
                  // filter for a single parent by clicking its
                  // "Show N hidden" affordance — that adds the parent
                  // id to revealedHiddenSubsParents and visible flips
                  // back to "all".
                  const visibleSubsByParent: Record<string, Task[]> = {};
                  const hiddenSubsByParent: Record<string, number> = {};
                  const settledSubsByParent: Record<string, number> = {};
                  for (const parentId of Object.keys(subtasksByParent)) {
                    const all = subtasksByParent[parentId];
                    const settled = all.filter(isSettled).length;
                    settledSubsByParent[parentId] = settled;
                    const showingHidden = revealedHiddenSubsParents.has(parentId);
                    const visible = hideForGoal && !showingHidden ? all.filter((t) => !isSettled(t)) : all;
                    visibleSubsByParent[parentId] = visible;
                    hiddenSubsByParent[parentId] = all.length - visible.length;
                  }
                  const hiddenCount = goal.tasks.length
                    - visibleTopLevel.length
                    - Object.values(visibleSubsByParent).reduce((s, v) => s + v.length, 0);
                  return (<>
                    {completedCount > 0 && (
                      <div className="px-4 py-1.5 flex items-center justify-end">
                        <button
                          onClick={() => setHideCompletedPerGoal((prev) => { const next = { ...prev, [goal.id]: !hideForGoal }; localStorage.setItem("coaching:hideCompletedPerGoal", JSON.stringify(next)); return next; })}
                          className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {hideForGoal ? `Show ${hiddenCount} completed` : "Hide completed"}
                        </button>
                      </div>
                    )}
                    {visibleTopLevel.map((task) => {
                  const descText = editingDescriptions[task.id] ?? task.description ?? "";
                  const visibleSubs = visibleSubsByParent[task.id] || [];
                  const hiddenSubs = hiddenSubsByParent[task.id] || 0;
                  const hasAnySubs = (subtasksByParent[task.id]?.length ?? 0) > 0;
                  const subsCollapsed = collapsedSubtaskParents.has(task.id);
                  return (
                    <Fragment key={task.id}>
                    <div
                      id={`task-${task.id}`}
                      draggable={canEdit}
                      onDragStart={(e) => { e.stopPropagation(); setDragTask({ goalId: goal.id, taskId: task.id }); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragTask(null); setDragOverTask(null); }}
                      onDragOver={(e) => { if (dragTask && dragTask.taskId !== task.id) { e.preventDefault(); e.stopPropagation(); setDragOverTask(task.id); } }}
                      onDragLeave={() => setDragOverTask(null)}
                      onDrop={(e) => { e.stopPropagation(); handleTaskDrop(goal.id, task.id); }}
                      className={`px-4 py-2.5 pl-8 scroll-mt-24 group/task transition-all duration-500 ${animatingTaskId === task.id ? "opacity-40 scale-[0.98] translate-y-2 bg-green-50" : ""} ${dragTask?.taskId === task.id ? "opacity-40" : ""} ${dragOverTask === task.id ? "bg-purple-50 border-t-2 border-purple-400" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          {canEdit && (
                            <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 mt-0.5 mr-0.5">
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/></svg>
                            </div>
                          )}
                          <button
                            onClick={() => canEdit && updateTaskStatus(task.id, task.status === "done" ? "active" : "done")}
                            className="mt-0.5 flex-shrink-0"
                          >
                            {task.status === "done" ? (
                              <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <div className="w-4 h-4 rounded border-2 border-gray-300 dark:border-gray-700" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            {canEdit ? (
                              <textarea
                                value={task.title}
                                onChange={(e) => { updateTaskTitle(task.id, e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                                ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                                rows={1}
                                className={`text-sm bg-transparent border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-purple-500 focus:ring-0 w-full px-0 py-0 resize-none overflow-hidden ${task.status === "done" ? "text-gray-400 line-through" : task.status === "not_doing" ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-200"}`}
                              />
                            ) : (
                              <span className={`text-sm ${task.status === "done" ? "text-gray-400 line-through" : task.status === "not_doing" ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-200"}`}>
                                <Linkify>{task.title}</Linkify>
                              </span>
                            )}
                            {/* Description */}
                            {editingDescTask === task.id ? (
                              <div className="mt-1" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditingDescTask(null); } }}>
                                <RichTextCommentEditor
                                  value={descText}
                                  onChange={(md) => updateTaskDescription(task.id, md)}
                                  onSubmit={() => { flushTaskDescriptionSave(task.id); setEditingDescTask(null); }}
                                  onBlur={() => { flushTaskDescriptionSave(task.id); setEditingDescTask(null); }}
                                  autoFocus
                                  minHeight={56}
                                  placeholder="Add details, links, notes…"
                                />
                                <div className="text-[10px] text-gray-400 mt-1">⌘↵ to save · Esc to cancel · click outside to save</div>
                              </div>
                            ) : descText ? (
                              <div
                                onClick={(e) => {
                                  if (canEdit && !(e.target instanceof HTMLAnchorElement)) setEditingDescTask(task.id);
                                }}
                                className={`text-sm text-gray-500 dark:text-gray-400 mt-0.5 prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 ${canEdit ? "cursor-text hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1 -mx-1" : ""}`}
                              >
                                <DescriptionMarkdown>{descText}</DescriptionMarkdown>
                              </div>
                            ) : canEdit ? (
                              <button
                                onClick={() => setEditingDescTask(task.id)}
                                className="text-xs text-purple-500 hover:text-purple-700 font-medium mt-0.5"
                              >
                                Add description
                              </button>
                            ) : null}
                            {task.createdAt && (
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-gray-400">Created {new Date(task.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                                <div className="relative group/askmikey inline-flex">
                                  <button
                                    onClick={() => askMikeyForTaskContext(task, null)}
                                    disabled={askingMikeyFor === task.id}
                                    aria-label="Ask Mikey for coaching context on this task"
                                    className="text-[11px] leading-none opacity-60 hover:opacity-100 transition-opacity disabled:opacity-100 disabled:cursor-wait"
                                  >
                                    {askingMikeyFor === task.id ? (
                                      <svg className="animate-spin w-3 h-3 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                      </svg>
                                    ) : (
                                      "🌊"
                                    )}
                                  </button>
                                  <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-30 px-2.5 py-1.5 bg-gray-900 text-white text-[11px] rounded-lg shadow-xl whitespace-normal w-56 text-center opacity-0 group-hover/askmikey:opacity-100 transition-opacity">
                                    Ask Mikey to find the coaching discussion that created this task and summarize what was covered.
                                    <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
                                  </span>
                                </div>
                              </div>
                            )}
                            {task.status === "done" && task.statusChangedAt && (
                              <span className="text-[10px] text-green-600 mt-0.5 block dark:text-green-300">Completed {new Date(task.statusChangedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                            )}
                            <TaskComments taskId={task.id} canEdit={canEdit} currentUserId={sessionUserId} />
                          </div>
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-1">
                          {canEdit && (
                            <>
                              <div className="relative group/btn">
                                <button onClick={() => sendTaskToTop(goal.id, task.id)} className="p-0.5 text-gray-400 hover:text-purple-600 opacity-0 group-hover/task:opacity-100 transition-opacity">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 11l7-7 7 7M5 19l7-7 7 7" /></svg>
                                </button>
                                <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Send to top</span>
                              </div>
                              <div className="relative group/btn">
                                <button onClick={() => moveTaskUp(goal.id, task.id)} className="p-0.5 text-gray-400 hover:text-purple-600 opacity-0 group-hover/task:opacity-100 transition-opacity">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                                </button>
                                <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Move up</span>
                              </div>
                              <div className="relative group/btn">
                                <button onClick={() => moveTaskDown(goal.id, task.id)} className="p-0.5 text-gray-400 hover:text-purple-600 opacity-0 group-hover/task:opacity-100 transition-opacity">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                </button>
                                <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Move down</span>
                              </div>
                              <div className="relative group/btn">
                                <button onClick={() => sendTaskToBottom(goal.id, task.id)} className="p-0.5 text-gray-400 hover:text-purple-600 opacity-0 group-hover/task:opacity-100 transition-opacity">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l7 7 7-7M5 5l7 7 7-7" /></svg>
                                </button>
                                <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Send to bottom</span>
                              </div>
                            </>
                          )}
                          <div className="relative group/btn">
                            <button
                              onClick={() => copyTaskAsMarkdown(task)}
                              className="p-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-0 group-hover/task:opacity-100 transition-opacity"
                            >
                              {copiedId === `task-${task.id}` ? (
                                <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              ) : (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                              )}
                            </button>
                            <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">
                              {copiedId === `task-${task.id}` ? "Copied!" : "Copy task as markdown"}
                            </span>
                          </div>
                          <div className="relative group/btn">
                            <button
                              onClick={() => copyAnchorLink(`task-${task.id}`)}
                              className="p-0.5 text-gray-500 dark:text-gray-400 hover:text-purple-600 opacity-0 group-hover/task:opacity-100 transition-opacity"
                            >
                              {copiedId === `anchor-task-${task.id}` ? (
                                <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              ) : (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                              )}
                            </button>
                            <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">
                              {copiedId === `anchor-task-${task.id}` ? "Copied!" : "Copy link to task"}
                            </span>
                          </div>
                          {canEdit ? (
                            <select
                              value={task.status}
                              onChange={(e) => {
                                if (e.target.value === "__delete__") { deleteTask(goal.id, task.id); e.target.value = task.status; return; }
                                updateTaskStatus(task.id, e.target.value);
                              }}
                              className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer ${getStatusColor(task.status)}`}
                            >
                              {STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                              <option value="__delete__" className="text-red-600 dark:text-red-300">🗑 Delete Task</option>
                            </select>
                          ) : (
                            <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${getStatusColor(task.status)}`}>
                              {STATUS_OPTIONS.find((s) => s.value === task.status)?.label || task.status}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {(hasAnySubs || canEdit) && (
                      <div className="ml-12 pr-4 border-l-2 border-gray-100 dark:border-gray-700">
                        {hasAnySubs && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setCollapsedSubtaskParents((prev) => {
                                const next = new Set(prev);
                                if (next.has(task.id)) next.delete(task.id);
                                else next.add(task.id);
                                return next;
                              })}
                              className="px-2 py-1 text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 inline-flex items-center gap-1"
                            >
                              <svg className={`w-2.5 h-2.5 transition-transform ${subsCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              {subtasksByParent[task.id].length} subtask{subtasksByParent[task.id].length === 1 ? "" : "s"}
                            </button>
                            {!subsCollapsed && hideForGoal && (settledSubsByParent[task.id] || 0) > 0 && (
                              <button
                                type="button"
                                onClick={() => setRevealedHiddenSubsParents((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(task.id)) next.delete(task.id);
                                  else next.add(task.id);
                                  return next;
                                })}
                                className="text-[10px] text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 hover:underline"
                              >
                                {revealedHiddenSubsParents.has(task.id)
                                  ? `Hide ${settledSubsByParent[task.id]}`
                                  : `Show ${settledSubsByParent[task.id]} hidden`}
                              </button>
                            )}
                          </div>
                        )}
                        {!subsCollapsed && visibleSubs.map((sub) => {
                          const subDescText = editingDescriptions[sub.id] ?? sub.description ?? "";
                          return (
                            <div
                              key={sub.id}
                              id={`task-${sub.id}`}
                              draggable={canEdit}
                              onDragStart={canEdit ? (e) => { e.stopPropagation(); setDragSubtask({ parentTaskId: task.id, subId: sub.id }); e.dataTransfer.effectAllowed = "move"; } : undefined}
                              onDragEnd={canEdit ? (e) => { e.stopPropagation(); setDragSubtask(null); setDragOverSubtask(null); } : undefined}
                              onDragOver={canEdit ? (e) => { if (dragSubtask && dragSubtask.parentTaskId === task.id && dragSubtask.subId !== sub.id) { e.preventDefault(); e.stopPropagation(); setDragOverSubtask(sub.id); } } : undefined}
                              onDragLeave={canEdit ? () => setDragOverSubtask((cur) => (cur === sub.id ? null : cur)) : undefined}
                              onDrop={canEdit ? (e) => { e.stopPropagation(); handleSubtaskDrop(task.id, sub.id); } : undefined}
                              className={`px-3 py-1.5 scroll-mt-24 group/task transition-all duration-500 ${animatingTaskId === sub.id ? "opacity-40 scale-[0.98] translate-y-2 bg-green-50" : ""} ${dragSubtask?.subId === sub.id ? "opacity-40" : ""} ${dragOverSubtask === sub.id && dragSubtask ? "border-t-2 border-purple-400" : ""}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                  {canEdit && (
                                    <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 mt-1 mr-0.5">
                                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                                        <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                                        <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                                      </svg>
                                    </div>
                                  )}
                                  <button
                                    onClick={() => canEdit && updateTaskStatus(sub.id, sub.status === "done" ? "active" : "done")}
                                    className="mt-0.5 flex-shrink-0"
                                  >
                                    {sub.status === "done" ? (
                                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                    ) : (
                                      <div className="w-3.5 h-3.5 rounded border-2 border-gray-300 dark:border-gray-700" />
                                    )}
                                  </button>
                                  <div className="min-w-0 flex-1">
                                    {canEdit ? (
                                      <textarea
                                        value={sub.title}
                                        onChange={(e) => { updateTaskTitle(sub.id, e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                                        ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                                        rows={1}
                                        className={`text-xs bg-transparent border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-purple-500 focus:ring-0 w-full px-0 py-0 resize-none overflow-hidden ${sub.status === "done" || sub.status === "not_doing" ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-200"}`}
                                      />
                                    ) : (
                                      <span className={`text-xs ${sub.status === "done" || sub.status === "not_doing" ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-200"}`}>
                                        <Linkify>{sub.title}</Linkify>
                                      </span>
                                    )}
                                    {editingDescTask === sub.id ? (
                                      <div className="mt-1" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditingDescTask(null); } }}>
                                        <RichTextCommentEditor
                                          value={subDescText}
                                          onChange={(md) => updateTaskDescription(sub.id, md)}
                                          onSubmit={() => { flushTaskDescriptionSave(sub.id); setEditingDescTask(null); }}
                                          onBlur={() => { flushTaskDescriptionSave(sub.id); setEditingDescTask(null); }}
                                          autoFocus
                                          minHeight={48}
                                          placeholder="Add details, links, notes…"
                                        />
                                        <div className="text-[10px] text-gray-400 mt-1">⌘↵ to save · Esc to cancel · click outside to save</div>
                                      </div>
                                    ) : subDescText ? (
                                      <div
                                        onClick={(e) => { if (canEdit && !(e.target instanceof HTMLAnchorElement)) setEditingDescTask(sub.id); }}
                                        className={`text-xs text-gray-500 dark:text-gray-400 mt-0.5 prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 ${canEdit ? "cursor-text hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1 -mx-1" : ""}`}
                                      >
                                        <DescriptionMarkdown>{subDescText}</DescriptionMarkdown>
                                      </div>
                                    ) : canEdit ? (
                                      <button onClick={() => setEditingDescTask(sub.id)} className="text-[10px] text-purple-500 hover:text-purple-700 font-medium mt-0.5">Add description</button>
                                    ) : null}
                                    {sub.createdAt && (
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[10px] text-gray-400">Created {new Date(sub.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                                        <div className="relative group/askmikey inline-flex">
                                          <button
                                            onClick={() => askMikeyForTaskContext(sub, task)}
                                            disabled={askingMikeyFor === sub.id}
                                            aria-label="Ask Mikey for coaching context on this subtask"
                                            className="text-[11px] leading-none opacity-60 hover:opacity-100 transition-opacity disabled:opacity-100 disabled:cursor-wait"
                                          >
                                            {askingMikeyFor === sub.id ? (
                                              <svg className="animate-spin w-3 h-3 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                              </svg>
                                            ) : (
                                              "🌊"
                                            )}
                                          </button>
                                          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-30 px-2.5 py-1.5 bg-gray-900 text-white text-[11px] rounded-lg shadow-xl whitespace-normal w-56 text-center opacity-0 group-hover/askmikey:opacity-100 transition-opacity">
                                            Ask Mikey to find the coaching discussion that created this subtask (and its parent) and summarize what was covered.
                                            <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
                                          </span>
                                        </div>
                                      </div>
                                    )}
                                    {sub.status === "done" && sub.statusChangedAt && (
                                      <span className="text-[10px] text-green-600 mt-0.5 block dark:text-green-300">Completed {new Date(sub.statusChangedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                                    )}
                                    <TaskComments taskId={sub.id} canEdit={canEdit} currentUserId={sessionUserId} />
                                  </div>
                                </div>
                                <div className="flex-shrink-0 flex items-center gap-1">
                                  {canEdit && (
                                    <>
                                      <div className="relative group/btn">
                                        <button onClick={() => sendSubtaskToTop(task.id, sub.id)} className="p-0.5 text-gray-400 hover:text-purple-600 opacity-0 group-hover/task:opacity-100 transition-opacity">
                                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 11l7-7 7 7M5 19l7-7 7 7" /></svg>
                                        </button>
                                        <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Send to top</span>
                                      </div>
                                      <div className="relative group/btn">
                                        <button onClick={() => moveSubtaskUp(task.id, sub.id)} className="p-0.5 text-gray-400 hover:text-purple-600 opacity-0 group-hover/task:opacity-100 transition-opacity">
                                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                                        </button>
                                        <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Move up</span>
                                      </div>
                                      <div className="relative group/btn">
                                        <button onClick={() => moveSubtaskDown(task.id, sub.id)} className="p-0.5 text-gray-400 hover:text-purple-600 opacity-0 group-hover/task:opacity-100 transition-opacity">
                                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                        </button>
                                        <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Move down</span>
                                      </div>
                                      <div className="relative group/btn">
                                        <button onClick={() => sendSubtaskToBottom(task.id, sub.id)} className="p-0.5 text-gray-400 hover:text-purple-600 opacity-0 group-hover/task:opacity-100 transition-opacity">
                                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l7 7 7-7M5 5l7 7 7-7" /></svg>
                                        </button>
                                        <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">Send to bottom</span>
                                      </div>
                                    </>
                                  )}
                                  <div className="relative group/btn">
                                    <button
                                      onClick={() => copyTaskAsMarkdown(sub)}
                                      className="p-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-0 group-hover/task:opacity-100 transition-opacity"
                                    >
                                      {copiedId === `task-${sub.id}` ? (
                                        <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                      ) : (
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                      )}
                                    </button>
                                    <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">
                                      {copiedId === `task-${sub.id}` ? "Copied!" : "Copy subtask as markdown"}
                                    </span>
                                  </div>
                                  <div className="relative group/btn">
                                    <button
                                      onClick={() => copyAnchorLink(`task-${sub.id}`)}
                                      className="p-0.5 text-gray-500 dark:text-gray-400 hover:text-purple-600 opacity-0 group-hover/task:opacity-100 transition-opacity"
                                    >
                                      {copiedId === `anchor-task-${sub.id}` ? (
                                        <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                      ) : (
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                      )}
                                    </button>
                                    <span role="tooltip" className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover/btn:opacity-100 transition-opacity duration-75">
                                      {copiedId === `anchor-task-${sub.id}` ? "Copied!" : "Copy link to subtask"}
                                    </span>
                                  </div>
                                  {canEdit ? (
                                    <select
                                      value={sub.status}
                                      onChange={(e) => {
                                        if (e.target.value === "__delete__") { deleteTask(goal.id, sub.id); e.target.value = sub.status; return; }
                                        updateTaskStatus(sub.id, e.target.value);
                                      }}
                                      className={`text-[10px] font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer ${getStatusColor(sub.status)}`}
                                    >
                                      {STATUS_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                      <option value="__delete__" className="text-red-600 dark:text-red-300">🗑 Delete subtask</option>
                                    </select>
                                  ) : (
                                    <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${getStatusColor(sub.status)}`}>
                                      {STATUS_OPTIONS.find((s) => s.value === sub.status)?.label || sub.status}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {!subsCollapsed && canEdit && (
                          <div className="px-3 py-1.5 flex items-center gap-2">
                            <input
                              type="text"
                              value={newSubtaskTitles[task.id] || ""}
                              onChange={(e) => setNewSubtaskTitles((prev) => ({ ...prev, [task.id]: e.target.value }))}
                              placeholder="Add subtask…"
                              className="flex-1 text-xs px-2 py-1 bg-transparent border-0 border-b border-gray-200 dark:border-gray-700 focus:border-purple-500 focus:ring-0 placeholder-gray-400 dark:placeholder-gray-500"
                              onKeyDown={(e) => e.key === "Enter" && addSubtask(goal.id, task.id)}
                            />
                            <button
                              onClick={() => addSubtask(goal.id, task.id)}
                              disabled={!newSubtaskTitles[task.id]?.trim()}
                              className="text-[10px] text-purple-500 hover:text-purple-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Add
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    </Fragment>
                  );
                })}
                  </>);
                })()}

              </div>
            </div>
          ))}

          {goals.length === 0 && !canEdit && (
            <p className="text-sm text-gray-400 text-center py-4">No goals set for this session.</p>
          )}
        </div>
      </div>
    </div>
  );
}
