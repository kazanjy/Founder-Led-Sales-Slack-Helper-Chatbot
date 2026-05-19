"use client";

import { useState, useEffect, useRef, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyMarkdownAsRichText } from "@/lib/clipboard";
import { useConfirmModal } from "@/components/useConfirmModal";
import SalesNavBar from "@/components/SalesNavBar";
import { ShareDocumentButton } from "@/components/ShareDocumentButton";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { ChatAboutButton } from "@/components/ChatAboutButton";

interface ResearchBrief {
  id: string;
  companyName: string;
  contactName?: string;
  contactTitle?: string;
  contactEmail?: string | null;
  contactLinkedIn?: string | null;
  content: string;
  sources: { title: string; url: string }[];
  createdAt: string;
}

interface HistoryItem {
  id: string;
  companyName: string;
  contactName?: string;
  contactTitle?: string;
  source: string;
  createdAt: string;
}

interface ProgressUpdate {
  stage: string;
  message: string;
  progress: number;
}

export default function PreCallResearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    }>
      <ResearchContent />
    </Suspense>
  );
}

function ResearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [researching, setResearching] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [hasPreCallPlanning, setHasPreCallPlanning] = useState(false);
  const { alert: showAlert, ConfirmModalElement } = useConfirmModal();

  // Form state
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [contactLinkedIn, setContactLinkedIn] = useState("");
  const [urls, setUrls] = useState("");

  // Google Calendar integration state
  interface UpcomingEvent {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string | null;
    meetingUrl: string | null;
    eventUrl: string | null;
    prefill: {
      companyName: string;
      contactName: string;
      contactTitle: string;
      contactLinkedIn: string;
      companyUrl: string;
    };
    attendees: Array<{ email: string; name: string | null; external: boolean }>;
  }
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  // 'external' default keeps the panel focused on sales calls — events
  // with at least one attendee whose email domain ≠ the user's own.
  const [calendarFilter, setCalendarFilter] = useState<"external" | "all">("external");
  // Free-text filter applied client-side after the API response —
  // matches the user's typed query against event title, prefilled
  // company name, and any attendee name/email. Persists until the
  // user clears it via the X button or refreshes the page.
  const [calendarSearch, setCalendarSearch] = useState("");
  // How far ahead to fetch; grows by 14 days each time the user
  // clicks "Load more meetings". Limit grows in tandem.
  const [calendarDays, setCalendarDays] = useState(14);
  const [calendarLimit, setCalendarLimit] = useState(10);
  const [calendarHasMore, setCalendarHasMore] = useState(false);
  // Per-tile spinner while we run PDL enrichment on the selected event.
  const [enrichingEventId, setEnrichingEventId] = useState<string | null>(null);
  // PDL enrichment outcome per event so we can show "Enriched N of M
  // from PDL" on the tile after a click. Keyed by event.id.
  interface EnrichmentResult { pdlHits: number; total: number; companyFallback: boolean }
  const [enrichmentResults, setEnrichmentResults] = useState<Record<string, EnrichmentResult>>({});

  // Slack send-to-channel state. Lists are fetched lazily the first
  // time the dropdown opens so we don't make every brief view do a
  // Slack API call.
  interface SlackChannel { id: string; name: string; isMember?: boolean; isPrivate?: boolean }
  const [slackPickerOpen, setSlackPickerOpen] = useState(false);
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([]);
  const [slackChannelsLoaded, setSlackChannelsLoaded] = useState(false);
  const [slackChannelsError, setSlackChannelsError] = useState<string | null>(null);
  const [slackChannelFilter, setSlackChannelFilter] = useState("");
  const [sendingToSlack, setSendingToSlack] = useState(false);
  const [slackSentTarget, setSlackSentTarget] = useState<string | null>(null);
  // From /api/auth/me: whether the user has a Slack DM available
  // and their saved preferred channel.
  const [hasSlackDm, setHasSlackDm] = useState(false);
  const [preferredChannelId, setPreferredChannelId] = useState<string | null>(null);
  const [preferredChannelName, setPreferredChannelName] = useState<string | null>(null);
  // Toggles into channel-picker mode inside the dropdown (otherwise
  // the panel shows the two-option summary view).
  const [slackPickingChannel, setSlackPickingChannel] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const loadBriefById = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/pre-call-planning/research/${id}`);
      if (!response.ok) throw new Error("Failed to load");
      const data = await response.json();
      setBrief({
        id: data.research.id,
        companyName: data.research.companyName,
        contactName: data.research.contactName,
        contactTitle: data.research.contactTitle,
        contactEmail: data.research.contactEmail ?? null,
        contactLinkedIn: data.research.contactLinkedIn ?? null,
        content: data.research.content,
        sources: data.research.sources as { title: string; url: string }[],
        createdAt: data.research.createdAt,
      });
    } catch (error) {
      console.error("Error loading brief:", error);
    }
  }, []);

  useEffect(() => {
    document.title = "Pre-Call Research - Mikey";
  }, []);

  // Load history and check if planning process exists
  useEffect(() => {
    async function loadData() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }
        setCalendarConnected(!!authData.user.googleCalendarConnected);
        setHasSlackDm(!!authData.user.hasSlackDm);
        setPreferredChannelId(authData.user.preferredResearchSlackChannelId || null);
        setPreferredChannelName(authData.user.preferredResearchSlackChannelName || null);

        // Check if user has generated their planning process
        const pcpRes = await fetch("/api/pre-call-planning/latest");
        if (pcpRes.ok) {
          const pcpData = await pcpRes.json();
          setHasPreCallPlanning(!!pcpData.hasPreCallPlanning);
        }

        const historyRes = await fetch("/api/pre-call-planning/research/history");
        if (historyRes.ok) {
          const data = await historyRes.json();
          setHistory(data.researches || []);
        }

        // Auto-load brief from URL param
        const idFromUrl = searchParams.get("id");
        if (idFromUrl) {
          loadBriefById(idFromUrl);
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router, searchParams, loadBriefById]);

  // Pull upcoming Google Calendar events once we know the user is
  // connected. Quietly noop on 403 (token revoked between auth check
  // and fetch) — the panel just stays empty.
  useEffect(() => {
    if (!calendarConnected) return;
    let cancelled = false;
    (async () => {
      setLoadingUpcoming(true);
      try {
        const res = await fetch(
          `/api/google-calendar/upcoming?filter=${calendarFilter}&days=${calendarDays}&limit=${calendarLimit}`
        );
        if (!res.ok) {
          if (res.status === 403) setCalendarConnected(false);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setUpcomingEvents(data.events || []);
          setCalendarHasMore(!!data.hasMore);
        }
      } catch (err) {
        console.error("[research] Failed to load calendar:", err);
      } finally {
        if (!cancelled) setLoadingUpcoming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [calendarConnected, calendarFilter, calendarDays, calendarLimit]);

  // Reset pagination when the filter flips so users don't get a
  // stale window mismatched with the filter.
  useEffect(() => {
    setCalendarDays(14);
    setCalendarLimit(10);
  }, [calendarFilter]);

  const loadMoreCalendar = () => {
    setCalendarDays((d) => Math.min(d + 14, 180));
    setCalendarLimit((l) => Math.min(l + 10, 100));
  };

  const prefillFromEvent = (event: UpcomingEvent) => {
    if (event.prefill.companyName) setCompanyName(event.prefill.companyName);
    if (event.prefill.contactName) setContactName(event.prefill.contactName);
    if (event.prefill.contactTitle) setContactTitle(event.prefill.contactTitle);
    if (event.prefill.contactLinkedIn) setContactLinkedIn(event.prefill.contactLinkedIn);
    if (event.prefill.companyUrl) setUrls(event.prefill.companyUrl);
  };

  // Click handler for an upcoming-call tile: do the cheap
  // domain-based prefill first so the form fields snap in
  // immediately, then run PDL enrichment on the external attendees
  // and overwrite with richer name/title/company/LinkedIn when PDL
  // returns useful data.
  const selectEvent = async (event: UpcomingEvent) => {
    prefillFromEvent(event);
    if (event.attendees.length === 0 || enrichingEventId) return;
    setEnrichingEventId(event.id);
    try {
      const res = await fetch("/api/google-calendar/enrich-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendees: event.attendees }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        prefill: {
          companyName: string;
          contactName: string;
          contactTitle: string;
          contactLinkedIn: string;
          companyUrl: string;
        } | null;
        pdlHits?: number;
        companyFallback?: boolean;
      };
      setEnrichmentResults((prev) => ({
        ...prev,
        [event.id]: {
          pdlHits: data.pdlHits ?? 0,
          total: event.attendees.length,
          companyFallback: !!data.companyFallback,
        },
      }));
      if (!data.prefill) return;
      if (data.prefill.companyName) setCompanyName(data.prefill.companyName);
      if (data.prefill.contactName) setContactName(data.prefill.contactName);
      if (data.prefill.contactTitle) setContactTitle(data.prefill.contactTitle);
      if (data.prefill.contactLinkedIn) setContactLinkedIn(data.prefill.contactLinkedIn);
      if (data.prefill.companyUrl) setUrls(data.prefill.companyUrl);

      // If PDL actually returned a person hit, auto-fire research
      // with the enriched inputs (bypassing state-update timing). The
      // user typed nothing — clicking a calendar tile + PDL hitting
      // is enough intent to start work immediately.
      const pdlHits = data.pdlHits ?? 0;
      const primaryAttendee = event.attendees[0];
      if (pdlHits > 0 && data.prefill.companyName) {
        await runResearchWithInputs({
          companyName: data.prefill.companyName,
          contactName: data.prefill.contactName,
          contactTitle: data.prefill.contactTitle,
          contactLinkedIn: data.prefill.contactLinkedIn,
          contactEmail: primaryAttendee?.email || undefined,
          urls: data.prefill.companyUrl,
        });
      }
    } catch (err) {
      console.error("[research] PDL enrichment failed:", err);
    } finally {
      setEnrichingEventId(null);
    }
  };

  // Inner research runner: takes explicit input values so callers can
  // bypass the React state-update timing problem (auto-firing right
  // after setCompanyName etc. would otherwise read stale state).
  const runResearchWithInputs = async (inputs: {
    companyName: string;
    contactName?: string;
    contactTitle?: string;
    contactLinkedIn?: string;
    contactEmail?: string;
    urls?: string;
  }) => {
    if (!inputs.companyName.trim()) {
      await showAlert({
        title: "Company Required",
        message: "Please enter a company name to research.",
        variant: "danger",
      });
      return;
    }

    setResearching(true);
    setProgress({ stage: "parsing", message: "Starting research...", progress: 5 });
    setBrief(null);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const homepageUrl = (inputs.urls || "").trim();

      const response = await fetch("/api/pre-call-planning/research-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: inputs.companyName.trim(),
          contactName: inputs.contactName?.trim() || undefined,
          contactTitle: inputs.contactTitle?.trim() || undefined,
          contactLinkedIn: inputs.contactLinkedIn?.trim() || undefined,
          contactEmail: inputs.contactEmail?.trim() || undefined,
          urls: homepageUrl ? [homepageUrl] : undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `Research failed (${response.status})`;
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } catch {
          // Response may not be JSON (e.g. 405 with empty body)
        }
        throw new Error(errorMessage);
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const lines = event.split("\n");
          let eventType = "";
          let eventData = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            if (line.startsWith("data: ")) eventData = line.slice(6);
          }

          if (!eventType || !eventData) continue;

          try {
            const parsed = JSON.parse(eventData);

            if (eventType === "content_chunk") {
              // Stream content as it arrives — hide progress overlay
              setProgress(null);
              setStreamingContent((prev) => prev + (parsed.token || ""));
            } else if (eventType === "progress") {
              setProgress(parsed);
            } else if (eventType === "complete") {
              setBrief(parsed);
              setProgress(null);
              setStreamingContent("");
              // Update URL with the new brief ID
              router.replace(`/pre-call-planning/research?id=${parsed.id}`, { scroll: false });
              // Add to history
              setHistory((prev) => [
                {
                  id: parsed.id,
                  companyName: parsed.companyName,
                  contactName: parsed.contactName,
                  source: "web",
                  createdAt: parsed.createdAt,
                },
                ...prev,
              ]);
            } else if (eventType === "error") {
              throw new Error(parsed.message);
            }
          } catch (parseError) {
            if (parseError instanceof SyntaxError) continue;
            throw parseError;
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      console.error("Research error:", error);
      setProgress(null);
      await showAlert({
        title: "Research Failed",
        message: (error as Error).message || "Failed to complete research. Please try again.",
        variant: "danger",
      });
    } finally {
      setResearching(false);
      abortRef.current = null;
    }
  };

  const fetchSlackChannelsIfNeeded = async () => {
    if (slackChannelsLoaded) return;
    try {
      const res = await fetch("/api/slack/my-channels");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSlackChannelsError(data.error === "no_workspace" ? "no_workspace" : "fetch_failed");
        return;
      }
      const data = await res.json();
      setSlackChannels(data.channels || []);
      setSlackChannelsError(null);
    } catch (err) {
      console.error("[slack] channel list failed:", err);
      setSlackChannelsError("fetch_failed");
    } finally {
      setSlackChannelsLoaded(true);
    }
  };

  // Open/close the Slack panel. Channel list is fetched only when
  // the user actually enters picking mode.
  const openSlackPicker = () => {
    setSlackPickerOpen((prev) => !prev);
    setSlackSentTarget(null);
    setSlackPickingChannel(false);
  };

  // Posts the brief to the chosen destination. `target` keys the
  // success badge so the user sees which option lit up.
  const sendBriefToSlack = async (
    payload: { destination: "dm" | "channel"; channelId?: string; channelName?: string; saveAsPreferred?: boolean },
    target: string
  ) => {
    if (!brief || sendingToSlack) return;
    setSendingToSlack(true);
    try {
      const res = await fetch(
        `/api/pre-call-planning/research/${brief.id}/send-to-slack`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await showAlert({
          title: "Slack post failed",
          message: data.error || "Could not post to Slack. Try a different channel.",
          variant: "danger",
        });
        return;
      }
      setSlackSentTarget(target);
      if (payload.saveAsPreferred && payload.channelId) {
        setPreferredChannelId(payload.channelId);
        setPreferredChannelName(payload.channelName || null);
      }
      setTimeout(() => {
        setSlackPickerOpen(false);
        setSlackPickingChannel(false);
      }, 1500);
    } catch (err) {
      console.error("[slack] send failed:", err);
      await showAlert({
        title: "Slack post failed",
        message: "Network error. Please try again.",
        variant: "danger",
      });
    } finally {
      setSendingToSlack(false);
    }
  };

  // Wipe the saved channel preference so the user is asked to pick
  // again next time.
  const clearPreferredSlackChannel = async () => {
    try {
      await fetch("/api/user/research-slack-channel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: null }),
      });
    } catch (err) {
      console.error("[slack] clear preference failed:", err);
    }
    setPreferredChannelId(null);
    setPreferredChannelName(null);
    setSlackPickingChannel(true);
    fetchSlackChannelsIfNeeded();
  };

  // Thin wrapper for the "Research Prospect" button: reads from form
  // state and delegates to runResearchWithInputs.
  const handleResearch = () =>
    runResearchWithInputs({
      companyName,
      contactName,
      contactTitle,
      contactLinkedIn,
      urls,
    });

  const handleLoadBrief = async (id: string) => {
    router.replace(`/pre-call-planning/research?id=${id}`, { scroll: false });
    await loadBriefById(id);
  };

  const handleCopy = async () => {
    if (!brief) return;
    const success = await copyMarkdownAsRichText(brief.content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // PDL returns names / titles / companies in lowercase. Title-case
  // them at render time so the brief reads like a human wrote it.
  // Keeps "&", short connector words (of/the/and/at/in/for/to),
  // and existing all-caps tokens (CTO, VP, AI, SaaS, USA, II/III/IV)
  // intact. Also handles hyphens and slashes as word separators.
  const SMALL_WORDS = new Set([
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in",
    "of", "on", "or", "the", "to", "via", "with",
  ]);
  const capitalizeWord = (word: string): string => {
    if (!word) return word;
    if (/^[A-Z]{2,}$/.test(word)) return word; // existing acronym
    if (/^[ivx]+$/i.test(word)) return word.toUpperCase(); // roman numerals
    // Capitalize across hyphen and slash boundaries.
    return word.replace(/(^|[-/])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
  };
  const toTitleCase = (s: string | null | undefined): string => {
    if (!s) return "";
    const tokens = s.split(/(\s+)/); // keep whitespace runs intact
    let firstWordSeen = false;
    return tokens
      .map((tok) => {
        if (/^\s+$/.test(tok)) return tok;
        const lower = tok.toLowerCase();
        const isFirst = !firstWordSeen;
        firstWordSeen = true;
        const stripped = lower.replace(/[.,;:!?]/g, "");
        if (!isFirst && SMALL_WORDS.has(stripped)) return lower;
        return capitalizeWord(tok);
      })
      .join("");
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600 dark:text-gray-300">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Gate: require planning process to be generated first
  if (!hasPreCallPlanning) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">🎯</div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Set Up Your Pre-Call Checklist First</h1>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Before you can research prospects, you need to generate your Pre-Call Checklist. This creates a personalized preparation framework based on your First Call Checklist.
            </p>
            <Link
              href="/pre-call-planning"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Pre-Call Checklist
            </Link>
            <p className="text-sm text-gray-400 mt-4">
              Once your pre-call checklist is ready, you can come back here to research any prospect.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={researching && !streamingContent}
        title="Researching Your Prospect"
        subtitle="Deep-diving into your prospect's company and market"
        emojis={["🔬", "🌐", "📊"]}
        messages={[
          "Scanning the web",
          "Analyzing company data",
          "Extracting key insights",
          "Mapping the competitive landscape",
          "Identifying pain points",
          "Compiling your brief",
        ]}
        progress={progress}
      />
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/chat"
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Pre-Call Research</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">Research prospects before every sales call</p>
              </div>
            </div>
            {brief && (
              <div className="flex items-center gap-2">
              <ChatAboutButton
                title={`Chat About Pre-Call Research: ${brief.companyName}`}
                getContext={() => brief?.content || ""}
              />
              <ShareDocumentButton
                documentType="preCallResearch"
                documentId={brief.id}
                title={`Pre-Call Research: ${brief.companyName}${brief.contactName ? ` - ${brief.contactName}` : ""}${brief.contactTitle ? `, ${brief.contactTitle}` : ""}`}
                content={brief.content}
              />
              {/* Send to Slack: opens a channel picker dropdown. */}
              <div className="relative">
                <button
                  onClick={openSlackPicker}
                  className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
                  title="Post this brief to a Slack channel"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
                  </svg>
                  Send to Slack
                </button>
                {slackPickerOpen && (
                  <div className="absolute right-0 top-full mt-2 z-30 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
                    {!slackPickingChannel ? (
                      <>
                        {/* Option 1: Mikey DM */}
                        {hasSlackDm && (
                          <button
                            onClick={() => sendBriefToSlack({ destination: "dm" }, "dm")}
                            disabled={sendingToSlack}
                            className="w-full text-left px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 flex items-center justify-between disabled:opacity-50"
                          >
                            <div>
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Send via MikeyBot DM</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">Posts in your Slack direct message with Mikey</div>
                            </div>
                            {slackSentTarget === "dm" ? (
                              <span className="text-xs text-green-600 dark:text-green-400 font-medium flex-shrink-0 ml-2">✓ Sent</span>
                            ) : sendingToSlack ? (
                              <span className="text-xs text-gray-400 flex-shrink-0 ml-2">…</span>
                            ) : null}
                          </button>
                        )}
                        {!hasSlackDm && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1.5">
                            Connect Slack to enable DM delivery.
                          </p>
                        )}

                        <div className="my-2 border-t border-gray-100 dark:border-gray-700" />

                        {/* Option 2: Saved / dedicated channel */}
                        {preferredChannelId ? (
                          <div className="px-3 py-2">
                            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Dedicated channel</div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                                # {preferredChannelName || preferredChannelId}
                              </span>
                              <button
                                onClick={clearPreferredSlackChannel}
                                className="text-[11px] text-purple-600 dark:text-purple-300 hover:underline flex-shrink-0"
                              >
                                Change
                              </button>
                            </div>
                            <button
                              onClick={() =>
                                sendBriefToSlack(
                                  { destination: "channel", channelId: preferredChannelId, channelName: preferredChannelName || undefined },
                                  preferredChannelId
                                )
                              }
                              disabled={sendingToSlack}
                              className="mt-2 w-full px-3 py-2 rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                              {slackSentTarget === preferredChannelId
                                ? "✓ Sent"
                                : sendingToSlack
                                  ? "Sending…"
                                  : `Send to #${preferredChannelName || preferredChannelId}`}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setSlackPickingChannel(true); fetchSlackChannelsIfNeeded(); }}
                            className="w-full text-left px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                          >
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Pick a dedicated channel…</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">We&apos;ll remember it for next time</div>
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Choose channel
                          </div>
                          <button
                            onClick={() => setSlackPickingChannel(false)}
                            className="text-[11px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                          >
                            Cancel
                          </button>
                        </div>
                        {!slackChannelsLoaded ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Loading channels…</p>
                        ) : slackChannelsError === "no_workspace" ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
                            Connect a Slack workspace to enable this.
                          </p>
                        ) : slackChannelsError ? (
                          <p className="text-sm text-red-600 dark:text-red-400 py-2">Failed to load channels.</p>
                        ) : (
                          <>
                            <input
                              type="text"
                              value={slackChannelFilter}
                              onChange={(e) => setSlackChannelFilter(e.target.value)}
                              placeholder="Filter channels…"
                              className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md mb-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                            <ul className="max-h-60 overflow-y-auto space-y-0.5">
                              {slackChannels
                                .filter((ch) =>
                                  ch.name.toLowerCase().includes(slackChannelFilter.trim().toLowerCase())
                                )
                                .map((ch) => (
                                  <li key={ch.id}>
                                    <button
                                      onClick={() =>
                                        sendBriefToSlack(
                                          {
                                            destination: "channel",
                                            channelId: ch.id,
                                            channelName: ch.name,
                                            saveAsPreferred: true,
                                          },
                                          ch.id
                                        )
                                      }
                                      disabled={sendingToSlack}
                                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-purple-50 dark:hover:bg-purple-900/30 flex items-center justify-between disabled:opacity-50"
                                    >
                                      <span className="text-gray-800 dark:text-gray-100 truncate">
                                        {ch.isPrivate ? "🔒" : "#"} {ch.name}
                                      </span>
                                      {slackSentTarget === ch.id ? (
                                        <span className="text-xs text-green-600 dark:text-green-400 font-medium flex-shrink-0 ml-2">✓ Sent</span>
                                      ) : sendingToSlack ? (
                                        <span className="text-xs text-gray-400 flex-shrink-0 ml-2">…</span>
                                      ) : null}
                                    </button>
                                  </li>
                                ))}
                              {slackChannels.length === 0 && (
                                <li className="text-sm text-gray-500 dark:text-gray-400 py-2">
                                  No channels available.
                                </li>
                              )}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={handleCopy}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Brief
                  </>
                )}
              </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Research Form + History */}
          <div className="lg:col-span-1 space-y-6">
            {/* Google Calendar — upcoming sales calls. Hidden entirely
                until we know connection status to avoid layout jump on
                a freshly-loaded page. */}
            {calendarConnected !== null && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 min-w-0">
                    <svg className="w-5 h-5 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Upcoming calls
                  </h2>
                  {calendarConnected && (
                    <div className="flex-shrink-0 inline-flex text-xs rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <button
                        onClick={() => setCalendarFilter("external")}
                        className={`px-2 py-1 ${
                          calendarFilter === "external"
                            ? "bg-purple-600 text-white"
                            : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        }`}
                        title="Show only meetings with at least one attendee outside your domain"
                      >
                        External
                      </button>
                      <button
                        onClick={() => setCalendarFilter("all")}
                        className={`px-2 py-1 border-l border-gray-200 dark:border-gray-700 ${
                          calendarFilter === "all"
                            ? "bg-purple-600 text-white"
                            : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        }`}
                        title="Show every upcoming event on your calendar"
                      >
                        All
                      </button>
                    </div>
                  )}
                </div>
                {!calendarConnected ? (
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                      Connect Google Calendar to load your next sales calls and start research with one click.
                    </p>
                    <a
                      href="/api/auth/google?returnTo=/pre-call-planning/research"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-600"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Connect Google Calendar
                    </a>
                  </div>
                ) : loadingUpcoming ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
                ) : upcomingEvents.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No upcoming {calendarFilter === "external" ? "external " : ""}meetings in the next {calendarDays} days.
                  </p>
                ) : (
                  <>
                    {/* Free-text search across title, prefill company,
                        and attendee name/email. Client-side filter so
                        typing is instant. */}
                    <div className="relative mb-2">
                      <svg
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        type="text"
                        value={calendarSearch}
                        onChange={(e) => setCalendarSearch(e.target.value)}
                        placeholder="Filter meetings…"
                        className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                      {calendarSearch && (
                        <button
                          onClick={() => setCalendarSearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                          aria-label="Clear search"
                          title="Clear search"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {(() => {
                      const q = calendarSearch.trim().toLowerCase();
                      const filtered = q
                        ? upcomingEvents.filter((event) => {
                            const haystack = [
                              event.title,
                              event.prefill.companyName,
                              ...event.attendees.flatMap((a) => [a.name || "", a.email]),
                            ]
                              .join(" ")
                              .toLowerCase();
                            return haystack.includes(q);
                          })
                        : upcomingEvents;
                      if (filtered.length === 0) {
                        return (
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            No meetings match &ldquo;{calendarSearch}&rdquo;.
                          </p>
                        );
                      }
                      return (
                        <ul className="space-y-2">
                          {filtered.map((event) => {
                      const when = new Date(event.startsAt);
                      const whenLabel = when.toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      });
                      return (
                        <li key={event.id} className="relative group">
                          <button
                            onClick={() => selectEvent(event)}
                            disabled={researching || enrichingEventId !== null}
                            className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50 disabled:cursor-wait"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-1">
                                {event.title}
                              </div>
                              {enrichingEventId === event.id && (
                                <svg className="animate-spin h-3.5 w-3.5 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              {whenLabel}
                              {event.prefill.companyName && (
                                <> · <span className="text-purple-600 dark:text-purple-300">{event.prefill.companyName}</span></>
                              )}
                            </div>
                            {enrichmentResults[event.id] && (
                              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                                {(() => {
                                  const r = enrichmentResults[event.id];
                                  const parts = [`Enriched ${r.pdlHits} of ${r.total} from PDL`];
                                  if (r.companyFallback) parts.push("company by domain");
                                  return parts.join(" · ");
                                })()}
                              </div>
                            )}
                          </button>
                          {event.attendees.length > 0 && (
                            <div className="pointer-events-none absolute left-3 top-full mt-1 z-20 hidden group-hover:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 min-w-[14rem] max-w-[20rem]">
                              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">{event.title}</div>
                              <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">External attendees</div>
                              <ul className="space-y-0.5">
                                {event.attendees.map((a, idx) => (
                                  <li key={`${a.email || a.name}-${idx}`} className="text-xs">
                                    {a.name && <div className="text-gray-800 dark:text-gray-100">{a.name}</div>}
                                    {a.email && (
                                      <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono break-all">{a.email}</div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </li>
                          );
                        })}
                        </ul>
                      );
                    })()}
                  </>
                )}
                {calendarConnected && (calendarHasMore || calendarDays > 14) && (
                  <div className="mt-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>Showing next {calendarDays} days</span>
                    {calendarHasMore && (
                      <button
                        onClick={loadMoreCalendar}
                        disabled={loadingUpcoming || calendarDays >= 180}
                        className="text-purple-600 dark:text-purple-300 hover:text-purple-700 dark:hover:text-purple-200 font-medium disabled:opacity-50"
                      >
                        {loadingUpcoming ? "Loading…" : calendarDays >= 180 ? "Max range reached" : "Load more meetings →"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Research Form */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">New Research</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Company *
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g., Acme Corp"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                    disabled={researching}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="e.g., Jane Doe"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                    disabled={researching}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    value={contactTitle}
                    onChange={(e) => setContactTitle(e.target.value)}
                    placeholder="e.g., VP of Engineering"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                    disabled={researching}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    LinkedIn URL
                  </label>
                  <input
                    type="url"
                    value={contactLinkedIn}
                    onChange={(e) => setContactLinkedIn(e.target.value)}
                    placeholder="https://linkedin.com/in/janedoe"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none text-sm"
                    disabled={researching}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Company Homepage URL
                  </label>
                  <input
                    type="url"
                    value={urls}
                    onChange={(e) => setUrls(e.target.value)}
                    placeholder="https://acme.com"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none text-sm"
                    disabled={researching}
                  />
                </div>

                <button
                  onClick={handleResearch}
                  disabled={researching || !companyName.trim()}
                  className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {researching ? (
                    <>
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Researching...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      Research Prospect
                    </>
                  )}
                </button>
              </div>

              {/* Progress bar */}
              {progress && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600 dark:text-gray-300">{progress.message}</span>
                    <span className="text-sm text-gray-400">{progress.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${progress.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* History */}
            {history.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Research</h2>
                  <Link
                    href="/pre-call-planning/history"
                    className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                  >
                    View All
                  </Link>
                </div>
                <div className="space-y-2">
                  {history.slice(0, 10).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleLoadBrief(item.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                        brief?.id === item.id ? "bg-purple-50 border border-purple-200" : ""
                      }`}
                    >
                      <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">{toTitleCase(item.companyName)}</div>
                      {item.contactName && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{toTitleCase(item.contactName)}{item.contactTitle ? ` - ${toTitleCase(item.contactTitle)}` : ""}</div>
                      )}
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatDate(item.createdAt)}
                        {item.source === "slack" && (
                          <span className="ml-1 text-purple-500">via Slack</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Research Brief Display */}
          <div className="lg:col-span-2">
            {brief ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                <div className="p-4 border-b border-gray-100">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {toTitleCase(brief.companyName)}
                    {brief.contactName && (
                      <span className="text-gray-500 dark:text-gray-400 font-normal"> — {toTitleCase(brief.contactName)}{brief.contactTitle ? `, ${toTitleCase(brief.contactTitle)}` : ""}</span>
                    )}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Generated {formatDate(brief.createdAt)}
                  </p>
                </div>
                {/* Prospect header card — quick reference for who
                    you're meeting with. Shows only when we have at
                    least one human-context field beyond the company. */}
                {(brief.contactName || brief.contactTitle || brief.contactEmail || brief.contactLinkedIn) && (
                  <div className="px-6 pt-6">
                    <div className="rounded-lg border border-purple-100 dark:border-purple-900/50 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 p-4">
                      <div className="flex items-baseline gap-2 flex-wrap mb-2">
                        {brief.contactName && (
                          <span className="text-base font-semibold text-gray-900 dark:text-gray-100">{toTitleCase(brief.contactName)}</span>
                        )}
                        {brief.contactTitle && (
                          <span className="text-sm text-gray-600 dark:text-gray-300">{toTitleCase(brief.contactTitle)}</span>
                        )}
                        {brief.companyName && (
                          <span className="text-sm text-purple-700 dark:text-purple-300">@ {toTitleCase(brief.companyName)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 flex-wrap text-xs">
                        {brief.contactEmail && (
                          <a
                            href={`mailto:${brief.contactEmail}`}
                            className="inline-flex items-center gap-1 text-gray-700 dark:text-gray-200 hover:text-purple-600 dark:hover:text-purple-300 font-mono break-all"
                          >
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            {brief.contactEmail}
                          </a>
                        )}
                        {brief.contactLinkedIn && (
                          <a
                            href={brief.contactLinkedIn.startsWith("http") ? brief.contactLinkedIn : `https://${brief.contactLinkedIn}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-300 hover:underline"
                          >
                            <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                            </svg>
                            LinkedIn
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <div className="p-6">
                  <div className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900 prose-table:text-sm prose-th:bg-gray-100 prose-th:border prose-th:border-gray-300 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-gray-300 prose-td:px-3 prose-td:py-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ) : streamingContent ? (
              /* Streaming content — brief is being generated token by token */
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                {researching && (
                  <div className="px-6 py-2 bg-purple-50 border-b border-purple-100 flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5 text-purple-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-sm text-purple-600 font-medium">Generating research brief...</span>
                  </div>
                )}
                <div className="p-6">
                  <div className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900 prose-table:text-sm prose-th:bg-gray-100 prose-th:border prose-th:border-gray-300 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-gray-300 prose-td:px-3 prose-td:py-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ) : researching ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
                <svg className="animate-spin h-12 w-12 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Researching...</h3>
                <p className="text-gray-500 dark:text-gray-400">{progress?.message || "Starting search..."}</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
                <div className="text-6xl mb-4">🔍</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Research a Prospect</h3>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                  Enter a company name and optional contact info to generate a comprehensive research brief for your next sales call.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {ConfirmModalElement}
    </div>
  );
}
