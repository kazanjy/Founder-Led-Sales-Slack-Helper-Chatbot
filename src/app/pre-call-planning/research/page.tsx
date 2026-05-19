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
        const res = await fetch(`/api/google-calendar/upcoming?filter=${calendarFilter}`);
        if (!res.ok) {
          if (res.status === 403) setCalendarConnected(false);
          return;
        }
        const data = await res.json();
        if (!cancelled) setUpcomingEvents(data.events || []);
      } catch (err) {
        console.error("[research] Failed to load calendar:", err);
      } finally {
        if (!cancelled) setLoadingUpcoming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [calendarConnected, calendarFilter]);

  const prefillFromEvent = (event: UpcomingEvent) => {
    if (event.prefill.companyName) setCompanyName(event.prefill.companyName);
    if (event.prefill.contactName) setContactName(event.prefill.contactName);
    if (event.prefill.contactTitle) setContactTitle(event.prefill.contactTitle);
    if (event.prefill.contactLinkedIn) setContactLinkedIn(event.prefill.contactLinkedIn);
    if (event.prefill.companyUrl) setUrls(event.prefill.companyUrl);
  };

  const handleResearch = async () => {
    if (!companyName.trim()) {
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
      const homepageUrl = urls.trim();

      const response = await fetch("/api/pre-call-planning/research-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          contactName: contactName.trim() || undefined,
          contactTitle: contactTitle.trim() || undefined,
          contactLinkedIn: contactLinkedIn.trim() || undefined,
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
                    No upcoming external meetings in the next 14 days.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {upcomingEvents.map((event) => {
                      const when = new Date(event.startsAt);
                      const whenLabel = when.toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      });
                      return (
                        <li key={event.id}>
                          <button
                            onClick={() => prefillFromEvent(event)}
                            disabled={researching}
                            className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50"
                            title="Prefill the research form with this meeting's details"
                          >
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-1">
                              {event.title}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              {whenLabel}
                              {event.prefill.companyName && (
                                <> · <span className="text-purple-600 dark:text-purple-300">{event.prefill.companyName}</span></>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
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
                      <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">{item.companyName}</div>
                      {item.contactName && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{item.contactName}{item.contactTitle ? ` - ${item.contactTitle}` : ""}</div>
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
                    {brief.companyName}
                    {brief.contactName && (
                      <span className="text-gray-500 dark:text-gray-400 font-normal"> — {brief.contactName}{brief.contactTitle ? `, ${brief.contactTitle}` : ""}</span>
                    )}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Generated {formatDate(brief.createdAt)}
                  </p>
                </div>
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
