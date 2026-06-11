"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SalesNavBar from "@/components/SalesNavBar";
import MeetingRecorderPanel from "@/components/MeetingRecorderPanel";
import { VoiceNoteButton } from "@/components/VoiceNoteButton";
import DealChatPanel from "@/components/DealChatPanel";
import BulkImportCallsModal from "@/components/BulkImportCallsModal";
import { DEAL_STATUSES, PARTICIPANT_ROLES, ENTRY_TYPES, CLOSED_LOST_REASONS, getStatusInfo, getRoleInfo, getEntryTypeInfo, getHealthInfo } from "@/lib/deals/constants";
import { mergePipeline, resolveStage, type CustomStage } from "@/lib/deals/stages";
import { decodeHtmlEntities } from "@/lib/html-entities";

interface Participant {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  linkedinUrl: string | null;
  role: string;
  notes: string | null;
  pdlData: string | null;
  pdlEnrichedAt: string | null;
  createdAt: string;
}

interface TimelineEntry {
  id: string;
  type: string;
  title: string | null;
  content: string;
  sourceUrl: string | null;
  metadata: string | null;
  entryDate: string;
  createdAt: string;
}

interface AnalysisHistoryItem {
  id: string;
  analysis: string;
  stage: string | null;
  entryCount: number;
  participantCount: number;
  createdAt: string;
}

interface Deal {
  id: string;
  name: string;
  companyName: string;
  companyUrl: string | null;
  stage: string;
  status: string;
  notes: string | null;
  lastAnalysis: string | null;
  lastAnalyzedAt: string | null;
  projectedCloseDate: string | null;
  dealValue: number | null;
  mikeyHealth: string | null;
  closeDate: string | null;
  closedLostReason: string | null;
  participants: Participant[];
  entries: TimelineEntry[];
  project: { id: string; name: string } | null;
}

