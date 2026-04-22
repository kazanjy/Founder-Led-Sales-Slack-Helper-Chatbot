"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import SalesNavBar from "@/components/SalesNavBar";
import MeetingRecorderPanel from "@/components/MeetingRecorderPanel";
import DealChatPanel from "@/components/DealChatPanel";
import { DEAL_STAGES, DEAL_STATUSES, PARTICIPANT_ROLES, ENTRY_TYPES, getStageInfo, getStatusInfo, getRoleInfo, getEntryTypeInfo } from "@/lib/deals/constants";

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

function buildHeading(level: 2 | 3) {
  const Tag = level === 2 ? "h2" : "h3";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function HeadingWithAnchor({ children }: { children?: any }) {
    const text = extractText(children).trim();
    const id = `analysis-${slugify(text || "section")}`;
    return (
      <Tag id={id} className="scroll-mt-20 not-prose flex items-baseline gap-2 mt-6 mb-2 first:mt-0">
        <span className={level === 2 ? "text-lg font-bold text-gray-900" : "text-base font-semibold text-gray-900"}>
          {children}
        </span>
        <CopyLinkButton id={id} label={text || "this section"} />
      </Tag>
    );
  };
}

const analysisMarkdownComponents = {
  h1: buildHeading(2),
  h2: buildHeading(2),
  h3: buildHeading(3),
};

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
  const [newEntryType, setNewEntryType] = useState<string>("note");
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
  const [editDateValue, setEditDateValue] = useState("");
  const [enrichingAll, setEnrichingAll] = useState(false);
  const autoEnrichAttempted = useRef(false);
  const autoAnalyzeAttempted = useRef(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [panelConversationId, setPanelConversationId] = useState<string | null>(null);
  const [focusedEntryId, setFocusedEntryId] = useState<string | null>(null);
  const [askMikeyPrompt, setAskMikeyPrompt] = useState("");
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [timelineTypeFilter, setTimelineTypeFilter] = useState<Set<string>>(new Set());
  const [timelineQuery, setTimelineQuery] = useState<string>("");

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
  }, [loadDeal]);

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
      analyzeDeal({ silent: true });
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
      // downstream analysis knows who this entry references.
      const linkedIds = !entryData
        ? [...screenshotMatched.map((p) => p.id), ...createdIds]
        : [];
      const metadata = linkedIds.length > 0 ? { linkedParticipantIds: linkedIds } : undefined;

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
        // Snapshot Ask Mikey fields before clearing form state.
        const mikeyQuestion = !entryData ? askMikeyPrompt.trim() : "";
        const snapshotEntry = !entryData && mikeyQuestion
          ? {
              type,
              title: title || null,
              content,
              entryDate: entryDate ?? undefined,
            }
          : null;

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
        await loadDeal();

        // If the user typed an Ask Mikey prompt alongside the entry, fire off
        // a chat conversation in a new tab with the just-added entry + their
        // question as the first message. Runs in parallel with re-analysis.
        if (snapshotEntry && mikeyQuestion) {
          openDealChat({
            extraEntry: snapshotEntry,
            question: mikeyQuestion,
            openInNewTab: true,
            leaveBreadcrumb: true,
          }).catch((err) => console.error("Failed to open Ask Mikey chat:", err));
        }

        // Re-run analysis now that the timeline has new data. Show the
        // analysis card with its spinner, and scroll to it when the run
        // completes so the user lands on the fresh result.
        // Skip if already analyzing; the running pass will include fresh data anyway.
        if (!analyzing) analyzeDeal({ scrollToResult: true });
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
      const focusedContent = focused.content.length > 6000
        ? focused.content.substring(0, 6000) + "\n[...truncated]"
        : focused.content;
      sections.push(focusedContent);
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
    // above, so re-including it just wastes tokens.
    const timelineEntries = focused
      ? deal.entries.filter((e) => e.id !== focused.id)
      : deal.entries;
    if (timelineEntries.length > 0) {
      sections.push(focused ? "## Timeline of Interactions (other entries)" : "## Timeline of Interactions");
      for (const entry of timelineEntries.slice(0, 15)) {
        const date = formatEntryDate(entry.entryDate);
        const typeInfo = getEntryTypeInfo(entry.type);
        sections.push(`### ${date} — ${typeInfo.label}${entry.title ? `: ${entry.title}` : ""}`);
        const content = entry.content.length > 2000
          ? entry.content.substring(0, 2000) + "\n[...truncated]"
          : entry.content;
        sections.push(content);
        sections.push("");
      }
    }

    if (opts?.extraEntry) {
      const ex = opts.extraEntry;
      const typeInfo = getEntryTypeInfo(ex.type);
      const when = ex.entryDate ? formatEntryDate(ex.entryDate) : formatEntryDate(new Date().toISOString());
      sections.push("## Just Added");
      sections.push(`### ${when} — ${typeInfo.label}${ex.title ? `: ${ex.title}` : ""}`);
      sections.push(ex.content.length > 3000 ? ex.content.substring(0, 3000) + "\n[...truncated]" : ex.content);
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

  const openDealChat = async (opts?: {
    question?: string;
    extraEntry?: { type: string; title?: string | null; content: string; entryDate?: string | null };
    leaveBreadcrumb?: boolean;
    openInNewTab?: boolean;
  }): Promise<string | null> => {
    if (!deal) return null;
    const context = buildDealChatContext({ extraEntry: opts?.extraEntry, question: opts?.question });
    const res = await fetch("/api/conversations/from-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Deal: ${deal.name}`,
        context,
        autoSend: true,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.conversationId) return null;

    if (opts?.leaveBreadcrumb) {
      // Best-effort: timeline entry pointing back to the conversation.
      await addEntry({
        type: "chat",
        title: `Chat: ${deal.name}`,
        content: opts.question?.trim()
          ? `Started a conversation: "${opts.question.trim()}"`
          : `Started a conversation about this deal.`,
        sourceUrl: `/chat/${data.conversationId}`,
      } as Partial<TimelineEntry>);
    }

    // Hand the context off to the chat page via the established autoSend
    // mechanism (same pattern sales-readiness / coaching-history use):
    // sessionStorage key `autoSend-{id}` holds the first message, URL gets
    // `?autoSend=true`, and the chat page's useEffect picks both up and
    // sends the message on load. Without this, /chat/{id} shows the default
    // welcome screen and the prompt is lost.
    const autoSendPayload = typeof data.autoSendContext === "string" && data.autoSendContext
      ? data.autoSendContext
      : context;
    try {
      sessionStorage.setItem(`autoSend-${data.conversationId}`, autoSendPayload);
    } catch { /* quota / privacy modes — best-effort */ }

    const chatUrl = `/chat/${data.conversationId}?autoSend=true`;
    if (opts?.openInNewTab) {
      window.open(chatUrl, "_blank");
    } else {
      router.push(chatUrl);
    }
    return data.conversationId as string;
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
              }
            : prev,
        );
        // Invalidate cached history so the next open re-fetches with the new run.
        setAnalysisHistory(null);
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
        const ALLOWED_DETECTED = new Set(["email", "chat", "linkedin", "screenshot"]);
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
          <p className="text-gray-500">Deal not found.</p>
          <Link href="/deals" className="text-purple-600 hover:underline mt-2 inline-block">← Back to Deals</Link>
        </div>
      </div>
    );
  }

  const stageInfo = getStageInfo(deal.stage);
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link href="/deals" className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            All Deals
          </Link>
          <Link
            href="/deals?new=1"
            className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg text-xs font-medium shadow hover:shadow-md transition-all inline-flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Deal
          </Link>
        </div>

        {/* Header */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              {editingMeta ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={metaName}
                    onChange={(e) => setMetaName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg font-semibold focus:ring-2 focus:ring-purple-500"
                    placeholder="Deal name"
                  />
                  <input
                    type="text"
                    value={metaCompanyName}
                    onChange={(e) => setMetaCompanyName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
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
                    <button onClick={() => setEditingMeta(false)} className="px-3 py-1.5 text-gray-600 text-sm hover:bg-gray-100 rounded-lg">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setMetaName(deal.name); setMetaCompanyName(deal.companyName); setEditingMeta(true); }}
                  className="text-left group/title"
                >
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900 group-hover/title:text-purple-700 transition-colors">{deal.name}</h1>
                  <p className="text-sm text-gray-500 mt-0.5">{deal.companyName}</p>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={deal.stage}
                onChange={(e) => updateDeal({ stage: e.target.value })}
                className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${stageInfo.color}`}
              >
                {DEAL_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <select
                value={deal.status}
                onChange={(e) => updateDeal({ status: e.target.value })}
                className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${statusInfo.color}`}
              >
                {DEAL_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
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
                className="px-3 py-1.5 bg-white border border-purple-300 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-50 flex items-center gap-1.5"
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
        </div>

        {/* Analysis panel */}
        {deal.lastAnalysis && (
          <div ref={analysisCardRef} className="bg-white border border-purple-200 rounded-xl mb-5 scroll-mt-4">
            <button
              onClick={() => setShowAnalysis(!showAnalysis)}
              className="w-full flex items-center justify-between px-5 py-3 text-left"
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
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${showAnalysis ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showAnalysis && (
              <div className="px-5 pb-5 border-t border-purple-100">
                <div className="mt-3 flex items-center gap-4">
                  <button
                    onClick={() => analyzeDeal()}
                    disabled={analyzing}
                    className="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1"
                  >
                    {analyzing ? "Analyzing..." : "↻ Re-analyze"}
                  </button>
                  <button
                    onClick={toggleAnalysisHistory}
                    className="text-xs text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1"
                  >
                    {showHistory ? "Hide history" : "View history"}
                    {analysisHistory && analysisHistory.length > 1 && (
                      <span className="text-gray-400">({analysisHistory.length - 1} previous)</span>
                    )}
                  </button>
                </div>
                <div className="prose prose-sm max-w-none text-gray-700 mt-3">
                  <ReactMarkdown components={analysisMarkdownComponents}>{deal.lastAnalysis}</ReactMarkdown>
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
                          <div key={item.id} className="border border-gray-200 rounded-lg">
                            <button
                              onClick={() => setExpandedHistoryId(isOpen ? null : item.id)}
                              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50"
                            >
                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-gray-700 font-medium">{when}</span>
                                {item.stage && (
                                  <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
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
                                <div className="prose prose-sm max-w-none text-gray-700 mt-2">
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
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          {/* Participants sidebar */}
          <div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Participants ({sortedParticipants.length})</h3>
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
                  <input type="text" value={newParticipantName} onChange={(e) => setNewParticipantName(e.target.value)} placeholder="Name" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" autoFocus />
                  <input type="text" value={newParticipantTitle} onChange={(e) => setNewParticipantTitle(e.target.value)} placeholder="Title (optional)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
                  <input type="email" value={newParticipantEmail} onChange={(e) => setNewParticipantEmail(e.target.value)} placeholder="Email (optional)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
                  <select value={newParticipantRole} onChange={(e) => setNewParticipantRole(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                    {PARTICIPANT_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={addParticipant} disabled={!newParticipantName.trim()} className="px-2.5 py-1 bg-purple-600 text-white rounded text-xs font-medium disabled:opacity-50">Add</button>
                    <button onClick={() => setShowAddParticipant(false)} className="px-2.5 py-1 text-gray-600 text-xs hover:bg-gray-100 rounded">Cancel</button>
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
                    <div key={p.id} className="border border-gray-200 rounded-lg p-2.5 group/p">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm text-gray-900 truncate">{displayName(p.name, p.email)}</span>
                            {(() => {
                              const mentions = mentionCounts.get(p.id) || 0;
                              if (mentions === 0) return null;
                              const intensity = mentions >= 4 ? "bg-purple-100 text-purple-700" : mentions >= 2 ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600";
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
                              <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 flex-shrink-0" title="LinkedIn">
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
                                className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-purple-500"
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
                                  <div className="text-xs text-gray-500 truncate group-hover/title:text-purple-600 transition-colors">{titleCase(p.title)}{p.company ? ` @ ${titleCase(p.company)}` : ""}</div>
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
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">New entry:</span>
                {ENTRY_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setNewEntryType(t.value)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${newEntryType === t.value ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={newEntryTitle}
                onChange={(e) => setNewEntryTitle(e.target.value)}
                placeholder="Title (optional)"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 mb-2"
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
                  placeholder="Paste, drop, or type content — call transcript, email, notes, screenshots, PDFs..."
                  rows={4}
                  className="w-full px-3 py-2 pr-3 pb-10 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 resize-y"
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
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-purple-200 text-xs text-purple-800"
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
                                : "bg-white text-gray-600 border-gray-200 hover:border-purple-300 hover:text-purple-700"
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
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 mb-2"
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
                  <label className="text-xs text-gray-500">Date:</label>
                  <input
                    type="date"
                    value={newEntryDate}
                    onChange={(e) => setNewEntryDate(e.target.value)}
                    className={`px-2 py-1.5 border rounded-lg text-xs text-gray-600 focus:ring-2 focus:ring-purple-500 ${entryFromScreenshot && !newEntryDate ? "border-red-400 ring-1 ring-red-200" : "border-gray-200"}`}
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
                defaultCollapsed={deal.entries.length > 0}
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

                const filteredEntries = deal.entries.filter((e) => {
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
                        <h3 className="text-sm font-semibold text-gray-700">
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
                      </div>
                      {deal.entries.length > 0 && visibleTypes.length > 1 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => setTimelineTypeFilter(new Set())}
                            className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                              !hasTypeFilter
                                ? "bg-gray-900 text-white"
                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
                                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
                          className="w-full pl-8 pr-8 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
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
                      <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center">
                        <p className="text-sm text-gray-500">No entries yet. Add one above or import a call from your meeting recorder.</p>
                      </div>
                    ) : filteredEntries.length === 0 ? (
                      <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center">
                        <p className="text-sm text-gray-500">
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
                                // Skip the toggle if the click came from any
                                // interactive element inside the card (icons,
                                // chips, CTAs, inputs, anchors).
                                const target = e.target as HTMLElement;
                                if (target.closest("button, a, input, select, textarea, summary, [data-no-toggle]")) return;
                                setExpandedEntries((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(entry.id)) next.delete(entry.id);
                                  else next.add(entry.id);
                                  return next;
                                });
                              }}
                              className="bg-white border border-gray-200 rounded-xl p-4 group/e scroll-mt-20 cursor-pointer hover:border-gray-300 transition-colors"
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
                            {entry.title && <div className="font-semibold text-gray-900 text-sm">{entry.title}</div>}
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
                              if (linked.length === 0) return null;
                              return (
                                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">With</span>
                                  {linked.map((p) => {
                                    const nameLabel = p.name.includes("@") ? (nameFromEmail(p.name) || p.name) : titleCase(p.name);
                                    return (
                                      <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => setTimelineQuery(nameLabel)}
                                        title={`Filter timeline to ${nameLabel}`}
                                        className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-[11px] text-purple-700 hover:bg-purple-100"
                                      >
                                        {nameLabel}
                                      </button>
                                    );
                                  })}
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
                        {(entry.type === "email" || entry.type === "chat") && (
                          <div className="flex items-center gap-2 flex-wrap mt-1 mb-2">
                            <button
                              type="button"
                              onClick={() => startChatWithEntry(entry.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100"
                              title={`Chat with Mikey focused on this ${entry.type === "email" ? "email" : "conversation"}, with the rest of the deal as background`}
                            >
                              🌊 Chat With This
                            </button>
                          </div>
                        )}
                        {(() => {
                          const isExpanded = expandedEntries.has(entry.id);
                          const isShort = entry.content.length <= 200;
                          if (isShort) {
                            return (
                              <div className="text-sm text-gray-700 whitespace-pre-wrap mt-1">
                                {entry.content}
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
                                <div className="text-sm text-gray-700 whitespace-pre-wrap mt-2 pt-2 border-t border-gray-100">
                                  {entry.content}
                                </div>
                              )}
                            </>
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

      <DealChatPanel
        open={chatPanelOpen}
        onClose={closeChatPanel}
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
            title: `Chat: ${deal.name}`,
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