function splitCallContent(entry: { type: string; content: string }): { summary: string; transcript: string } {
  const content = entry.content || "";
  // Content is assembled as:
  //   Call Date: ...
  //   Attendees: ...
  //
  //   ## Summary
  //   ...
  //
  //   ## Transcript
  //   ...
  const transcriptIdx = content.search(/^\s*##\s+Transcript\s*$/im);
  const summaryIdx = content.search(/^\s*##\s+Summary\s*$/im);

  let summary = "";
  let transcript = "";

  if (summaryIdx !== -1) {
    const afterSummary = content.slice(summaryIdx).replace(/^\s*##\s+Summary\s*\n/i, "");
    summary = transcriptIdx > summaryIdx
      ? afterSummary.slice(0, afterSummary.search(/^\s*##\s+Transcript\s*$/im)).trim()
      : afterSummary.trim();
  }
  if (transcriptIdx !== -1) {
    transcript = content
      .slice(transcriptIdx)
      .replace(/^\s*##\s+Transcript\s*\n/i, "")
      .trim();
  }

  // Fallbacks when the content doesn't carry the section headers (older
  // entries, or call_summary entries that are just plain summary text).
  if (!summary && !transcript) {
    if (entry.type === "call_summary") summary = content.trim();
    else transcript = content.trim();
  }
  return { summary, transcript };
}

// Pulls the body of the "## Deal Summary" section out of an analysis
// markdown blob. Returns null if the section can't be found — caller should
// fall back to rendering the full markdown.
function extractDealSummary(markdown: string): string | null {
  const match = markdown.match(/^##\s+Deal Summary\s*\n([\s\S]*?)(?=\n##\s+|$)/m);
  return match ? match[1].trim() : null;
}

function formatEntryDate(dateStr: string): string {
  const d = new Date(dateStr);
  const dateOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  // Entries whose time component is exactly midnight UTC almost always came
  // from the <input type="date"> picker (which stores date-only) — rendering
  // "12:00 AM" on those is noisy and often misleading due to timezone shift,
  // so skip the time portion for them.
  const isDateOnlyUtc =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  if (isDateOnlyUtc) {
    return d.toLocaleDateString("en-US", dateOpts);
  }
  return d.toLocaleString("en-US", { ...dateOpts, hour: "numeric", minute: "2-digit" });
}

// Normalize a LinkedIn URL pulled from PDL or user input. Many sources
// drop the protocol ("linkedin.com/in/foo") which, rendered straight
// into <a href>, gets treated as a relative path and lands on the
// current pathname (e.g. /deals/<id>/linkedin.com/...) instead of
// LinkedIn. Always force https.
function normalizeLinkedInUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function nameFromEmail(email: string): string | null {
  const local = email.split("@")[0];
  if (!local) return null;
  // Match patterns like "first.last", "first_last", "first-last"
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => /^[a-z]+$/i.test(p))) {
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
  }
  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function extractText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = (node as any)?.props;
  if (props?.children) return extractText(props.children);
  return "";
}

function CopyLinkButton({ id, label }: { id: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <a
      href={`#${id}`}
      onClick={onClick}
      title={`Copy link to ${label}`}
      aria-label={`Copy link to ${label}`}
      className="inline-flex items-center gap-1 text-gray-400 hover:text-purple-600 no-underline"
    >
      {copied ? (
        <span className="text-xs font-medium text-purple-600">Copied!</span>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      )}
    </a>
  );
}

function CopyMarkdownButton({ getMarkdown, label }: { getMarkdown: () => string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Prevent the click from bubbling into the analysis-card header toggle
    // or any other click-to-expand wrapper the button is nested inside.
    e.stopPropagation();
    const text = getMarkdown();
    if (!text) return;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      className="inline-flex items-center gap-1 text-gray-400 hover:text-purple-600"
    >
      {copied ? (
        <span className="text-xs font-medium text-purple-600">Copied!</span>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

// Slice a single section ("## Heading" through the next ##/### heading) out of
// the full analysis markdown. Used by the per-section Copy buttons so each
// one copies only its own section, not the whole analysis.
function extractAnalysisSection(markdown: string, headingText: string): string {
  if (!markdown || !headingText) return "";
  const lines = markdown.split("\n");
  const target = headingText.trim().toLowerCase();
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{2,3}\s+(.*?)\s*$/);
    if (m && m[1].trim().toLowerCase() === target) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return "";
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^#{1,3}\s+/.test(lines[i])) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx).join("\n").trim();
}

function buildHeading(level: 2 | 3, fullMarkdown: string) {
  const Tag = level === 2 ? "h2" : "h3";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function HeadingWithAnchor({ children }: { children?: any }) {
    const text = extractText(children).trim();
    const id = `analysis-${slugify(text || "section")}`;
    return (
      <Tag id={id} className="scroll-mt-20 not-prose flex items-baseline gap-2 mt-6 mb-2 first:mt-0">
        <span className={level === 2 ? "text-lg font-bold text-gray-900 dark:text-gray-100" : "text-base font-semibold text-gray-900 dark:text-gray-100"}>
          {children}
        </span>
        <CopyLinkButton id={id} label={text || "this section"} />
        <CopyMarkdownButton
          getMarkdown={() => extractAnalysisSection(fullMarkdown, text)}
          label={`${text || "section"} markdown`}
        />
      </Tag>
    );
  };
}

function buildAnalysisMarkdownComponents(fullMarkdown: string) {
  return {
    h1: buildHeading(2, fullMarkdown),
    h2: buildHeading(2, fullMarkdown),
    h3: buildHeading(3, fullMarkdown),
  };
}

// Renders a timeline-entry body as markdown so call summaries,
// meetings, emails, notes — anything the user or an importer wrote
// with **bold**, [links](url), bullets, or ## headings — comes out
// styled instead of as raw markup. Links open in a new tab so a
// fathom.video timestamp click doesn't kill the deal view.
function EntryMarkdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-2 prose-h1:text-base prose-h2:text-sm prose-h3:text-xs prose-pre:my-1 prose-code:text-xs">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-800 dark:text-purple-300 underline break-words">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function displayName(name: string, email?: string | null): string {
  if (!name.includes("@")) return titleCase(name);
  // Name IS an email — try to extract a real name from the pattern
  const extracted = nameFromEmail(name);
  if (extracted) return extracted;
  // If we have a separate email field with a parseable pattern, try that
  if (email) {
    const fromEmail = nameFromEmail(email);
    if (fromEmail) return fromEmail;
  }
  return name;
}

function titleCase(str: string): string {
  return str.replace(/\b\w+/g, (word) => {
    const lower = word.toLowerCase();
    if (["and", "or", "the", "of", "in", "at", "to", "for", "a", "an"].includes(lower) && word !== str.split(/\s+/)[0]) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [customStages, setCustomStages] = useState<CustomStage[]>([]);
  const [customLostReasons, setCustomLostReasons] = useState<Array<{ id: string; value: string; label: string; order: number }>>([]);
  const [showAddReason, setShowAddReason] = useState(false);
  const [newReasonLabel, setNewReasonLabel] = useState("");
  const [savingReason, setSavingReason] = useState(false);
  const [refreshingUpcoming, setRefreshingUpcoming] = useState(false);
  const [allDeals, setAllDeals] = useState<Array<{ id: string; name: string; companyName: string; stage?: string }>>([]);
  const [dealSearchQuery, setDealSearchQuery] = useState("");
  const [dealSearchOpen, setDealSearchOpen] = useState(false);
  // Index of the currently-highlighted match in the dropdown — driven
  // by ArrowDown / ArrowUp, sync'd to hover so mouse + keyboard agree.
  const [dealSearchHighlight, setDealSearchHighlight] = useState(0);
  const dealSearchRef = useRef<HTMLDivElement>(null);
  const [newEntryType, setNewEntryType] = useState<string>("note");
  // Raw whisper transcript that produced the current synthesized note
  // body. Persisted onto the entry's metadata at submit time so the
  // timeline can show it behind a "Show transcript" reveal.
  const [pendingVoiceTranscript, setPendingVoiceTranscript] = useState<string | null>(null);
  const [newEntryContent, setNewEntryContent] = useState("");
  const [newEntryTitle, setNewEntryTitle] = useState("");
  const [newEntryUrl, setNewEntryUrl] = useState("");
  const [newEntryDate, setNewEntryDate] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantTitle, setNewParticipantTitle] = useState("");
  const [newParticipantEmail, setNewParticipantEmail] = useState("");
  const [newParticipantRole, setNewParticipantRole] = useState("unknown");
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaName, setMetaName] = useState("");
  const [metaCompanyName, setMetaCompanyName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [enrichingPid, setEnrichingPid] = useState<string | null>(null);
  const [processingScreenshot, setProcessingScreenshot] = useState(false);
  const [entryFromScreenshot, setEntryFromScreenshot] = useState(false);
  const [processingPdf, setProcessingPdf] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [screenshotMatched, setScreenshotMatched] = useState<{ id: string; name: string }[]>([]);
  const [screenshotSuggestions, setScreenshotSuggestions] = useState<{ name: string; email?: string; reason?: string }[]>([]);
  const [acceptedSuggestionNames, setAcceptedSuggestionNames] = useState<Set<string>>(new Set());
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const analysisCardRef = useRef<HTMLDivElement | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [editingTitlePid, setEditingTitlePid] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [editingDateEntryId, setEditingDateEntryId] = useState<string | null>(null);
  // Full-entry inline edit state — when this matches an entry id, the
  // card renders an edit form (type / title / content / sourceUrl)
  // instead of the read-only header + body.
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editEntryDraft, setEditEntryDraft] = useState<{ type: string; title: string; content: string; sourceUrl: string }>({ type: "", title: "", content: "", sourceUrl: "" });
  const [savingEntryEdit, setSavingEntryEdit] = useState(false);
  const [editDateValue, setEditDateValue] = useState("");
  const [enrichingAll, setEnrichingAll] = useState(false);
  const autoEnrichAttempted = useRef(false);
  const autoAnalyzeAttempted = useRef(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [panelConversationId, setPanelConversationId] = useState<string | null>(null);
  const [focusedEntryId, setFocusedEntryId] = useState<string | null>(null);
  const [autoSendQuestion, setAutoSendQuestion] = useState<string | undefined>(undefined);
  const [autoSendNonce, setAutoSendNonce] = useState(0);
  const [askMikeyPrompt, setAskMikeyPrompt] = useState("");
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [revealedTranscripts, setRevealedTranscripts] = useState<Set<string>>(new Set());
  const [timelineTypeFilter, setTimelineTypeFilter] = useState<Set<string>>(new Set());
  const [timelineQuery, setTimelineQuery] = useState<string>("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  // Sticky compact-header state. Tracks whether the main header card
  // has scrolled out of view so we can fade in a fixed-position
  // condensed header with the same key controls.
  const headerSentinelRef = useRef<HTMLDivElement | null>(null);
  const [floatingHeaderShown, setFloatingHeaderShown] = useState(false);
  useEffect(() => {
    const el = headerSentinelRef.current;
    if (!el || typeof window === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setFloatingHeaderShown(!entry.isIntersecting),
      { rootMargin: "-10px 0px 0px 0px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [scanningFutureMeetings, setScanningFutureMeetings] = useState(false);
  const [futureMeetingsResult, setFutureMeetingsResult] = useState<{ added: number; skipped: number; hasCalendar: boolean; hasDomain: boolean; triggeredAnalysis?: boolean } | null>(null);

  const loadDeal = useCallback(async () => {
    setLoading(true);
    try {
      const authRes = await fetch("/api/auth/me");
      const authData = await authRes.json();
      if (!authData.user) {
        router.push("/?error=not_logged_in");
        return;
      }
      const res = await fetch(`/api/deals/${id}`);
      if (res.ok) {
        const data = await res.json();
        setDeal(data.deal);
      }
    } catch (error) {
      console.error("Failed to load deal:", error);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    document.title = "Deal - Mikey";
    loadDeal();
    // Fetch the account's custom stages once so the stage selector
    // below offers the full pipeline (built-ins + customs).
    fetch("/api/deals/stages")
      .then((r) => (r.ok ? r.json() : { stages: [] }))
      .then((d) => setCustomStages(d.stages || []))
      .catch(() => { /* ignore */ });
    // Same idea for account-level custom closed-lost reasons.
    fetch("/api/deals/closed-lost-reasons")
      .then((r) => (r.ok ? r.json() : { reasons: [] }))
      .then((d) => setCustomLostReasons(d.reasons || []))
      .catch(() => { /* ignore */ });
  }, [loadDeal]);

  const addCustomLostReason = async () => {
    const label = newReasonLabel.trim();
    if (!label || savingReason) return;
    setSavingReason(true);
    try {
      const res = await fetch("/api/deals/closed-lost-reasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (res.ok) {
        const { reason } = await res.json();
        setCustomLostReasons((prev) => [...prev, reason]);
        setNewReasonLabel("");
        setShowAddReason(false);
        // Auto-pick the new value on the current deal so the user
        // doesn't have to take a second action.
        updateDeal({ closedLostReason: reason.value });
      }
    } finally {
      setSavingReason(false);
    }
  };

  const scanFutureMeetings = async () => {
    if (scanningFutureMeetings) return;
    setScanningFutureMeetings(true);
    setFutureMeetingsResult(null);
    try {
      const res = await fetch(`/api/deals/${id}/scan-future-meetings`, { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        setFutureMeetingsResult(json);
        if (json.added > 0) await loadDeal();
        // If the server kicked off a background re-analysis, refresh
        // the deal a couple of times over the next ~45s so the new
        // Mikey Health + analysis text show up without the user
        // needing to reload. Then dismiss the toast.
        if (json.triggeredAnalysis) {
          window.setTimeout(() => { void loadDeal(); }, 15000);
          window.setTimeout(() => { void loadDeal(); }, 45000);
          window.setTimeout(() => setFutureMeetingsResult(null), 60000);
        } else {
          window.setTimeout(() => setFutureMeetingsResult(null), 6000);
        }
      }
    } catch (err) {
      console.error("[deals] scan-future-meetings failed:", err);
    } finally {
      setScanningFutureMeetings(false);
    }
  };

  const refreshUpcomingMeetings = async () => {
    if (refreshingUpcoming) return;
    setRefreshingUpcoming(true);
    try {
      // Hits the same comprehensive enrichment endpoint — pulls a
      // fresh 30d back + 90d forward calendar window and dedupes.
      const res = await fetch(`/api/deals/${id}/enrich`, { method: "POST" });
      if (res.ok) await loadDeal();
    } catch (err) {
      console.error("[deals] upcoming refresh failed:", err);
    } finally {
      setRefreshingUpcoming(false);
    }
  };

  const archiveCustomLostReason = async (id: string, value: string) => {
    setCustomLostReasons((prev) => prev.filter((r) => r.id !== id));
    // If the current deal was using the archived value, clear it so
    // the picker doesn't keep showing a stale label.
    if (deal?.closedLostReason === value) {
      updateDeal({ closedLostReason: null });
    }
    try {
      await fetch(`/api/deals/closed-lost-reasons/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error("[deals] archive reason failed:", err);
    }
  };

  // Load the user's deal list for the top-of-page switcher. One fetch on
  // mount — small payload (summary fields only), used for typeahead jumping
  // between deals without going back to /deals.
  useEffect(() => {
    fetch("/api/deals")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.deals) setAllDeals(data.deals);
      })
      .catch(() => {});
  }, []);

  // Close the deal-search dropdown on outside clicks.
  useEffect(() => {
    if (!dealSearchOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dealSearchRef.current && !dealSearchRef.current.contains(e.target as Node)) {
        setDealSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [dealSearchOpen]);

  useEffect(() => {
    if (deal?.name) document.title = `${deal.name} - Mikey`;
  }, [deal?.name]);

  // Auto-enrich participants missing titles on first load
  useEffect(() => {
    if (!deal || autoEnrichAttempted.current) return;
    const hasUnenriched = deal.participants.some((p) => p.email && !p.title);
    if (hasUnenriched) {
      autoEnrichAttempted.current = true;
      fetch(`/api/deals/${id}/participants/enrich-all`, { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
          if (data.enriched > 0) loadDeal();
        })
        .catch(() => {});
    }
  }, [deal, id, loadDeal]);

  // Auto-analyze on first load when the deal has entries but no prior analysis.
  // This covers the "new deal from call" flow where the user lands here with a
  // timeline already populated but analysis hasn't run yet.
  useEffect(() => {
    if (!deal || autoAnalyzeAttempted.current) return;
    if (deal.entries.length > 0 && !deal.lastAnalyzedAt) {
      autoAnalyzeAttempted.current = true;
      // Not silent — opens the analysis panel with the result so a
      // fresh deal lands with the verdict visible. Without this,
      // the only indicator that analysis ran was the header button
      // spinner, which is easy to miss on a busy detail page.
      analyzeDeal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal]);

  // If the URL has a deep-link hash (#analysis-* or #entry-*), scroll to the
  // target once the deal is rendered. Analysis hashes also expand the
  // analysis card so the target is visible.
  useEffect(() => {
    if (!deal) return;
    const hash = window.location.hash;
    if (!hash) return;
    const isAnalysis = hash.startsWith("#analysis-");
    const isEntry = hash.startsWith("#entry-");
    if (!isAnalysis && !isEntry) return;
    if (isAnalysis) {
      if (!deal.lastAnalysis) return;
      setShowAnalysis(true);
    }
    requestAnimationFrame(() => {
      const el = document.getElementById(hash.slice(1));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [deal]);

  const updateDeal = async (updates: Partial<Deal>) => {
    const res = await fetch(`/api/deals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const data = await res.json();
      setDeal((prev) => prev ? { ...prev, ...data.deal } : prev);
    }
  };

  const deleteDeal = async () => {
    if (!confirm("Delete this deal? All entries and participants will be deleted. This cannot be undone.")) return;
    await fetch(`/api/deals/${id}`, { method: "DELETE" });
    router.push("/deals");
  };

  // Mutate the entry's metadata.linkedParticipantIds[] and persist.
  // Optimistic local update so the chip appears immediately.
  const patchEntryLinkedParticipants = async (
    entry: TimelineEntry,
    nextIds: string[]
  ) => {
    let parsed: Record<string, unknown> = {};
    if (entry.metadata) {
      try {
        parsed = JSON.parse(entry.metadata) as Record<string, unknown>;
      } catch { /* keep empty */ }
    }
    const nextMetadata = { ...parsed, linkedParticipantIds: nextIds };
    const nextMetadataStr = JSON.stringify(nextMetadata);
    setDeal((prev) =>
      prev
        ? {
            ...prev,
            entries: prev.entries.map((e) => (e.id === entry.id ? { ...e, metadata: nextMetadataStr } : e)),
          }
        : prev
    );
    try {
      await fetch(`/api/deals/${id}/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: nextMetadata }),
      });
    } catch (err) {
      console.error("[deal] entry participant patch failed:", err);
      loadDeal(); // fall back to refetch on failure
    }
  };

  const linkEntryParticipant = (entry: TimelineEntry, pid: string) => {
    let current: string[] = [];
    if (entry.metadata) {
      try {
        const parsed = JSON.parse(entry.metadata);
        if (Array.isArray(parsed?.linkedParticipantIds)) {
          current = parsed.linkedParticipantIds.filter((x: unknown): x is string => typeof x === "string");
        }
      } catch { /* ignore */ }
    }
    if (current.includes(pid)) return;
    return patchEntryLinkedParticipants(entry, [...current, pid]);
  };

  const unlinkEntryParticipant = (entry: TimelineEntry, pid: string) => {
    let current: string[] = [];
    if (entry.metadata) {
      try {
        const parsed = JSON.parse(entry.metadata);
        if (Array.isArray(parsed?.linkedParticipantIds)) {
          current = parsed.linkedParticipantIds.filter((x: unknown): x is string => typeof x === "string");
        }
      } catch { /* ignore */ }
    }
    return patchEntryLinkedParticipants(entry, current.filter((x) => x !== pid));
  };

  const addEntry = async (entryData?: Partial<TimelineEntry>) => {
    const content = entryData?.content ?? newEntryContent;
    const type = entryData?.type ?? newEntryType;
    const title = entryData?.title ?? newEntryTitle;
    const sourceUrl = entryData?.sourceUrl ?? newEntryUrl;
    const entryDate = entryData?.entryDate ?? (newEntryDate ? new Date(newEntryDate).toISOString() : undefined);

    if (!content?.trim()) return;
    setAddingEntry(true);
    try {
      // If this entry came from a screenshot with accepted new people, create
      // them first so we can include their IDs in the entry metadata.
      const createdIds: string[] = [];
      if (!entryData && acceptedSuggestionNames.size > 0) {
        const toCreate = screenshotSuggestions.filter((s) => acceptedSuggestionNames.has(s.name));
        for (const person of toCreate) {
          try {
            const pRes = await fetch(`/api/deals/${id}/participants`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: person.name,
                email: person.email || undefined,
                role: "unknown",
              }),
            });
            if (pRes.ok) {
              const data = await pRes.json();
              if (data?.participant?.id) createdIds.push(data.participant.id);
            }
          } catch (err) {
            console.error("Failed to add suggested participant:", err);
          }
        }
      }

      // Assemble metadata — link matched + newly-created participant IDs so
      // downstream analysis knows who this entry references. Voice-note
      // raw transcripts ride along here too so the timeline can offer a
      // "Show transcript" reveal under the synthesized body.
      const linkedIds = !entryData
        ? [...screenshotMatched.map((p) => p.id), ...createdIds]
        : [];
      const metadataParts: Record<string, unknown> = {};
      if (linkedIds.length > 0) metadataParts.linkedParticipantIds = linkedIds;
      if (pendingVoiceTranscript) metadataParts.rawVoiceTranscript = pendingVoiceTranscript;
      const metadata = Object.keys(metadataParts).length > 0 ? metadataParts : undefined;

      const res = await fetch(`/api/deals/${id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title: title || undefined,
          content,
          sourceUrl: sourceUrl || undefined,
          entryDate: entryDate || undefined,
          metadata,
        }),
      });
      if (res.ok) {
        // Grab the created entry's id so Ask Mikey can focus the chat on it.
        const createdEntryId: string | null = await res
          .clone()
          .json()
          .then((d) => d?.entry?.id ?? null)
          .catch(() => null);

        // Snapshot Ask Mikey fields before clearing form state.
        const mikeyQuestion = !entryData ? askMikeyPrompt.trim() : "";

        setNewEntryContent("");
        setNewEntryTitle("");
        setNewEntryUrl("");
        setNewEntryDate("");
        setNewEntryType("note");
        setEntryFromScreenshot(false);
        setScreenshotMatched([]);
        setScreenshotSuggestions([]);
        setAcceptedSuggestionNames(new Set());
        setAskMikeyPrompt("");
        setPendingVoiceTranscript(null);
        await loadDeal();

        // If the user typed an Ask Mikey prompt alongside the entry, open
        // the inline Deal Chat panel focused on the just-created entry and
        // auto-send the prompt as the first message. Starts a fresh
        // conversation so the focus applies cleanly.
        if (mikeyQuestion && createdEntryId) {
          setFocusedEntryId(createdEntryId);
          setPanelConversationId(null);
          syncChatUrl(null);
          setChatPanelOpen(true);
          setAutoSendQuestion(mikeyQuestion);
          setAutoSendNonce((n) => n + 1);
        }

        // Re-run analysis now that the timeline has new data. Show the
        // analysis card with its spinner, and scroll to it when the run
        // completes so the user lands on the fresh result.
        // Skip if already analyzing; the running pass will include fresh data anyway.
        // Skip for "chat" entries — Deal Chat breadcrumbs are pointers back
        // to a conversation, not new context about the deal, so there's
        // nothing for the analyzer to re-read.
        if (!analyzing && type !== "chat") analyzeDeal({ scrollToResult: true });
      } else {
        // Surface server errors instead of silently swallowing them.
        const errText = await res.text().catch(() => "");
        let message = `Failed to save entry (HTTP ${res.status})`;
        try {
          const parsed = errText ? JSON.parse(errText) : null;
          if (parsed?.error) message = parsed.error;
        } catch {
          if (errText) message = errText;
        }
        console.error("Failed to save entry:", res.status, errText);
        alert(message);
      }
    } catch (error) {
      console.error("Failed to add entry:", error);
      alert(error instanceof Error ? `Failed to save entry: ${error.message}` : "Failed to save entry");
    }
    setAddingEntry(false);
  };

  const deleteEntry = async (entryId: string) => {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/deals/${id}/entries/${entryId}`, { method: "DELETE" });
    await loadDeal();
  };

  const addParticipant = async () => {
    if (!newParticipantName.trim()) return;
    await fetch(`/api/deals/${id}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newParticipantName.trim(),
        title: newParticipantTitle.trim() || undefined,
        email: newParticipantEmail.trim() || undefined,
        role: newParticipantRole,
      }),
    });
    setShowAddParticipant(false);
    setNewParticipantName("");
    setNewParticipantTitle("");
    setNewParticipantEmail("");
    setNewParticipantRole("unknown");
    await loadDeal();
  };

  const deleteParticipant = async (pid: string) => {
    if (!confirm("Remove this participant?")) return;
    await fetch(`/api/deals/${id}/participants/${pid}`, { method: "DELETE" });
    await loadDeal();
  };

  const updateParticipantRole = async (pid: string, role: string) => {
    await fetch(`/api/deals/${id}/participants/${pid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await loadDeal();
  };

  const enrichAllParticipants = async () => {
    setEnrichingAll(true);
    try {
      await fetch(`/api/deals/${id}/participants/enrich-all`, { method: "POST" });
      await loadDeal();
    } catch { /* ignore */ }
    setEnrichingAll(false);
  };

  const buildDealChatContext = (opts?: {
    extraEntry?: { type: string; title?: string | null; content: string; entryDate?: string | null };
    question?: string;
    focusedEntry?: TimelineEntry;
  }): string => {
    if (!deal) return "";
    const sections: string[] = [];
    const trimmedQuestion = opts?.question?.trim() || "";
    const focused = opts?.focusedEntry;

    sections.push(`I want to discuss the "${deal.name}" deal with ${deal.companyName}.`);
    sections.push("");
    if (trimmedQuestion) {
      sections.push(`My specific prompt is: "${trimmedQuestion}"`);
      sections.push("");
    }

    if (focused) {
      const typeInfo = getEntryTypeInfo(focused.type);
      const when = formatEntryDate(focused.entryDate);
      sections.push(`## The ${typeInfo.label.toLowerCase()} I want to focus on`);
      sections.push(`### ${when} — ${typeInfo.label}${focused.title ? `: ${focused.title}` : ""}`);
      // No truncation — Deal Chat runs in DIRECT mode and gpt-5.5 has
      // a 1M-token context. The chat stream route's MAX_INPUT_CHARS
      // safety net at 3.2M handles the rare edge cases where a deal
      // genuinely exceeds the window.
      sections.push(focused.content);
      sections.push("");
      sections.push("---");
      sections.push("");
      sections.push("The rest of the deal context follows as background.");
      sections.push("");
    }

    sections.push(`Current stage: ${deal.stage} | Status: ${deal.status}`);
    if (deal.notes) sections.push(`Deal notes: ${deal.notes}`);
    sections.push("");

    if (deal.participants.length > 0) {
      sections.push("## Participants");
      for (const p of deal.participants) {
        const parts = [titleCase(p.name)];
        if (p.title) parts.push(titleCase(p.title));
        if (p.company) parts.push(`@ ${titleCase(p.company)}`);
        if (p.role && p.role !== "unknown") parts.push(`(${p.role})`);
        sections.push(`- ${parts.join(", ")}`);
      }
      sections.push("");
    }

    // Skip the focused entry in the timeline — it's already rendered in full
    // above, so re-including it just wastes tokens. Also skip Deal Chat
    // breadcrumbs: they're pointers back to past conversations, not new deal
    // context, and their "Started a conversation: ..." content reads as
    // engagement activity when rendered as a timeline event.
    const timelineEntries = deal.entries.filter((e) => {
      if (e.type === "chat") return false;
      if (focused && e.id === focused.id) return false;
      return true;
    });
    if (timelineEntries.length > 0) {
      sections.push(focused ? "## Timeline of Interactions (other entries)" : "## Timeline of Interactions");
      // No entry-count cap and no per-entry truncation — DIRECT-mode
      // Deal Chat is sized for the whole deal. The chat stream route's
      // MAX_INPUT_CHARS budget trims oldest messages first if a deal
      // ever overflows gpt-5.5's window.
      for (const entry of timelineEntries) {
        const date = formatEntryDate(entry.entryDate);
        const typeInfo = getEntryTypeInfo(entry.type);
        sections.push(`### ${date} — ${typeInfo.label}${entry.title ? `: ${entry.title}` : ""}`);
        sections.push(entry.content);
        sections.push("");
      }
    }

    if (opts?.extraEntry) {
      const ex = opts.extraEntry;
      const typeInfo = getEntryTypeInfo(ex.type);
      const when = ex.entryDate ? formatEntryDate(ex.entryDate) : formatEntryDate(new Date().toISOString());
      sections.push("## Just Added");
      sections.push(`### ${when} — ${typeInfo.label}${ex.title ? `: ${ex.title}` : ""}`);
      sections.push(ex.content);
      sections.push("");
    }

    if (deal.lastAnalysis) {
      sections.push("## Latest Deal Analysis");
      sections.push(deal.lastAnalysis);
      sections.push("");
    }

    sections.push("{{SALES_NARRATIVE}}");
    sections.push("");
    if (!trimmedQuestion) {
      // No user-supplied prompt — close with a generic ask so the assistant
      // has something to react to.
      sections.push("Based on all this context, help me think through this deal. What questions do you have?");
    }
    return sections.join("\n");
  };

  // Sync the active chat conversation into the URL as ?chat=<convId> so
  // reloads preserve the panel and breadcrumbs can deep-link back in.
  // The empty-panel state (open with no conversation yet) is intentionally
  // not persisted — it's ephemeral until the first message is sent.
  const syncChatUrl = useCallback((convId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (convId) params.set("chat", convId);
    else params.delete("chat");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const openChatPanelForConversation = useCallback((convId: string) => {
    // Resuming an existing conversation — any focus is already baked into
    // the stored first message, so clear it to avoid double-emphasis on
    // subsequent turns.
    setFocusedEntryId(null);
    setPanelConversationId(convId);
    setChatPanelOpen(true);
    syncChatUrl(convId);
  }, [syncChatUrl]);

  const startChatWithEntry = useCallback((entryId: string) => {
    // Start a fresh conversation focused on a specific timeline entry.
    setFocusedEntryId(entryId);
    setPanelConversationId(null);
    setChatPanelOpen(true);
    syncChatUrl(null);
  }, [syncChatUrl]);

  // Hydrate panel state from the URL on first load so a refresh / deep link
  // reopens the right conversation.
  const chatHydratedRef = useRef(false);
  useEffect(() => {
    if (chatHydratedRef.current) return;
    const chat = searchParams.get("chat");
    if (chat) {
      setPanelConversationId(chat);
      setChatPanelOpen(true);
    }
    chatHydratedRef.current = true;
  }, [searchParams]);

  const startDealChat = () => {
    // "Chat With Deal Timeline" — whole-deal chat, no specific focus.
    setFocusedEntryId(null);
    setChatPanelOpen(true);
    if (panelConversationId) syncChatUrl(panelConversationId);
  };

  const closeChatPanel = () => {
    setChatPanelOpen(false);
    setFocusedEntryId(null);
    syncChatUrl(null);
  };

  const updateEntryDate = async (entryId: string, dateStr: string) => {
    if (!dateStr) return;
    await fetch(`/api/deals/${id}/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryDate: new Date(dateStr).toISOString() }),
    });
    setEditingDateEntryId(null);
    await loadDeal();
  };

  const startEditEntry = (entry: TimelineEntry) => {
    setEditingEntryId(entry.id);
    setEditEntryDraft({
      type: entry.type,
      title: entry.title || "",
      content: entry.content || "",
      sourceUrl: entry.sourceUrl || "",
    });
    // Make sure the entry isn't simultaneously in date-edit mode.
    setEditingDateEntryId(null);
    // Auto-expand so the user can see the full content they're editing.
    setExpandedEntries((prev) => new Set(prev).add(entry.id));
  };

  const cancelEditEntry = () => {
    setEditingEntryId(null);
    setEditEntryDraft({ type: "", title: "", content: "", sourceUrl: "" });
  };

  const saveEditEntry = async (entryId: string) => {
    if (savingEntryEdit) return;
    setSavingEntryEdit(true);
    try {
      await fetch(`/api/deals/${id}/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: editEntryDraft.type,
          title: editEntryDraft.title.trim() || null,
          content: editEntryDraft.content,
          sourceUrl: editEntryDraft.sourceUrl.trim() || null,
        }),
      });
      await loadDeal();
      cancelEditEntry();
    } finally {
      setSavingEntryEdit(false);
    }
  };

  const updateParticipantTitle = async (pid: string, title: string) => {
    await fetch(`/api/deals/${id}/participants/${pid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() || null }),
    });
    setEditingTitlePid(null);
    await loadDeal();
  };

  const analyzeDeal = async (opts?: { silent?: boolean; scrollToResult?: boolean }) => {
    const silent = opts?.silent ?? false;
    const scrollToResult = opts?.scrollToResult ?? false;
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/deals/${id}/analyze`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setDeal((prev) =>
          prev
            ? {
                ...prev,
                lastAnalysis: data.analysis,
                lastAnalyzedAt: data.lastAnalyzedAt ?? new Date().toISOString(),
                stage: data.stage ?? prev.stage,
                mikeyHealth: data.mikeyHealth ?? prev.mikeyHealth,
              }
            : prev,
        );
        // Invalidate cached history so the next open re-fetches with the new run.
        setAnalysisHistory(null);
        // If the analyzer applied role guesses to any participants,
        // reload so the chips reflect the new assignments.
        if (data.rolesUpdated > 0) loadDeal();
        if (!silent) setShowAnalysis(true);
        if (scrollToResult) {
          // Expand first so the scroll target is rendered, then scroll on the
          // next frame so layout has settled.
          setShowAnalysis(true);
          requestAnimationFrame(() => {
            analysisCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
      }
    } catch (error) {
      console.error("Failed to analyze deal:", error);
    }
    setAnalyzing(false);
  };

  const loadAnalysisHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/deals/${id}/analyses`);
      if (res.ok) {
        const data = await res.json();
        setAnalysisHistory(data.analyses || []);
      }
    } catch (error) {
      console.error("Failed to load analysis history:", error);
    }
    setHistoryLoading(false);
  };

  const toggleAnalysisHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && analysisHistory === null) loadAnalysisHistory();
  };

  const enrichParticipant = async (pid: string) => {
    setEnrichingPid(pid);
    try {
      const res = await fetch(`/api/deals/${id}/participants/${pid}/enrich`, { method: "POST" });
      if (res.ok) {
        await loadDeal();
      } else {
        const data = await res.json();
        alert(data.error || "Enrichment failed");
      }
    } catch {
      alert("Enrichment failed");
    }
    setEnrichingPid(null);
  };

  const isPdfFile = (file: File) =>
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImageFile = (file: File) => file.type.startsWith("image/");

  const processImageFile = async (file: File) => {
    setProcessingScreenshot(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(file);
      });
      const res = await fetch(`/api/deals/${id}/screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
      });
      if (res.ok) {
        const data = await res.json();
        const ALLOWED_DETECTED = new Set(["email", "slack_message", "sms_message", "linkedin", "screenshot"]);
        const detected =
          typeof data.entryType === "string" && ALLOWED_DETECTED.has(data.entryType)
            ? data.entryType
            : "screenshot";
        setNewEntryType(detected);
        setNewEntryTitle(data.title || "");
        setNewEntryContent(data.content || "");
        setEntryFromScreenshot(true);
        setNewEntryDate(data.date || "");
        setScreenshotMatched(Array.isArray(data.matchedParticipants) ? data.matchedParticipants : []);
        const suggestions = Array.isArray(data.suggestedParticipants) ? data.suggestedParticipants : [];
        setScreenshotSuggestions(suggestions);
        // Default: pre-accept every suggestion. User can unselect before saving.
        setAcceptedSuggestionNames(new Set(suggestions.map((s: { name: string }) => s.name)));
      }
    } catch (error) {
      console.error("Failed to process screenshot:", error);
    }
    setProcessingScreenshot(false);
  };

  const processPdfFile = async (file: File) => {
    setProcessingPdf(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/deals/${id}/extract-pdf`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setNewEntryType("document");
        setNewEntryTitle(data.title || file.name.replace(/\.pdf$/i, ""));
        setNewEntryContent(data.content || "");
        if (data.date) setNewEntryDate(data.date);
      } else {
        const { error } = await res.json().catch(() => ({ error: "Failed to extract PDF" }));
        alert(error || "Failed to extract PDF");
      }
    } catch (error) {
      console.error("Failed to upload PDF:", error);
      alert("Failed to upload PDF");
    }
    setProcessingPdf(false);
  };

  const handleFile = (file: File) => {
    if (isImageFile(file)) return processImageFile(file);
    if (isPdfFile(file)) return processPdfFile(file);
    alert("Only images and PDFs are supported.");
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      if (item.type.startsWith("image/") || item.type === "application/pdf") {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFile(file);
        return;
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragActive) setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the drop zone itself, not a child element
    if (e.currentTarget === e.target) setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleImageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const handlePdfInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  if (loading && !deal) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="h-8 w-64 bg-gray-100 rounded animate-pulse mb-4" />
          <div className="h-32 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">Deal not found.</p>
          <Link href="/deals" className="text-purple-600 hover:underline mt-2 inline-block">← Back to Deals</Link>
        </div>
      </div>
    );
  }

  const stageInfo = resolveStage(deal.stage, customStages);
  const statusInfo = getStatusInfo(deal.status);

  // Sort participants by how frequently they appear in timeline entries
  const mentionCounts = new Map<string, number>();
  const countMentions = (p: Participant) => {
    const terms = [p.name.toLowerCase()];
    if (p.email) terms.push(p.email.toLowerCase());
    return deal.entries.reduce((count, entry) => {
      const text = (entry.content + " " + (entry.title || "")).toLowerCase();
      return count + (terms.some((t) => text.includes(t)) ? 1 : 0);
    }, 0);
  };
  const sortedParticipants = [...deal.participants].sort((a, b) => {
    const ca = countMentions(a);
    const cb = countMentions(b);
    mentionCounts.set(a.id, ca);
    mentionCounts.set(b.id, cb);
    return cb - ca;
  });
  // Ensure counts are populated for all participants (sort may skip some via short-circuit)
  for (const p of sortedParticipants) {
    if (!mentionCounts.has(p.id)) mentionCounts.set(p.id, countMentions(p));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      {/* Floating compact header — slides down from the top once the
          main header card scrolls out of view. Carries the same key
          controls so the user can change stage/status, run analysis,
          open Deal Chat, or delete without scrolling back up. */}
      <div
        className={`fixed top-0 left-0 right-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-700 shadow-sm transition-transform duration-150 ${floatingHeaderShown ? "translate-y-0" : "-translate-y-full"}`}
        aria-hidden={!floatingHeaderShown}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{deal.name}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{deal.companyName}</div>
          </div>
          <select
            value={deal.stage}
            onChange={(e) => updateDeal({ stage: e.target.value })}
            className={`text-[11px] font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer ${stageInfo.color}`}
            title="Stage"
          >
            {mergePipeline(customStages).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select
            value={deal.status}
            onChange={(e) => updateDeal({ status: e.target.value })}
            className={`text-[11px] font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer ${statusInfo.color}`}
            title="Status"
          >
            {DEAL_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {(() => {
            const h = getHealthInfo(deal.mikeyHealth);
            if (!h) return null;
            return (
              <span
                className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${h.color}`}
                title="Mikey Health — set on last deal analysis"
              >
                {h.emoji} {h.label}
              </span>
            );
          })()}
          <button
            onClick={() => analyzeDeal()}
            disabled={analyzing || deal.entries.length === 0}
            className="px-2.5 py-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-md text-[11px] font-medium hover:shadow disabled:opacity-50 inline-flex items-center gap-1"
            title="Re-run deal analysis"
          >
            {analyzing ? (
              <>
                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Analyzing
              </>
            ) : "🧠 Analyze"}
          </button>
          <button
            onClick={startDealChat}
            className="px-2.5 py-1 bg-white dark:bg-gray-800 border border-purple-300 text-purple-700 dark:text-purple-300 rounded-md text-[11px] font-medium hover:bg-purple-50 dark:hover:bg-purple-900/30"
          >
            🌊 Deal Chat
          </button>
          <button
            onClick={deleteDeal}
            className="text-[11px] text-gray-400 hover:text-red-600 px-1.5 py-1"
            title="Delete deal"
          >
            Delete
          </button>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <Link href="/deals" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 inline-flex items-center gap-1 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            All Deals
          </Link>
          {(() => {
            const q = dealSearchQuery.trim().toLowerCase();
            const matches = q
              ? allDeals
                  .filter((d) => d.id !== id)
                  .filter((d) => d.name.toLowerCase().includes(q) || d.companyName.toLowerCase().includes(q))
                  .slice(0, 8)
              : allDeals.filter((d) => d.id !== id).slice(0, 8);
            return (
              <div ref={dealSearchRef} className="relative flex-1 min-w-[220px] max-w-md">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="search"
                  value={dealSearchQuery}
                  onChange={(e) => { setDealSearchQuery(e.target.value); setDealSearchOpen(true); setDealSearchHighlight(0); }}
                  onFocus={() => setDealSearchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setDealSearchOpen(false);
                      (e.target as HTMLInputElement).blur();
                      return;
                    }
                    if (e.key === "ArrowDown") {
                      if (matches.length === 0) return;
                      e.preventDefault();
                      setDealSearchOpen(true);
                      setDealSearchHighlight((h) => Math.min(h + 1, matches.length - 1));
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      if (matches.length === 0) return;
                      e.preventDefault();
                      setDealSearchHighlight((h) => Math.max(h - 1, 0));
                      return;
                    }
                    if (e.key === "Enter") {
                      const target = matches[dealSearchHighlight] || matches[0];
                      if (target) router.push(`/deals/${target.id}`);
                    }
                  }}
                  placeholder="Jump to another deal..."
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                {dealSearchOpen && matches.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 max-h-80 overflow-y-auto">
                    {matches.map((d, i) => {
                      const isHighlighted = i === dealSearchHighlight;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => { setDealSearchOpen(false); setDealSearchQuery(""); router.push(`/deals/${d.id}`); }}
                          onMouseEnter={() => setDealSearchHighlight(i)}
                          ref={(el) => {
                            if (isHighlighted && el) el.scrollIntoView({ block: "nearest" });
                          }}
                          className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 border-b border-gray-100 last:border-b-0 ${isHighlighted ? "bg-purple-100 dark:bg-purple-900/40" : "hover:bg-purple-50 dark:hover:bg-purple-900/20"}`}
                        >
                          <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{d.name}</span>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{d.companyName}{d.stage ? ` · ${d.stage}` : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {dealSearchOpen && q && matches.length === 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                    No deals match &ldquo;{dealSearchQuery}&rdquo;
                  </div>
                )}
              </div>
            );
          })()}
          <Link
            href="/deals?new=1"
            className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg text-xs font-medium shadow hover:shadow-md transition-all inline-flex items-center gap-1.5 flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Deal
          </Link>
        </div>

        {/* Header */}
        <div ref={headerSentinelRef} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              {editingMeta ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={metaName}
                    onChange={(e) => setMetaName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-lg font-semibold focus:ring-2 focus:ring-purple-500"
                    placeholder="Deal name"
                  />
                  <input
                    type="text"
                    value={metaCompanyName}
                    onChange={(e) => setMetaCompanyName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                    placeholder="Company name"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await updateDeal({ name: metaName, companyName: metaCompanyName });
                        setEditingMeta(false);
                      }}
                      className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingMeta(false)} className="px-3 py-1.5 text-gray-600 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setMetaName(deal.name); setMetaCompanyName(deal.companyName); setEditingMeta(true); }}
                  className="text-left group/title"
                >
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 group-hover/title:text-purple-700 transition-colors">{deal.name}</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{deal.companyName}</p>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={deal.stage}
                onChange={(e) => updateDeal({ stage: e.target.value })}
                className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${stageInfo.color}`}
              >
                {mergePipeline(customStages).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <select
                value={deal.status}
                onChange={(e) => updateDeal({ status: e.target.value })}
                className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${statusInfo.color}`}
              >
                {DEAL_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              {(() => {
                const h = getHealthInfo(deal.mikeyHealth);
                if (!h) return null;
                return (
                  <span
                    className={`text-xs font-medium rounded-full px-2.5 py-1 ${h.color}`}
                    title="Mikey Health — set on last deal analysis"
                  >
                    {h.emoji} Mikey Health: {h.label}
                  </span>
                );
              })()}
              <button
                onClick={() => analyzeDeal()}
                disabled={analyzing || deal.entries.length === 0}
                className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg text-xs font-medium shadow hover:shadow-md disabled:opacity-50 flex items-center gap-1.5"
              >
                {analyzing ? (
                  <>
                    <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                    Analyzing...
                  </>
                ) : "🧠 Analyze Deal"}
              </button>
              <button
                onClick={startDealChat}
                className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-purple-300 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-50 flex items-center gap-1.5"
              >
                🌊 Deal Chat
              </button>
              <button
                onClick={deleteDeal}
                className="text-xs text-gray-400 hover:text-red-600 px-2 py-1"
                title="Delete deal"
              >
                Delete
              </button>
            </div>
          </div>

          {/* Date + close-reason row. Projected close is always shown;
              actual close date appears once the deal is in a terminal
              state. Closed-lost reason only when status is closed_lost. */}
          <div className="mt-3 flex items-center gap-4 flex-wrap text-xs text-gray-600 dark:text-gray-300">
            <label className="flex items-center gap-1.5">
              <span className="font-medium text-gray-500 dark:text-gray-400">Deal size:</span>
              <span className="text-gray-500">$</span>
              <input
                type="text"
                inputMode="numeric"
                // Display with commas; strip them + any non-digits on
                // blur before saving as a plain integer.
                defaultValue={deal.dealValue != null ? deal.dealValue.toLocaleString("en-US") : ""}
                key={deal.dealValue ?? "empty"}
                onInput={(e) => {
                  const el = e.currentTarget;
                  const digits = el.value.replace(/[^\d]/g, "");
                  el.value = digits ? Number(digits).toLocaleString("en-US") : "";
                }}
                onBlur={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, "");
                  const next = digits === "" ? null : Math.max(0, parseInt(digits, 10));
                  if (next !== (deal.dealValue ?? null)) {
                    updateDeal({ dealValue: next });
                  }
                }}
                placeholder="—"
                className="w-28 bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:outline-none focus:border-purple-500 px-1 py-0.5"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="font-medium text-gray-500 dark:text-gray-400">Projected close:</span>
              <input
                type="date"
                value={deal.projectedCloseDate ? deal.projectedCloseDate.split("T")[0] : ""}
                onChange={(e) => updateDeal({ projectedCloseDate: e.target.value || null })}
                className="bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:outline-none focus:border-purple-500 px-1 py-0.5"
              />
            </label>
            {(deal.status === "closed_won" || deal.status === "closed_lost") && (
              <label className="flex items-center gap-1.5">
                <span className="font-medium text-gray-500 dark:text-gray-400">Close date:</span>
                <input
                  type="date"
                  value={deal.closeDate ? deal.closeDate.split("T")[0] : ""}
                  onChange={(e) => updateDeal({ closeDate: e.target.value || null })}
                  className="bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:outline-none focus:border-purple-500 px-1 py-0.5"
                />
              </label>
            )}
            {deal.status === "closed_lost" && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <label className="flex items-center gap-1.5">
                  <span className="font-medium text-gray-500 dark:text-gray-400">Closed-lost reason:</span>
                  <select
                    value={deal.closedLostReason || ""}
                    onChange={(e) => updateDeal({ closedLostReason: e.target.value || null })}
                    className="bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:outline-none focus:border-purple-500 px-1 py-0.5"
                  >
                    <option value="">— pick a reason —</option>
                    <optgroup label="Built-in">
                      {CLOSED_LOST_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </optgroup>
                    {customLostReasons.length > 0 && (
                      <optgroup label="Custom">
                        {customLostReasons.map((r) => (
                          <option key={r.id} value={r.value}>{r.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setShowAddReason((v) => !v)}
                  className="text-[11px] text-purple-600 dark:text-purple-300 hover:underline"
                >
                  {showAddReason ? "Close" : "Manage…"}
                </button>
                {showAddReason && (
                  <div className="basis-full mt-1 p-3 rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/20 space-y-2">
                    {customLostReasons.length > 0 && (
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Custom reasons</div>
                        <ul className="space-y-1">
                          {customLostReasons.map((r) => (
                            <li key={r.id} className="flex items-center justify-between text-xs">
                              <span className="text-gray-800 dark:text-gray-100">{r.label}</span>
                              <button
                                type="button"
                                onClick={() => archiveCustomLostReason(r.id, r.value)}
                                className="text-gray-400 hover:text-red-600"
                                title="Archive — existing deals keep the label"
                              >
                                Archive
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newReasonLabel}
                        onChange={(e) => setNewReasonLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addCustomLostReason();
                          }
                        }}
                        placeholder="e.g. Procurement, Legal, Lost to Incumbent…"
                        className="flex-1 px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                      <button
                        type="button"
                        onClick={addCustomLostReason}
                        disabled={!newReasonLabel.trim() || savingReason}
                        className="px-2 py-1 text-xs font-medium text-purple-600 dark:text-purple-300 hover:text-purple-700 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Upcoming Meetings — calendar events in the next 90 days
            for this deal's domain. Imported via enrichDeal during
            validation and refreshable on demand. */}
        {(() => {
          const now = Date.now();
          const upcoming = deal.entries
            .filter((e) => e.type === "meeting" && new Date(e.entryDate).getTime() > now)
            .sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());
          return (
            <div className="bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-800 rounded-xl p-4 mb-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-purple-900 dark:text-purple-200">
                    📅 Upcoming Meetings ({upcoming.length})
                  </span>
                  <span className="text-xs text-gray-400">next 90 days</span>
                </div>
                <button
                  type="button"
                  onClick={refreshUpcomingMeetings}
                  disabled={refreshingUpcoming}
                  className="text-xs text-purple-600 dark:text-purple-300 hover:underline disabled:opacity-60"
                >
                  {refreshingUpcoming ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              {upcoming.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                  No upcoming meetings detected on the calendar for this deal&rsquo;s domain. A live deal with no next meeting scheduled is usually a momentum risk.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {(() => {
                    const participantsById = new Map(deal.participants.map((p) => [p.id, p]));
                    return upcoming.map((e) => {
                    const when = new Date(e.entryDate);
                    const dateLabel = when.toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    });
                    // Pull just the invite description out of the entry
                    // body (enrichCalendar concatenates description +
                    // attendees with a known separator). Surface it so
                    // the founder can see the agenda Mikey is also
                    // using for analysis.
                    const descBlock = (e.content || "").split(/\n\n\*\*Attendees /)[0]?.trim();
                    // Decode HTML entities at render time so older
                    // entries (imported before the decode-on-write fix)
                    // stop showing "Let&#39;s" instead of "Let's".
                    const inviteDesc = descBlock && descBlock !== "(no description)"
                      ? decodeHtmlEntities(descBlock)
                      : null;
                    return (
                      <li key={e.id} className="text-sm">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs text-purple-600 dark:text-purple-300 font-medium whitespace-nowrap">{dateLabel}</span>
                          <span className="text-gray-800 dark:text-gray-100 truncate">{e.title || "Meeting"}</span>
                          {e.sourceUrl && (
                            <a
                              href={e.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-blue-600 hover:underline flex-shrink-0"
                            >
                              open ↗
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              // Hand off a minimal UpcomingEvent-shaped
                              // payload to /pre-call-planning/research.
                              // It picks this up from sessionStorage on
                              // mount, prefills the form, and either
                              // jumps to an existing brief or runs a
                              // fresh research pass.
                              let calendarEventId: string | null = null;
                              let attendeeEmails: string[] = [];
                              if (e.metadata) {
                                try {
                                  const m = JSON.parse(e.metadata);
                                  if (typeof m.calendarEventId === "string") calendarEventId = m.calendarEventId;
                                  if (Array.isArray(m.attendeeEmails)) {
                                    attendeeEmails = m.attendeeEmails.filter((x: unknown): x is string => typeof x === "string");
                                  }
                                } catch { /* ignore */ }
                              }
                              const payload = {
                                id: calendarEventId || e.id,
                                title: e.title || "Meeting",
                                startsAt: e.entryDate,
                                endsAt: null,
                                meetingUrl: e.sourceUrl || null,
                                eventUrl: e.sourceUrl || null,
                                description: e.content || null,
                                location: null,
                                prefill: {
                                  companyName: deal.companyName || "",
                                  contactName: "",
                                  contactTitle: "",
                                  contactLinkedIn: "",
                                  companyUrl: deal.companyUrl || "",
                                },
                                attendees: attendeeEmails.map((email) => ({ email, name: null, external: true })),
                              };
                              try {
                                window.sessionStorage.setItem("precallPlanPrefill", JSON.stringify(payload));
                              } catch { /* quota — fall through */ }
                              window.open("/pre-call-planning/research", "_blank", "noopener,noreferrer");
                            }}
                            className="text-[11px] text-purple-600 hover:underline flex-shrink-0 font-medium"
                            title="Open pre-call research for this meeting in a new tab"
                          >
                            🔬 Pre-Call Plan
                          </button>
                        </div>
                        {(() => {
                          // Surface "With Alice, Bob, charlie@…" so the
                          // upcoming row tells the user who's actually
                          // joining the meeting. Prefer linked deal
                          // participants (nicer names + titles via the
                          // backlink pass), fall back to raw attendee
                          // emails for anyone not yet seeded as a
                          // participant.
                          let linkedIds: string[] = [];
                          let attendeeEmails: string[] = [];
                          if (e.metadata) {
                            try {
                              const m = JSON.parse(e.metadata);
                              if (Array.isArray(m.linkedParticipantIds)) {
                                linkedIds = m.linkedParticipantIds.filter((x: unknown): x is string => typeof x === "string");
                              }
                              if (Array.isArray(m.attendeeEmails)) {
                                attendeeEmails = m.attendeeEmails.filter((x: unknown): x is string => typeof x === "string");
                              }
                            } catch { /* ignore */ }
                          }
                          const linked = linkedIds
                            .map((pid) => participantsById.get(pid))
                            .filter((p): p is NonNullable<typeof p> => !!p);
                          const linkedEmails = new Set(
                            linked.map((p) => p.email?.toLowerCase()).filter((e): e is string => !!e)
                          );
                          // Anyone in attendeeEmails who isn't already
                          // covered by a linked DealParticipant.
                          const extraEmails = attendeeEmails
                            .filter((email) => !linkedEmails.has(email.toLowerCase()));
                          if (linked.length === 0 && extraEmails.length === 0) return null;
                          const linkedLabels = linked.map((p) => {
                            const name = p.name.includes("@") ? (nameFromEmail(p.name) || p.name) : titleCase(p.name);
                            return p.title ? `${name} (${p.title})` : name;
                          });
                          const extraLabels = extraEmails.map((email) => nameFromEmail(email) || email);
                          const all = [...linkedLabels, ...extraLabels];
                          return (
                            <div className="ml-[4.75rem] mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                              <span className="uppercase tracking-wider font-medium text-gray-400">With </span>
                              {all.join(", ")}
                            </div>
                          );
                        })()}
                        {inviteDesc && (
                          <div className="ml-[4.75rem] mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2 hover:line-clamp-none transition-all">
                            {/* Convert isolated single newlines into
                                paragraph breaks so the bulleted invite
                                content keeps its structure (markdown
                                otherwise collapses single \n into a
                                space). Double \n\n stays as-is. */}
                            <EntryMarkdown>
                              {inviteDesc.replace(/(?<!\n)\n(?!\n)/g, "\n\n")}
                            </EntryMarkdown>
                          </div>
                        )}
                      </li>
                    );
                    });
                  })()}
                </ul>
              )}
            </div>
          );
        })()}

        {/* First-run analysis banner — shown only when the auto-analyze
            kicked off on mount (no prior lastAnalysis yet) so the user
            sees something is happening during the ~30s gpt-5.5 takes. */}
        {analyzing && !deal.lastAnalysis && (
          <div className="bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-xl p-4 mb-5 flex items-center gap-3">
            <svg className="animate-spin h-5 w-5 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <div className="text-sm">
              <div className="font-medium text-purple-900 dark:text-purple-100">🧠 Mikey is analyzing this deal…</div>
              <div className="text-xs text-purple-700 dark:text-purple-300">First-time analysis takes about 30 seconds. Mikey Health, stakeholder roles, and next steps will appear here when done.</div>
            </div>
          </div>
        )}

        {/* Analysis panel */}
        {deal.lastAnalysis && (() => {
          const summaryBody = extractDealSummary(deal.lastAnalysis);
          // If we couldn't locate the Deal Summary section, fall back to
          // showing the whole analysis so we never strand the user with an
          // empty panel.
          const hasSummary = Boolean(summaryBody);
          const analysisMarkdownComponents = buildAnalysisMarkdownComponents(deal.lastAnalysis);
          return (
            <div ref={analysisCardRef} className="bg-white dark:bg-gray-800 border border-purple-200 rounded-xl mb-5 scroll-mt-4">
              <div
                className={`flex items-center justify-between px-5 py-3 ${hasSummary ? "cursor-pointer hover:bg-purple-50/60 transition-colors rounded-t-xl" : ""}`}
                {...(hasSummary ? {
                  onClick: () => setShowAnalysis(!showAnalysis),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowAnalysis(!showAnalysis); }
                  },
                  role: "button",
                  tabIndex: 0,
                  "aria-expanded": showAnalysis,
                  "aria-label": showAnalysis ? "Collapse to deal summary" : "Expand full deal analysis",
                } : {})}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-purple-900">🧠 Deal Analysis</span>
                  {analyzing ? (
                    <span className="flex items-center gap-1.5 text-xs text-purple-600">
                      <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                      Re-analyzing...
                    </span>
                  ) : (
                    deal.lastAnalyzedAt && (
                      <span className="text-xs text-gray-400">
                        · {new Date(deal.lastAnalyzedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )
                  )}
                </div>
                <CopyMarkdownButton
                  getMarkdown={() => deal.lastAnalysis || ""}
                  label="full deal analysis"
                />
              </div>
              <div
                className={`px-5 pb-5 border-t border-purple-100 ${hasSummary && !showAnalysis ? "cursor-pointer" : ""}`}
                onClick={hasSummary && !showAnalysis ? () => setShowAnalysis(true) : undefined}
              >
                <div className="prose prose-sm max-w-none text-gray-700 dark:text-gray-200 mt-3">
                  {showAnalysis || !hasSummary ? (
                    <ReactMarkdown components={analysisMarkdownComponents}>{deal.lastAnalysis}</ReactMarkdown>
                  ) : (
                    <ReactMarkdown components={analysisMarkdownComponents}>{summaryBody!}</ReactMarkdown>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-4 flex-wrap">
                  <button
                    onClick={(e) => { e.stopPropagation(); analyzeDeal(); }}
                    disabled={analyzing}
                    className="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1"
                  >
                    {analyzing ? "Analyzing..." : "↻ Re-analyze"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleAnalysisHistory(); }}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium flex items-center gap-1"
                  >
                    {showHistory ? "Hide history" : "View history"}
                    {analysisHistory && analysisHistory.length > 1 && (
                      <span className="text-gray-400">({analysisHistory.length - 1} previous)</span>
                    )}
                  </button>
                  {hasSummary && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowAnalysis(!showAnalysis); }}
                      className="text-xs text-purple-600 hover:text-purple-800 font-medium ml-auto flex items-center gap-1"
                    >
                      {showAnalysis ? "Show less ↑" : "Show more ↓"}
                    </button>
                  )}
                </div>

                {showHistory && (
                  <div className="mt-4 border-t border-purple-100 pt-4 space-y-2">
                    {historyLoading ? (
                      <div className="text-xs text-gray-400">Loading history...</div>
                    ) : !analysisHistory || analysisHistory.length <= 1 ? (
                      <div className="text-xs text-gray-400">No previous analyses yet.</div>
                    ) : (
                      analysisHistory.slice(1).map((item) => {
                        const isOpen = expandedHistoryId === item.id;
                        const when = new Date(item.createdAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        });
                        return (
                          <div key={item.id} className="border border-gray-200 dark:border-gray-700 rounded-lg">
                            <button
                              onClick={() => setExpandedHistoryId(isOpen ? null : item.id)}
                              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-gray-700 dark:text-gray-200 font-medium">{when}</span>
                                {item.stage && (
                                  <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:text-gray-300">
                                    Stage: {item.stage}
                                  </span>
                                )}
                                <span className="text-gray-400">
                                  {item.entryCount} {item.entryCount === 1 ? "entry" : "entries"} · {item.participantCount} {item.participantCount === 1 ? "participant" : "participants"}
                                </span>
                              </div>
                              <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {isOpen && (
                              <div className="px-3 pb-3 border-t border-gray-100">
                                <div className="prose prose-sm max-w-none text-gray-700 dark:text-gray-200 mt-2">
                                  <ReactMarkdown>{item.analysis}</ReactMarkdown>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          {/* Participants sidebar */}
          <div>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Participants ({sortedParticipants.length})</h3>
                <div className="flex items-center gap-2">
                  {sortedParticipants.some((p) => p.email && !p.title) && (
                    <button
                      onClick={enrichAllParticipants}
                      disabled={enrichingAll}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50 flex items-center gap-1"
                    >
                      {enrichingAll ? (
                        <>
                          <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                          Enriching...
                        </>
                      ) : "Enrich All"}
                    </button>
                  )}
                  <button
                    onClick={() => setShowAddParticipant(true)}
                    className="text-xs text-purple-600 hover:text-purple-800 font-medium"
                  >
                    + Add
                  </button>
                </div>
              </div>

              {showAddParticipant && (
                <div className="mb-3 p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2">
                  <input type="text" value={newParticipantName} onChange={(e) => setNewParticipantName(e.target.value)} placeholder="Name" className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded text-sm" autoFocus />
                  <input type="text" value={newParticipantTitle} onChange={(e) => setNewParticipantTitle(e.target.value)} placeholder="Title (optional)" className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded text-sm" />
                  <input type="email" value={newParticipantEmail} onChange={(e) => setNewParticipantEmail(e.target.value)} placeholder="Email (optional)" className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded text-sm" />
                  <select value={newParticipantRole} onChange={(e) => setNewParticipantRole(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded text-sm">
                    {PARTICIPANT_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={addParticipant} disabled={!newParticipantName.trim()} className="px-2.5 py-1 bg-purple-600 text-white rounded text-xs font-medium disabled:opacity-50">Add</button>
                    <button onClick={() => setShowAddParticipant(false)} className="px-2.5 py-1 text-gray-600 dark:text-gray-300 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded">Cancel</button>
                  </div>
                </div>
              )}

              {sortedParticipants.length === 0 && !showAddParticipant && (
                <p className="text-xs text-gray-400">No participants yet.</p>
              )}

              <div className="space-y-2">
                {sortedParticipants.map((p) => {
                  const roleInfo = getRoleInfo(p.role);
                  return (
                    <div key={p.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 group/p">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{displayName(p.name, p.email)}</span>
                            {(() => {
                              const mentions = mentionCounts.get(p.id) || 0;
                              if (mentions === 0) return null;
                              const intensity = mentions >= 4 ? "bg-purple-100 text-purple-700" : mentions >= 2 ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 dark:text-gray-300";
                              return (
                                <span className="relative group/badge flex-shrink-0">
                                  <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 leading-none cursor-help ${intensity}`}>
                                    {mentions}
                                  </span>
                                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-gray-900 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover/badge:opacity-100 transition-opacity pointer-events-none z-10">
                                    {mentions} interaction{mentions === 1 ? "" : "s"} on record
                                  </span>
                                </span>
                              );
                            })()}
                            {p.linkedinUrl && (
                              <a href={normalizeLinkedInUrl(p.linkedinUrl) || "#"} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 flex-shrink-0" title="LinkedIn">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z"/></svg>
                              </a>
                            )}
                          </div>
                          {editingTitlePid === p.id ? (
                            <div className="flex items-center gap-1 mt-0.5">
                              <input
                                type="text"
                                value={editTitleValue}
                                onChange={(e) => setEditTitleValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") updateParticipantTitle(p.id, editTitleValue); if (e.key === "Escape") setEditingTitlePid(null); }}
                                placeholder="Title"
                                className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 dark:border-gray-700 rounded text-xs focus:ring-1 focus:ring-purple-500"
                                autoFocus
                              />
                              <button onClick={() => updateParticipantTitle(p.id, editTitleValue)} className="text-xs text-purple-600 font-medium">Save</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setEditingTitlePid(p.id); setEditTitleValue(p.title || ""); }}
                              className="relative text-left mt-0.5 w-full min-w-0 group/title"
                            >
                              {p.title ? (
                                <>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate group-hover/title:text-purple-600 transition-colors">{titleCase(p.title)}{p.company ? ` @ ${titleCase(p.company)}` : ""}</div>
                                  <div
                                    role="tooltip"
                                    className="pointer-events-none absolute left-0 top-full mt-1 z-20 hidden group-hover/title:block max-w-xs w-max whitespace-normal break-words rounded-md bg-gray-900 text-white text-[11px] leading-snug px-2 py-1.5 shadow-lg"
                                  >
                                    {titleCase(p.title)}{p.company ? ` @ ${titleCase(p.company)}` : ""}
                                  </div>
                                </>
                              ) : (
                                <div className="text-xs text-gray-300 group-hover/title:text-purple-500 transition-colors italic">+ Add title</div>
                              )}
                            </button>
                          )}
                          {p.email && <div className="text-xs text-gray-400 truncate">{p.email}</div>}
                        </div>
                        <button onClick={() => deleteParticipant(p.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover/p:opacity-100" title="Remove">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <select
                          value={p.role}
                          onChange={(e) => updateParticipantRole(p.id, e.target.value)}
                          className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer ${roleInfo.color}`}
                        >
                          {PARTICIPANT_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                        {p.email && !p.title && !p.pdlEnrichedAt && (
                          <button
                            onClick={() => enrichParticipant(p.id)}
                            disabled={enrichingPid === p.id}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50 flex items-center gap-0.5"
                            title="Look up title and company via People Data Labs"
                          >
                            {enrichingPid === p.id ? (
                              <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                            ) : "Look up"}
                          </button>
                        )}
                        {(p.pdlEnrichedAt || (p.email && p.title)) && (
                          <span className="text-xs text-green-600" title={p.pdlEnrichedAt ? `Enriched ${new Date(p.pdlEnrichedAt).toLocaleDateString()}` : "Has contact info"}>✓</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Timeline + add entry */}
          <div>
            {/* Add entry input */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-5">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">New entry:</span>
                <VoiceNoteButton
                  variant="prominent"
                  disabled={processingScreenshot || processingPdf}
                  onResult={(summary, transcript) => {
                    setNewEntryType("note");
                    setNewEntryContent((prev) => (prev ? `${prev}\n\n${summary}` : summary));
                    setPendingVoiceTranscript(transcript);
                  }}
                />
                {ENTRY_TYPES.map((t) => (
                  <div key={t.value} className="relative group">
                    <button
                      onClick={() => setNewEntryType(t.value)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${newEntryType === t.value ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
                    >
                      {t.emoji} {t.label}
                    </button>
                    {t.description && (
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-20 w-56 px-2.5 py-1.5 rounded-md bg-gray-900 text-white text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-75"
                      >
                        {t.description}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <input
                type="text"
                value={newEntryTitle}
                onChange={(e) => setNewEntryTitle(e.target.value)}
                placeholder="Title (optional)"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 mb-2"
              />
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative rounded-lg mb-2 transition-colors ${dragActive ? "ring-2 ring-purple-400 ring-offset-1" : ""}`}
              >
                <textarea
                  value={newEntryContent}
                  onChange={(e) => setNewEntryContent(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Paste, drop, type, or record a voice note — call transcripts, emails, notes, screenshots, PDFs…"
                  rows={4}
                  className="w-full px-3 py-2 pr-3 pb-10 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 resize-y"
                />
                {/* Attachment CTA row — image + PDF icons, chat-style */}
                <div className="absolute bottom-2 left-2 flex items-center gap-1">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageInputChange}
                  />
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={handlePdfInputChange}
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={processingScreenshot || processingPdf}
                    title="Attach image (screenshot)"
                    className="p-1.5 rounded-md text-gray-400 hover:text-purple-600 hover:bg-purple-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => pdfInputRef.current?.click()}
                    disabled={processingScreenshot || processingPdf}
                    title="Attach PDF"
                    className="p-1.5 rounded-md text-gray-400 hover:text-purple-600 hover:bg-purple-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 3v5a1 1 0 001 1h5" />
                    </svg>
                  </button>
                  <VoiceNoteButton
                    disabled={processingScreenshot || processingPdf}
                    onResult={(summary, transcript) => {
                      // Switch the form into Note mode so the user
                      // doesn't have to flip the type tab themselves,
                      // and drop the synthesized text into the body.
                      setNewEntryType("note");
                      setNewEntryContent((prev) => (prev ? `${prev}\n\n${summary}` : summary));
                      setPendingVoiceTranscript(transcript);
                    }}
                  />
                  {(processingScreenshot || processingPdf) && (
                    <div className="flex items-center gap-1.5 ml-1">
                      <svg className="animate-spin h-3.5 w-3.5 text-purple-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                      <span className="text-xs text-purple-600">
                        {processingPdf ? "Extracting text from PDF..." : "Extracting text from screenshot..."}
                      </span>
                    </div>
                  )}
                </div>
                {dragActive && (
                  <div className="pointer-events-none absolute inset-0 rounded-lg bg-purple-50/70 border-2 border-dashed border-purple-400 flex items-center justify-center">
                    <span className="text-xs font-medium text-purple-700">Drop image or PDF to attach</span>
                  </div>
                )}
              </div>

              {/* Participant attribution from screenshot */}
              {(screenshotMatched.length > 0 || screenshotSuggestions.length > 0) && (
                <div className="mb-2 p-2.5 rounded-lg bg-purple-50/50 border border-purple-100">
                  {screenshotMatched.length > 0 && (
                    <div className="flex items-start gap-2 flex-wrap mb-1.5 last:mb-0">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-purple-700 mt-0.5">Linked:</span>
                      {screenshotMatched.map((p) => (
                        <span
                          key={p.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white dark:bg-gray-800 border border-purple-200 text-xs text-purple-800"
                        >
                          {titleCase(p.name)}
                        </span>
                      ))}
                    </div>
                  )}
                  {screenshotSuggestions.length > 0 && (
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-purple-700 mt-0.5">Add new:</span>
                      {screenshotSuggestions.map((p) => {
                        const accepted = acceptedSuggestionNames.has(p.name);
                        return (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => {
                              setAcceptedSuggestionNames((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.name)) next.delete(p.name);
                                else next.add(p.name);
                                return next;
                              });
                            }}
                            title={p.reason || (accepted ? "Will be added as a participant" : "Click to add")}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                              accepted
                                ? "bg-purple-600 text-white border-purple-600 hover:bg-purple-700"
                                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-purple-300 hover:text-purple-700"
                            }`}
                          >
                            {accepted ? "✓" : "+"} {titleCase(p.name)}
                            {p.email && <span className="opacity-70"> · {p.email}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <input
                type="url"
                value={newEntryUrl}
                onChange={(e) => setNewEntryUrl(e.target.value)}
                placeholder="Source URL (optional)"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 mb-2"
              />
              <div className="relative mb-2">
                <textarea
                  value={askMikeyPrompt}
                  onChange={(e) => setAskMikeyPrompt(e.target.value)}
                  placeholder="Ask Mikey about this (optional) — e.g., 'What should I reply?' or 'Is this a green or yellow flag?'"
                  rows={2}
                  className="w-full px-3 py-2 pl-9 border border-purple-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 resize-y bg-purple-50/30 placeholder:text-gray-400"
                />
                <span className="absolute left-2.5 top-2.5 text-base" aria-hidden="true">🌊</span>
                {askMikeyPrompt.trim() && (
                  <span className="absolute right-2.5 top-2.5 text-[10px] font-medium text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">
                    opens Deal Chat in new tab
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Date:</label>
                  <input
                    type="date"
                    value={newEntryDate}
                    onChange={(e) => setNewEntryDate(e.target.value)}
                    className={`px-2 py-1.5 border rounded-lg text-xs text-gray-600 dark:text-gray-300 focus:ring-2 focus:ring-purple-500 ${entryFromScreenshot && !newEntryDate ? "border-red-400 ring-1 ring-red-200" : "border-gray-200 dark:border-gray-700"}`}
                  />
                  {entryFromScreenshot && !newEntryDate ? (
                    <span className="text-xs text-red-500 font-medium">date required</span>
                  ) : !newEntryDate ? (
                    <span className="text-xs text-gray-400">defaults to today</span>
                  ) : null}
                </div>
                <button
                  onClick={() => addEntry()}
                  disabled={!newEntryContent.trim() || addingEntry || analyzing || (entryFromScreenshot && !newEntryDate)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {addingEntry ? (
                    "Adding..."
                  ) : analyzing ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                      Analyzing Update
                    </>
                  ) : (
                    "+ Add Entry"
                  )}
                </button>
              </div>
            </div>

            {/* Meeting Recorder import */}
            <div className="mb-5">
              <MeetingRecorderPanel
                defaultCollapsed={false}
                onSelectCall={async (data) => {
                  // Build content with attendees header
                  const headerLines: string[] = [];
                  if (data.date) {
                    headerLines.push(`Call Date: ${new Date(data.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
                  }
                  if (data.attendees?.length) {
                    const formatted = data.attendees.map((a) => {
                      const name = a.name.includes("@") ? a.name : titleCase(a.name);
                      const parts = [name];
                      if (a.title) parts[0] += `, ${titleCase(a.title)}`;
                      if (a.company) parts[0] += ` @ ${titleCase(a.company)}`;
                      if (a.email) parts.push(a.email);
                      return parts.join(" — ");
                    });
                    headerLines.push(`Attendees:\n${formatted.map((f) => `  - ${f}`).join("\n")}`);
                  }
                  const header = headerLines.length ? headerLines.join("\n") + "\n\n" : "";
                  const summaryPart = data.summary ? `## Summary\n\n${data.summary}\n\n` : "";
                  const transcriptPart = data.transcript ? `## Transcript\n\n${data.transcript}` : "";

                  await addEntry({
                    type: "call_transcript",
                    title: data.title,
                    content: header + summaryPart + transcriptPart,
                    sourceUrl: data.recordingUrl,
                    entryDate: data.date ? new Date(data.date).toISOString() : undefined,
                  });

                  // Also add attendees as participants (deduplicated by email then name)
                  if (data.attendees?.length) {
                    const existingEmails = new Set(deal.participants.filter((p) => p.email).map((p) => p.email!.toLowerCase()));
                    const existingNames = new Set(deal.participants.map((p) => p.name.toLowerCase()));
                    for (const a of data.attendees) {
                      if (!a.name) continue;
                      if (a.email && existingEmails.has(a.email.toLowerCase())) continue;
                      if (existingNames.has(a.name.toLowerCase())) continue;
                      await fetch(`/api/deals/${id}/participants`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: a.name,
                          title: a.title,
                          company: a.company,
                          email: a.email,
                          role: "unknown",
                        }),
                      });
                      // Track newly added to prevent duplicates within the same batch
                      if (a.email) existingEmails.add(a.email.toLowerCase());
                      existingNames.add(a.name.toLowerCase());
                    }
                    // Auto-enrich any participants missing titles
                    fetch(`/api/deals/${id}/participants/enrich-all`, { method: "POST" })
                      .then(() => loadDeal())
                      .catch(() => {});
                  } else {
                    await loadDeal();
                  }
                }}
              />
            </div>

            {/* Timeline */}
            <div>
              {(() => {
                // Count entries per type, and only show filter chips for types that actually occur.
                const typeCounts = new Map<string, number>();
                for (const e of deal.entries) {
                  typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
                }
                const visibleTypes = ENTRY_TYPES.filter((t) => typeCounts.has(t.value));
                const hasTypeFilter = timelineTypeFilter.size > 0;
                const query = timelineQuery.trim().toLowerCase();
                const hasQuery = query.length > 0;
                const participantsById = new Map(deal.participants.map((p) => [p.id, p]));

                const entryMatchesQuery = (e: TimelineEntry): boolean => {
                  if (!hasQuery) return true;
                  if ((e.title || "").toLowerCase().includes(query)) return true;
                  const typeLabel = getEntryTypeInfo(e.type).label.toLowerCase();
                  if (typeLabel.includes(query)) return true;
                  if (e.type.toLowerCase().includes(query)) return true;
                  // Linked participants (from metadata.linkedParticipantIds)
                  let linkedIds: string[] = [];
                  if (e.metadata) {
                    try {
                      const parsed = JSON.parse(e.metadata);
                      if (Array.isArray(parsed?.linkedParticipantIds)) {
                        linkedIds = parsed.linkedParticipantIds.filter((x: unknown): x is string => typeof x === "string");
                      }
                    } catch { /* ignore */ }
                  }
                  for (const pid of linkedIds) {
                    const p = participantsById.get(pid);
                    if (p && p.name.toLowerCase().includes(query)) return true;
                  }
                  return false;
                };

                const nowTs = Date.now();
                const filteredEntries = deal.entries.filter((e) => {
                  // Upcoming calendar meetings render in the dedicated
                  // section above the analysis panel — don't double-list
                  // them in the historical timeline.
                  if (
                    e.type === "meeting" &&
                    new Date(e.entryDate).getTime() > nowTs
                  ) {
                    return false;
                  }
                  if (hasTypeFilter && !timelineTypeFilter.has(e.type)) return false;
                  if (!entryMatchesQuery(e)) return false;
                  return true;
                });
                const hasFilter = hasTypeFilter || hasQuery;
                const toggleType = (value: string) => {
                  setTimelineTypeFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(value)) next.delete(value);
                    else next.add(value);
                    return next;
                  });
                };
                return (
                  <>
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                          Timeline ({filteredEntries.length}
                          {hasFilter && deal.entries.length !== filteredEntries.length
                            ? ` of ${deal.entries.length}`
                            : ""}
                          )
                        </h3>
                        {deal.entries.length > 0 && (
                          <button
                            type="button"
                            onClick={startDealChat}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100"
                            title="Chat with Mikey about the whole deal timeline"
                          >
                            🌊 Chat With Deal Timeline
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setBulkImportOpen(true)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                          title="Scan the last 90 days of recordings for calls matching this deal"
                        >
                          📞 Bulk Import Calls
                        </button>
                        <button
                          type="button"
                          onClick={scanFutureMeetings}
                          disabled={scanningFutureMeetings}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-60"
                          title="Scan the next 90 days of your calendar for new meetings with this deal's participants"
                        >
                          {scanningFutureMeetings ? "Scanning…" : "📅 Scan Future Meetings"}
                        </button>
                        {futureMeetingsResult && (
                          <span className="text-[11px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
                            {!futureMeetingsResult.hasCalendar
                              ? "No calendar connected"
                              : !futureMeetingsResult.hasDomain
                                ? "Deal has no domain to match"
                                : futureMeetingsResult.added > 0
                                  ? `Added ${futureMeetingsResult.added} new · ${futureMeetingsResult.skipped} already on timeline`
                                  : "No new meetings found"}
                            {futureMeetingsResult.triggeredAnalysis && (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="text-pink-600 dark:text-pink-300 inline-flex items-center gap-1">
                                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Re-analyzing in background…
                                </span>
                              </>
                            )}
                          </span>
                        )}
                      </div>
                      {deal.entries.length > 0 && visibleTypes.length > 1 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => setTimelineTypeFilter(new Set())}
                            className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                              !hasTypeFilter
                                ? "bg-gray-900 text-white"
                                : "bg-gray-100 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                            }`}
                          >
                            All ({deal.entries.length})
                          </button>
                          {visibleTypes.map((t) => {
                            const count = typeCounts.get(t.value) ?? 0;
                            const active = timelineTypeFilter.has(t.value);
                            return (
                              <button
                                key={t.value}
                                onClick={() => toggleType(t.value)}
                                aria-pressed={active}
                                className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors inline-flex items-center gap-1 ${
                                  active
                                    ? "bg-purple-600 text-white"
                                    : "bg-gray-100 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                                }`}
                              >
                                <span aria-hidden="true">{t.emoji}</span>
                                {t.label} ({count})
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {deal.entries.length > 0 && (
                      <div className="relative mb-3">
                        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                          type="search"
                          value={timelineQuery}
                          onChange={(e) => setTimelineQuery(e.target.value)}
                          placeholder="Search timeline — title, type, or person..."
                          className="w-full pl-8 pr-8 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-800"
                        />
                        {timelineQuery && (
                          <button
                            type="button"
                            onClick={() => setTimelineQuery("")}
                            aria-label="Clear search"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                    {deal.entries.length === 0 ? (
                      <div className="bg-white dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center">
                        <p className="text-sm text-gray-500 dark:text-gray-400">No entries yet. Add one above or import a call from your meeting recorder.</p>
                      </div>
                    ) : filteredEntries.length === 0 ? (
                      <div className="bg-white dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-6 text-center">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          No entries match the current filters.{" "}
                          <button
                            onClick={() => { setTimelineTypeFilter(new Set()); setTimelineQuery(""); }}
                            className="text-purple-600 hover:underline"
                          >
                            Clear {hasFilter ? "filters" : "filter"}
                          </button>
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredEntries.map((entry) => {
                          const typeInfo = getEntryTypeInfo(entry.type);
                          return (
                            <div
                              key={entry.id}
                              id={`entry-${entry.id}`}
                              onClick={(e) => {
                                // Skip if the click came from any interactive
                                // element inside the card (icons, chips, CTAs,
                                // inputs, anchors).
                                const target = e.target as HTMLElement;
                                if (target.closest("button, a, input, select, textarea, summary, [data-no-toggle]")) return;
                                // Deal Chat breadcrumbs reopen the side panel
                                // rather than toggling expansion — the card IS
                                // a conversation, so clicking it should take
                                // you back into it.
                                const chatMatch = entry.type === "chat" && entry.sourceUrl
                                  ? entry.sourceUrl.match(/^\/chat\/([^/?#]+)/)
                                  : null;
                                if (chatMatch) {
                                  openChatPanelForConversation(chatMatch[1]);
                                  return;
                                }
                                setExpandedEntries((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(entry.id)) next.delete(entry.id);
                                  else next.add(entry.id);
                                  return next;
                                });
                              }}
                              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 group/e scroll-mt-20 cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                            >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              {editingDateEntryId === entry.id ? (
                                <input
                                  type="date"
                                  value={editDateValue}
                                  onChange={(e) => setEditDateValue(e.target.value)}
                                  onBlur={() => { if (editDateValue) updateEntryDate(entry.id, editDateValue); else setEditingDateEntryId(null); }}
                                  onKeyDown={(e) => { if (e.key === "Enter" && editDateValue) updateEntryDate(entry.id, editDateValue); if (e.key === "Escape") setEditingDateEntryId(null); }}
                                  className="text-xs px-1.5 py-0.5 border border-purple-300 rounded focus:ring-1 focus:ring-purple-500"
                                  autoFocus
                                />
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingDateEntryId(entry.id);
                                    setEditDateValue(new Date(entry.entryDate).toISOString().split("T")[0]);
                                  }}
                                  className="text-xs text-gray-400 font-medium hover:text-purple-600 transition-colors"
                                  title="Click to change date"
                                >
                                  {formatEntryDate(entry.entryDate)}
                                </button>
                              )}
                              <span className="text-xs font-medium">{typeInfo.emoji} {typeInfo.label}</span>
                            </div>
                            {entry.title && <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{entry.title}</div>}
                            {(() => {
                              // Resolve linkedParticipantIds from the entry's metadata JSON.
                              let ids: string[] = [];
                              if (entry.metadata) {
                                try {
                                  const parsed = JSON.parse(entry.metadata);
                                  if (Array.isArray(parsed?.linkedParticipantIds)) {
                                    ids = parsed.linkedParticipantIds.filter((x: unknown): x is string => typeof x === "string");
                                  }
                                } catch { /* ignore */ }
                              }
                              const linked = ids
                                .map((pid) => participantsById.get(pid))
                                .filter((p): p is NonNullable<typeof p> => !!p);
                              const linkedIdSet = new Set(linked.map((p) => p.id));
                              const available = deal.participants.filter((p) => !linkedIdSet.has(p.id));
                              if (linked.length === 0 && available.length === 0) return null;
                              return (
                                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">With</span>
                                  {linked.map((p) => {
                                    const nameLabel = p.name.includes("@") ? (nameFromEmail(p.name) || p.name) : titleCase(p.name);
                                    return (
                                      <span
                                        key={p.id}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-[11px] text-purple-700"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => setTimelineQuery(nameLabel)}
                                          title={`Filter timeline to ${nameLabel}`}
                                          className="hover:underline"
                                        >
                                          {nameLabel}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => unlinkEntryParticipant(entry, p.id)}
                                          title="Remove from this entry"
                                          className="text-purple-400 hover:text-red-500"
                                        >
                                          ×
                                        </button>
                                      </span>
                                    );
                                  })}
                                  {available.length > 0 && (
                                    <EntryParticipantPicker
                                      available={available}
                                      onPick={(pid) => linkEntryParticipant(entry, pid)}
                                    />
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-2">
                            <CopyLinkButton id={`entry-${entry.id}`} label={entry.title || typeInfo.label} />
                            <div className="flex items-center gap-2 opacity-0 group-hover/e:opacity-100 transition-opacity">
                              {entry.sourceUrl && (() => {
                                const chatMatch = entry.type === "chat" ? entry.sourceUrl.match(/^\/chat\/([^/?#]+)/) : null;
                                const linkTitle = chatMatch ? "Reopen this Deal Chat" : "Open source";
                                return (
                                  <a
                                    href={entry.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-gray-400 hover:text-blue-600"
                                    title={linkTitle}
                                    onClick={chatMatch ? (e) => {
                                      // Plain click reopens in the inline panel; cmd/ctrl/middle
                                      // click still go to /chat/{id} in a new tab naturally.
                                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                                      e.preventDefault();
                                      openChatPanelForConversation(chatMatch[1]);
                                    } : undefined}
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                  </a>
                                );
                              })()}
                              <button onClick={() => startEditEntry(entry)} className="text-gray-400 hover:text-purple-600" title="Edit entry">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              </button>
                              <button onClick={() => deleteEntry(entry.id)} className="text-gray-400 hover:text-red-600" title="Delete">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </div>
                          </div>
                        </div>
                        {(entry.type === "call_transcript" || entry.type === "call_summary") && (() => {
                          const { summary, transcript } = splitCallContent(entry);
                          const openRecapEmail = () => {
                            try {
                              sessionStorage.setItem("callRecapInput", JSON.stringify({
                                recordingUrl: entry.sourceUrl || "",
                                callSummary: summary || transcript,
                                callTranscript: transcript,
                              }));
                            } catch { /* ignore quota errors */ }
                            window.open("/call-recap?generating=true", "_blank");
                          };
                          const openAnalyzeCall = () => {
                            try {
                              sessionStorage.setItem("callCoachingPrefill", JSON.stringify({
                                recordingUrl: entry.sourceUrl || undefined,
                                transcript: transcript || summary,
                              }));
                            } catch { /* ignore quota errors */ }
                            window.open("/call-review", "_blank");
                          };
                          const canRecap = Boolean(summary || transcript);
                          const canAnalyze = Boolean(transcript || summary);
                          return (
                            <div className="flex items-center gap-2 flex-wrap mt-1 mb-2">
                              <button
                                type="button"
                                onClick={openRecapEmail}
                                disabled={!canRecap}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Draft a recap email for this call in a new tab"
                              >
                                📧 Recap Email
                              </button>
                              <button
                                type="button"
                                onClick={openAnalyzeCall}
                                disabled={!canAnalyze}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Analyze this call in a new tab"
                              >
                                🧠 Analyze Call
                              </button>
                              <button
                                type="button"
                                onClick={() => startChatWithEntry(entry.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100"
                                title="Chat with Mikey focused on this call, with the rest of the deal as background"
                              >
                                🌊 Chat With This
                              </button>
                            </div>
                          );
                        })()}
                        {(entry.type === "email" || entry.type === "chat" || entry.type === "slack_message" || entry.type === "sms_message") && (() => {
                          // For Mikey Deal Chat breadcrumbs, "Chat With This" reopens
                          // the past conversation stored at sourceUrl = /chat/<id>.
                          // For emails / Slack / SMS, it starts a fresh focused chat.
                          const chatMatch = entry.type === "chat" && entry.sourceUrl
                            ? entry.sourceUrl.match(/^\/chat\/([^/?#]+)/)
                            : null;
                          const label = chatMatch ? "🌊 Reopen This Chat" : "🌊 Chat With This";
                          const onClickAction = chatMatch
                            ? () => openChatPanelForConversation(chatMatch[1])
                            : () => startChatWithEntry(entry.id);
                          const conversationLabel =
                            entry.type === "email" ? "email"
                            : entry.type === "slack_message" ? "Slack thread"
                            : entry.type === "sms_message" ? "text exchange"
                            : "conversation";
                          const titleText = chatMatch
                            ? "Reopen this past Deal Chat in the side panel"
                            : `Chat with Mikey focused on this ${conversationLabel}, with the rest of the deal as background`;
                          return (
                            <div className="flex items-center gap-2 flex-wrap mt-1 mb-2">
                              <button
                                type="button"
                                onClick={onClickAction}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100"
                                title={titleText}
                              >
                                {label}
                              </button>
                            </div>
                          );
                        })()}
                        {editingEntryId === entry.id ? (
                          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 space-y-2" data-no-toggle>
                            <div className="grid grid-cols-1 sm:grid-cols-[160px,1fr] gap-2">
                              <label className="text-[11px] uppercase tracking-wider text-gray-400 font-medium self-center">Type</label>
                              <select
                                value={editEntryDraft.type}
                                onChange={(e) => setEditEntryDraft((d) => ({ ...d, type: e.target.value }))}
                                className="text-sm px-2 py-1 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500"
                              >
                                {ENTRY_TYPES.map((t) => (
                                  <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>
                                ))}
                              </select>
                              <label className="text-[11px] uppercase tracking-wider text-gray-400 font-medium self-center">Title</label>
                              <input
                                type="text"
                                value={editEntryDraft.title}
                                onChange={(e) => setEditEntryDraft((d) => ({ ...d, title: e.target.value }))}
                                placeholder="Optional title…"
                                className="text-sm px-2 py-1 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500"
                              />
                              <label className="text-[11px] uppercase tracking-wider text-gray-400 font-medium self-center">Source URL</label>
                              <input
                                type="url"
                                value={editEntryDraft.sourceUrl}
                                onChange={(e) => setEditEntryDraft((d) => ({ ...d, sourceUrl: e.target.value }))}
                                placeholder="https://…"
                                className="text-sm px-2 py-1 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] uppercase tracking-wider text-gray-400 font-medium block mb-1">Content</label>
                              <textarea
                                value={editEntryDraft.content}
                                onChange={(e) => setEditEntryDraft((d) => ({ ...d, content: e.target.value }))}
                                rows={Math.min(20, Math.max(6, editEntryDraft.content.split("\n").length + 2))}
                                className="w-full text-sm px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500 font-mono"
                              />
                              <div className="text-[10px] text-gray-400 mt-0.5">{editEntryDraft.content.length.toLocaleString()} chars · markdown supported</div>
                            </div>
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={cancelEditEntry}
                                className="text-xs px-3 py-1.5 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 font-medium"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => saveEditEntry(entry.id)}
                                disabled={savingEntryEdit || !editEntryDraft.content.trim()}
                                className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-md inline-flex items-center gap-1.5"
                              >
                                {savingEntryEdit && (
                                  <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                )}
                                {savingEntryEdit ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </div>
                        ) : (() => {
                          const isExpanded = expandedEntries.has(entry.id);
                          const isShort = entry.content.length <= 200;
                          // Entry types whose content originates as
                          // plain text from a calendar invite, email
                          // thread, Slack DM, SMS thread, or LinkedIn
                          // message preserve every newline — markdown
                          // otherwise collapses isolated single \n into
                          // a space, which destroys bulleted invite
                          // bodies. Call summaries / transcripts / notes
                          // / documents already format with proper
                          // markdown paragraphs, so we leave those alone
                          // (the regex would otherwise add blank lines
                          // inside code-block fences and tighten lists).
                          // Also decode HTML entities (&#39; → ', etc.)
                          // up front so older imports that stored them
                          // raw render correctly without a backfill.
                          const PRESERVE_LINEBREAKS = new Set(["meeting", "email", "slack_message", "sms_message", "linkedin"]);
                          const renderContent = (() => {
                            const decoded = decodeHtmlEntities(entry.content);
                            if (PRESERVE_LINEBREAKS.has(entry.type)) {
                              return decoded.replace(/(?<!\n)\n(?!\n)/g, "\n\n");
                            }
                            return decoded;
                          })();
                          if (isShort) {
                            return (
                              <div className="text-sm text-gray-700 dark:text-gray-200 mt-1">
                                <EntryMarkdown>{renderContent}</EntryMarkdown>
                              </div>
                            );
                          }
                          return (
                            <>
                              <div className="text-xs text-purple-600 inline-flex items-center gap-1 select-none">
                                <svg
                                  className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                {isExpanded ? "Hide content" : `Show full content (${entry.content.length.toLocaleString()} chars)`}
                              </div>
                              {isExpanded && (
                                <div className="text-sm text-gray-700 dark:text-gray-200 mt-2 pt-2 border-t border-gray-100">
                                  <EntryMarkdown>{renderContent}</EntryMarkdown>
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {(() => {
                          // If this entry was created from a voice
                          // recording, surface the raw whisper
                          // transcript behind a click — useful for
                          // the user to verify the synthesizer didn't
                          // drop something.
                          let rawTranscript: string | null = null;
                          if (entry.metadata) {
                            try {
                              const parsed = JSON.parse(entry.metadata);
                              if (typeof parsed?.rawVoiceTranscript === "string" && parsed.rawVoiceTranscript.trim()) {
                                rawTranscript = parsed.rawVoiceTranscript.trim();
                              }
                            } catch { /* ignore */ }
                          }
                          if (!rawTranscript) return null;
                          const open = revealedTranscripts.has(entry.id);
                          return (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => setRevealedTranscripts((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(entry.id)) next.delete(entry.id);
                                  else next.add(entry.id);
                                  return next;
                                })}
                                className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 hover:underline inline-flex items-center gap-1"
                              >
                                <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                {open ? "Hide raw transcript" : "Show raw voice transcript"}
                              </button>
                              {open && (
                                <div className="mt-1 p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-mono">
                                  {rawTranscript}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
            </div>
          </div>
        </div>
      </div>

      <BulkImportCallsModal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        dealId={id}
        dealName={deal.name}
        onImported={() => loadDeal()}
      />
      <DealChatPanel
        open={chatPanelOpen}
        onClose={closeChatPanel}
        onOpen={startDealChat}
        autoSendQuestion={autoSendQuestion}
        autoSendNonce={autoSendNonce}
        threads={deal.entries
          .filter((e) => e.type === "chat" && e.sourceUrl)
          .map((e) => {
            const match = e.sourceUrl!.match(/^\/chat\/([^/?#]+)/);
            if (!match) return null;
            // The breadcrumb content is typically
            //   Started a conversation: "What should I do next?"
            // Pull the question out; fall back to the first line of content.
            const qMatch = e.content.match(/Started a conversation:\s*"([\s\S]*?)"/);
            const label = qMatch
              ? qMatch[1]
              : (e.content.split("\n")[0] || "Deal Chat").slice(0, 60);
            return {
              conversationId: match[1],
              label,
              timestamp: e.entryDate,
            };
          })
          .filter((t): t is { conversationId: string; label: string; timestamp: string } => t !== null)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())}
        onSelectThread={(convId) => {
          if (convId) {
            openChatPanelForConversation(convId);
          } else {
            setFocusedEntryId(null);
            setPanelConversationId(null);
            syncChatUrl(null);
          }
        }}
        dealName={deal.name}
        buildContext={(question) => {
          const focused = focusedEntryId ? deal.entries.find((e) => e.id === focusedEntryId) : undefined;
          return buildDealChatContext({ question, focusedEntry: focused });
        }}
        conversationId={panelConversationId}
        onConversationCreated={(convId, firstQuestion) => {
          setPanelConversationId(convId);
          syncChatUrl(convId);
          // Leave a timeline breadcrumb so the deal history shows the chat
          // was started, matching the previous new-tab flow's behavior.
          addEntry({
            type: "chat",
            title: `Deal Chat: ${deal.name}`,
            content: firstQuestion
              ? `Started a conversation: "${firstQuestion}"`
              : `Started a conversation about this deal.`,
            sourceUrl: `/chat/${convId}`,
          } as Partial<TimelineEntry>).catch((err) =>
            console.error("Failed to leave chat breadcrumb:", err)
          );
        }}
      />
    </div>
  );
}

function EntryParticipantPicker({
  available,
  onPick,
}: {
  available: Participant[];
  onPick: (participantId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-[11px] text-gray-500 hover:text-purple-700 hover:border-purple-300 hover:bg-purple-50"
        title="Attach an existing deal participant to this entry"
      >
        + Add
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[180px] max-h-64 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
          {available.map((p) => {
            const nameLabel = p.name.includes("@") ? (nameFromEmail(p.name) || p.name) : titleCase(p.name);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPick(p.id);
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">{nameLabel}</div>
                {(p.title || p.company) && (
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                    {[p.title, p.company].filter(Boolean).join(" · ")}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
