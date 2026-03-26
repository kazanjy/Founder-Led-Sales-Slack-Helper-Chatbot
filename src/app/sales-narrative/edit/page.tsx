"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useConfirmModal } from "@/components/useConfirmModal";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";

interface Question {
  id: string;
  category: string;
  globalOrder: number;
  question: string;
  helpText: string | null;
  latestAnswer: { id: string; answer: string; createdAt: string } | null;
}

interface CategoryGroup {
  category: string;
  questions: Question[];
}

// Fun loading messages for the generation overlay
const LOADING_MESSAGES = [
  "Crafting your story",
  "Distilling your value prop",
  "Synthesizing your narrative",
  "Weaving your positioning",
  "Articulating your message",
  "Polishing your pitch",
  "Crystallizing your story",
  "Refining your narrative",
  "Sharpening your message",
  "Perfecting your positioning",
];

// Loading messages for the pre-fill process
const PREFILL_MESSAGES = [
  "Crawling your website",
  "Reading your materials",
  "Extracting key information",
  "Analyzing your product",
  "Identifying your value prop",
  "Understanding your customers",
  "Drafting your answers",
];

const PREFILL_MESSAGES_CACHED = [
  "Analyzing your product",
  "Identifying your value prop",
  "Understanding your customers",
  "Drafting your answers",
  "Filling in your questionnaire",
];

export default function SalesNarrativeEditPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading questions...</p>
        </div>
      </div>
    }>
      <SalesNarrativeEditContent />
    </Suspense>
  );
}

function SalesNarrativeEditContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillUrlFromParam = searchParams.get("prefillUrl");
  const hasAutoTriggered = useRef(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [grouped, setGrouped] = useState<CategoryGroup[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isHeaderSticky, setIsHeaderSticky] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { alert: showAlert, confirm: showConfirm, ConfirmModalElement } = useConfirmModal();

  // Smart Pre-Fill state
  const [prefillUrl, setPrefillUrl] = useState("");
  const [prefillFiles, setPrefillFiles] = useState<File[]>([]);
  const [prefilling, setPrefilling] = useState(false);
  const [prefillMessageIndex, setPrefillMessageIndex] = useState(0);
  const [prefillDone, setPrefillDone] = useState(false);
  const [prefillPanelOpen, setPrefillPanelOpen] = useState(true);
  const [prefillSourceUrls, setPrefillSourceUrls] = useState<string[]>([]);
  const [prefillSourcePdfNames, setPrefillSourcePdfNames] = useState<string[]>([]);
  const [specificUrls, setSpecificUrls] = useState<string[]>([""]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);
  const pdfFileInputRef = useRef<HTMLInputElement>(null);
  const precrawlFiredRef = useRef<string | null>(null);
  const precrawlResultRef = useRef<{ text: string; urls: string[] } | null>(null);
  const [precrawlStatus, setPrecrawlStatus] = useState<"idle" | "crawling" | "ready">("idle");

  // Set browser tab title
  useEffect(() => {
    document.title = "Edit Sales Narrative - Mikey";
    // Check if the GetStartedModal already precrawled
    try {
      const stored = sessionStorage.getItem("precrawlResult");
      if (stored) {
        precrawlResultRef.current = JSON.parse(stored);
        sessionStorage.removeItem("precrawlResult");
        setPrecrawlStatus("ready");
      }
    } catch { /* ignore */ }
  }, []);

  // Fire background precrawl as soon as a website URL is populated
  useEffect(() => {
    const url = prefillUrl.trim();
    if (!url || prefilling || precrawlFiredRef.current === url) return;
    // Skip if we already have results (e.g. from GetStartedModal via sessionStorage)
    if (precrawlResultRef.current) {
      precrawlFiredRef.current = url;
      return;
    }
    // Only fire for URLs that look like a domain (not partial typing)
    try { new URL(url.startsWith("http") ? url : `https://${url}`); } catch { return; }
    precrawlFiredRef.current = url;
    precrawlResultRef.current = null;
    setPrecrawlStatus("crawling");
    fetch("/api/sales-narrative/precrawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ websiteUrl: url }),
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.crawlText && precrawlFiredRef.current === url) {
          precrawlResultRef.current = { text: data.crawlText, urls: data.crawlUrls || [] };
          setPrecrawlStatus("ready");
        } else {
          setPrecrawlStatus("idle");
        }
      })
      .catch(() => { setPrecrawlStatus("idle"); });
  }, [prefillUrl, prefilling]);

  // Reset precrawl status when URL changes
  useEffect(() => {
    const url = prefillUrl.trim();
    if (precrawlFiredRef.current && precrawlFiredRef.current !== url) {
      setPrecrawlStatus("idle");
      precrawlFiredRef.current = null;
      precrawlResultRef.current = null;
    }
  }, [prefillUrl]);


  // Cycle through pre-fill loading messages
  const activePrefillMessages = precrawlResultRef.current ? PREFILL_MESSAGES_CACHED : PREFILL_MESSAGES;
  useEffect(() => {
    if (!prefilling) {
      setPrefillMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setPrefillMessageIndex((prev) => (prev + 1) % activePrefillMessages.length);
    }, 2500);

    return () => clearInterval(interval);
  }, [prefilling]);

  // Handle sticky header
  useEffect(() => {
    const handleScroll = () => {
      if (headerRef.current) {
        setIsHeaderSticky(window.scrollY > 100);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Load questions on mount
  useEffect(() => {
    async function loadData() {
      try {
        // Check auth
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        // Pre-fill website URL from email domain
        if (authData.user.email) {
          const domain = authData.user.email.split("@")[1]?.toLowerCase();
          const genericDomains = ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "protonmail.com", "proton.me", "mail.com", "zoho.com", "yandex.com", "gmx.com"];
          if (domain && !genericDomains.includes(domain)) {
            setPrefillUrl(`https://${domain}`);
          }
        }

        // Load questions
        const response = await fetch("/api/sales-narrative/questions");
        if (!response.ok) throw new Error("Failed to load questions");
        const data = await response.json();
        setQuestions(data.questions);
        setGrouped(data.grouped);

        // Initialize answers from existing data
        const initialAnswers: Record<string, string> = {};
        data.questions.forEach((q: Question) => {
          initialAnswers[q.id] = q.latestAnswer?.answer || "";
        });
        setAnswers(initialAnswers);
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router]);

  // Auto-populate URL from query param and flag for auto-trigger
  const [shouldAutoTriggerPrefill, setShouldAutoTriggerPrefill] = useState(false);
  useEffect(() => {
    if (loading || !prefillUrlFromParam || hasAutoTriggered.current) return;
    hasAutoTriggered.current = true;
    setPrefillUrl(prefillUrlFromParam);
    window.history.replaceState({}, "", "/sales-narrative/edit");

    // If we have precrawl results from GetStartedModal, show sources immediately
    if (precrawlResultRef.current?.urls?.length) {
      setPrefillSourceUrls(precrawlResultRef.current.urls);
      // Keep panel open so user sees the spinner while Q&A generates
    }

    setShouldAutoTriggerPrefill(true);
  }, [loading, prefillUrlFromParam]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleAnswerChange = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setHasUnsavedChanges(true);

    // Auto-save after 2 seconds of no typing (only if there's content)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (value.trim()) {
      saveTimeoutRef.current = setTimeout(() => {
        handleSaveAnswer(questionId, value);
      }, 2000);
    }
  }, []);

  const handleSaveAnswer = async (questionId: string, value: string) => {
    if (!value.trim()) return;

    try {
      const response = await fetch(`/api/sales-narrative/answers/${questionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: value.trim() }),
      });

      if (response.ok) {
        setLastSaved(new Date());
      }
    } catch (error) {
      console.error("Error saving answer:", error);
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const savePromises: Promise<Response>[] = [];

      Object.entries(answers).forEach(([questionId, value]) => {
        const answerToSave = value.trim();
        if (answerToSave) {
          savePromises.push(
            fetch(`/api/sales-narrative/answers/${questionId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ answer: answerToSave }),
            })
          );
        }
      });

      await Promise.all(savePromises);
      setHasUnsavedChanges(false);
      setLastSaved(new Date());
    } catch (error) {
      console.error("Error saving answers:", error);
    } finally {
      setSaving(false);
    }
  };

  const handlePrefill = async () => {
    if (!prefillUrl.trim() && prefillFiles.length === 0) return;

    setPrefilling(true);
    try {
      // Step 1: Upload PDFs directly to Supabase via signed URLs
      // (bypasses Vercel's 4.5 MB serverless function body limit entirely)
      let uploadedPdfs: { name: string; storagePath: string }[] = [];
      if (prefillFiles.length > 0) {
        const urlRes = await fetch("/api/files/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: prefillFiles.map((f) => ({ name: f.name })),
            source: "narrative-prefill",
          }),
        });

        if (!urlRes.ok) {
          const msg = await urlRes.json().catch(() => null);
          throw new Error(msg?.error || `Upload error (${urlRes.status})`);
        }

        const { files: fileEntries } = (await urlRes.json()) as {
          files: Array<{ name: string; storagePath: string; signedUrl: string; token: string }>;
        };

        await Promise.all(fileEntries.map(async (entry, i) => {
          const file = prefillFiles.find((f) => f.name === entry.name) || prefillFiles[i];
          const putRes = await fetch(entry.signedUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!putRes.ok) {
            throw new Error(`Failed to upload ${entry.name} (${putRes.status})`);
          }
        }));

        uploadedPdfs = fileEntries.map((f) => ({ name: f.name, storagePath: f.storagePath }));
      }

      // Step 2: Call prefill with website URL and storage paths
      // If precrawl already finished, pass the cached content to skip re-crawling
      const prefillBody: Record<string, unknown> = {
        websiteUrl: prefillUrl.trim() || undefined,
        specificUrls: specificUrls.filter((u) => u.trim()).length > 0
          ? specificUrls.filter((u) => u.trim())
          : undefined,
        pdfFiles: uploadedPdfs.length > 0 ? uploadedPdfs : undefined,
      };
      if (precrawlResultRef.current && prefillUrl.trim()) {
        prefillBody.cachedCrawl = precrawlResultRef.current;
      }
      const response = await fetch("/api/sales-narrative/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefillBody),
      });

      if (!response.ok) {
        let errorMsg = "Pre-fill failed";
        try {
          const data = await response.json();
          errorMsg = data.error || errorMsg;
        } catch {
          errorMsg = `Server error (${response.status})`;
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const prefillAnswers: Record<string, string> = data.answers;

      // Track sources used in prefill
      if (data.sourceUrls?.length) setPrefillSourceUrls(data.sourceUrls);
      if (data.sourcePdfNames?.length) setPrefillSourcePdfNames(data.sourcePdfNames);

      // Check if any existing fields already have content
      let overwriteExisting = false;
      const hasExistingAnswers = Object.entries(prefillAnswers).some(
        ([questionId, answer]) => answer.trim() && answers[questionId]?.trim()
      );

      if (hasExistingAnswers) {
        overwriteExisting = await showConfirm({
          title: "Overwrite Existing Answers?",
          message:
            "Some questions already have answers. Do you want to overwrite them with the new pre-filled answers, or only fill in the empty fields?",
          variant: "warning",
          confirmLabel: "Overwrite All",
          cancelLabel: "Only Fill Empty",
        });
      }

      // Merge answers, optionally overwriting existing ones
      const filledIds: string[] = [];
      const updatedAnswers = { ...answers };
      for (const [questionId, answer] of Object.entries(prefillAnswers)) {
        if (answer.trim()) {
          const existingHasContent = !!updatedAnswers[questionId]?.trim();
          if (!existingHasContent || overwriteExisting) {
            updatedAnswers[questionId] = answer;
            filledIds.push(questionId);
          }
        }
      }
      setAnswers(updatedAnswers);

      setPrefillDone(true);
      setPrefillPanelOpen(false);
      setHasUnsavedChanges(true);

      // Auto-save the pre-filled answers in parallel
      await Promise.all(
        filledIds
          .filter((qId) => prefillAnswers[qId]?.trim())
          .map((qId) => handleSaveAnswer(qId, prefillAnswers[qId]))
      );

      await showAlert({
        title: "Pre-Fill Complete",
        message: `Updated ${filledIds.length} of ${data.totalQuestions} questions from your materials. Review and edit the answers below!`,
        variant: "info",
      });
    } catch (error) {
      console.error("Pre-fill error:", error);
      await showAlert({
        title: "Pre-Fill Error",
        message: error instanceof Error ? error.message : "Failed to pre-fill. Please try again.",
        variant: "danger",
      });
    } finally {
      setPrefilling(false);
    }
  };

  // Auto-trigger prefill when URL was set from query param
  useEffect(() => {
    if (shouldAutoTriggerPrefill && !prefilling) {
      setShouldAutoTriggerPrefill(false);
      handlePrefill();
    }
  }, [shouldAutoTriggerPrefill, prefilling]); // eslint-disable-line react-hooks/exhaustive-deps

  const addPdfFiles = (files: File[]) => {
    const pdfs = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length > 0) setPrefillFiles((prev) => [...prev, ...pdfs]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addPdfFiles(Array.from(e.target.files || []));
    // Reset input so the same file can be re-selected
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    if (!prefilling) addPdfFiles(Array.from(e.dataTransfer.files));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDraggingOver(false);
  };

  const handleRemoveFile = (index: number) => {
    setPrefillFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    // Save all answers first
    await handleSaveAll();
    setHasUnsavedChanges(false);

    // Store source info for the view page to use when streaming
    try {
      sessionStorage.setItem("narrativeGenerateParams", JSON.stringify({
        sourceUrls: prefillSourceUrls,
        sourcePdfNames: prefillSourcePdfNames,
      }));
    } catch { /* ignore */ }

    // Navigate to view page which will start streaming generation
    router.push("/sales-narrative?generating=true");
  };

  // Calculate progress
  const answeredCount = Object.values(answers).filter((a) => a.trim()).length;
  const totalQuestions = questions.length;
  const progressPercent = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  // Category colors
  const categoryColors: Record<string, { bg: string; text: string; gradient: string }> = {
    Product: { bg: "bg-indigo-500", text: "text-indigo-700", gradient: "from-indigo-500 to-violet-500" },
    Problem: { bg: "bg-red-500", text: "text-red-700", gradient: "from-red-500 to-orange-500" },
    Solution: { bg: "bg-blue-500", text: "text-blue-700", gradient: "from-blue-500 to-cyan-500" },
    Proof: { bg: "bg-green-500", text: "text-green-700", gradient: "from-green-500 to-emerald-500" },
    Business: { bg: "bg-purple-500", text: "text-purple-700", gradient: "from-purple-500 to-pink-500" },
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading questions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Generation Loading Overlay */}
      <GeneratingOverlay
        visible={generating}
        title="Generating Your Sales Narrative"
        subtitle="Creating your narrative, value propositions, and tagline"
        emojis={["✍️", "📝", "✨"]}
        messages={LOADING_MESSAGES}
      />

      {/* Floating Header */}
      <div
        ref={headerRef}
        className={`bg-white border-b border-gray-200 transition-all duration-200 ${
          isHeaderSticky ? "fixed top-0 left-0 right-0 z-40 shadow-md" : ""
        }`}
      >
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/chat"
                className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  Sales Narrative Questionnaire
                </h1>
                <p className="text-sm text-gray-500">
                  {answeredCount} of {totalQuestions} answered ({progressPercent}%)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Last saved indicator */}
              {lastSaved && (
                <span className="text-xs text-gray-400">
                  Saved {lastSaved.toLocaleTimeString()}
                </span>
              )}

              {/* Save for Later button */}
              <button
                onClick={handleSaveAll}
                disabled={saving || generating}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                )}
                Save for Later
              </button>

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={saving || generating || answeredCount === 0}
                className="px-5 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 font-medium shadow-md hover:shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Narrative
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-600 to-blue-600 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Spacer for sticky header */}
      {isHeaderSticky && <div className="h-32" />}

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Smart Pre-Fill Panel */}
        <div className="mb-8">
          <button
            onClick={() => setPrefillPanelOpen((prev) => !prev)}
            className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 rounded-xl hover:border-amber-300 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-md">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-gray-900">
                  Smart Pre-Fill {prefillDone && <span className="text-green-600 text-sm font-normal ml-2">Done!</span>}
                </h3>
                <p className="text-sm text-gray-500">
                  Provide your website URL and/or sales decks to auto-fill answers
                </p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${prefillPanelOpen ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {prefillPanelOpen && (
            <div className="mt-2 bg-white border-2 border-amber-200 rounded-xl p-6 space-y-5">
              {prefilling ? (
                /* Clear progress indicator while prefilling */
                <div className="py-8 text-center">
                  <div className="w-14 h-14 mx-auto mb-4 bg-gradient-to-br from-amber-100 to-orange-100 rounded-2xl flex items-center justify-center">
                    <svg className="animate-spin h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Pre-filling your Sales Narrative Q&amp;A
                  </h3>
                  <p className="text-sm text-gray-500 mb-3">
                    {activePrefillMessages[prefillMessageIndex]}...
                  </p>
                  <p className="text-xs text-gray-400">
                    {precrawlResultRef.current ? "This should take about 10-15 seconds" : "This may take 30-60 seconds"}
                  </p>
                  {prefillSourceUrls.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-xs text-gray-400 mb-1">Using content from {prefillSourceUrls.length} crawled pages</p>
                    </div>
                  )}
                </div>
              ) : (
              <>
              {/* Website URL */}
              <div>
                <label htmlFor="prefill-url" className="block text-sm font-medium text-gray-700 mb-1">
                  Website URL
                </label>
                <input
                  id="prefill-url"
                  type="url"
                  value={prefillUrl}
                  onChange={(e) => setPrefillUrl(e.target.value)}
                  placeholder="https://yourcompany.com"
                  disabled={prefilling}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50"
                />
                <div className="flex items-center gap-2 mt-1 min-h-[18px]">
                  {precrawlStatus === "crawling" && (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-amber-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <p className="text-xs text-amber-600 font-medium">Crawling your site...</p>
                    </>
                  )}
                  {precrawlStatus === "ready" && (
                    <>
                      <svg className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <p className="text-xs text-green-600 font-medium">Site crawled &mdash; ready to analyze</p>
                    </>
                  )}
                  {precrawlStatus === "idle" && (
                    <p className="text-xs text-gray-400">
                      We&apos;ll crawl your site for product, solution, customer, and pricing pages
                    </p>
                  )}
                </div>
              </div>

              {/* Specific Page URLs */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Specific Page URLs <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <div className="space-y-2">
                  {specificUrls.map((url, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="url"
                        value={url}
                        onChange={(e) => {
                          const updated = [...specificUrls];
                          updated[i] = e.target.value;
                          // Auto-add a new empty row when the last field gets content
                          if (i === specificUrls.length - 1 && e.target.value.trim()) {
                            updated.push("");
                          }
                          setSpecificUrls(updated);
                        }}
                        placeholder={i === 0 ? "https://yourcompany.com/case-study" : "Paste another URL..."}
                        disabled={prefilling}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50 text-sm"
                      />
                      {specificUrls.length > 1 && (i < specificUrls.length - 1 || url.trim()) && (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = specificUrls.filter((_, idx) => idx !== i);
                            if (updated.length === 0 || updated[updated.length - 1].trim()) {
                              updated.push("");
                            }
                            setSpecificUrls(updated);
                          }}
                          disabled={prefilling}
                          className="p-1.5 text-gray-400 hover:text-red-500 disabled:opacity-50 flex-shrink-0"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Paste individual page links to crawl just those pages instead of the full site
                </p>
              </div>

              {/* PDF Upload Drop Zone */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PDF Files <span className="text-gray-400 font-normal">(sales decks, one-pagers, etc.)</span>
                </label>
                <input
                  ref={pdfFileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  className={`relative border-2 border-dashed rounded-lg transition-colors ${
                    isDraggingOver
                      ? "border-amber-400 bg-amber-50"
                      : "border-gray-300 hover:border-amber-400 hover:bg-amber-50"
                  } ${prefilling ? "opacity-50 pointer-events-none" : ""}`}
                >
                  {prefillFiles.length === 0 ? (
                    <div
                      onClick={() => pdfFileInputRef.current?.click()}
                      className="flex flex-col items-center justify-center py-6 cursor-pointer"
                    >
                      <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <span className="text-sm font-medium text-gray-600">
                        {isDraggingOver ? "Drop PDFs here" : "Click to upload or drag & drop"}
                      </span>
                      <span className="text-xs text-gray-400 mt-1">PDF files only</span>
                    </div>
                  ) : (
                    <div className="p-4">
                      <div className="flex flex-wrap gap-2">
                        {prefillFiles.map((file, i) => (
                          <span
                            key={`${file.name}-${i}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-sm text-amber-800"
                          >
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            {file.name}
                            <button
                              type="button"
                              onClick={() => handleRemoveFile(i)}
                              disabled={prefilling}
                              className="ml-0.5 text-amber-500 hover:text-amber-700 disabled:opacity-50"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => pdfFileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 mt-3 text-sm text-amber-600 hover:text-amber-700 cursor-pointer"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add more PDFs
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Action button */}
              <div className="flex items-center gap-4 pt-2">
                <button
                  onClick={handlePrefill}
                  disabled={!prefillUrl.trim() && specificUrls.every((u) => !u.trim()) && prefillFiles.length === 0}
                  className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Analyze &amp; Pre-Fill
                </button>
              </div>
              </>
              )}
            </div>
          )}
        </div>

        {/* Sources Banner - shown after prefill */}
        {(prefillSourceUrls.length > 0 || prefillSourcePdfNames.length > 0) && (
          <div className="mb-8 bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Sources Used for Pre-Fill
            </h3>
            {prefillSourceUrls.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-medium text-gray-500 mb-1">Website Pages Crawled</p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
                  {[...prefillSourceUrls].sort((a, b) => {
                    try {
                      const pathA = new URL(a).pathname.toLowerCase();
                      const pathB = new URL(b).pathname.toLowerCase();
                      return pathA.localeCompare(pathB);
                    } catch { return a.localeCompare(b); }
                  }).map((url, i) => {
                    // Strip protocol and domain to show just the path
                    let displayPath = "/";
                    try {
                      const parsed = new URL(url);
                      displayPath = parsed.pathname === "/" ? parsed.host : parsed.pathname.replace(/\/+$/, "");
                    } catch {
                      displayPath = url;
                    }
                    return (
                      <li key={i} className="text-sm text-blue-600 truncate">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline" title={url}>
                          {displayPath}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {prefillSourcePdfNames.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">PDF Files</p>
                <ul className="space-y-1">
                  {prefillSourcePdfNames.map((name, i) => (
                    <li key={i} className="text-sm text-gray-700 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {grouped.map((category, categoryIndex) => {
          const colors = categoryColors[category.category] || categoryColors.Problem;
          return (
            <div key={category.category} className="mb-12">
              {/* Category Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colors.gradient} flex items-center justify-center text-white font-bold text-lg shadow-md`}>
                  {categoryIndex + 1}
                </div>
                <h2 className="text-2xl font-bold text-gray-900">{category.category}</h2>
                <span className="text-sm text-gray-500 ml-auto">
                  {category.questions.filter((q) => answers[q.id]?.trim()).length} / {category.questions.length} answered
                </span>
              </div>

              {/* Questions */}
              <div className="space-y-6">
                {category.questions.map((question) => {
                  const hasAnswer = answers[question.id]?.trim();

                  return (
                    <div
                      key={question.id}
                      className={`bg-white rounded-xl border-2 transition-colors ${
                        hasAnswer ? "border-green-200" : "border-gray-200"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row">
                        {/* Question Side */}
                        <div className="md:w-2/5 p-5 bg-gray-50 rounded-l-xl border-b md:border-b-0 md:border-r border-gray-200">
                          <div className="flex items-start gap-3">
                            <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium ${
                              hasAnswer ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"
                            }`}>
                              {question.globalOrder}
                            </span>
                            <div>
                              <p className="text-gray-800 font-medium leading-relaxed">
                                {question.question}
                              </p>
                              {question.helpText && (
                                <p className="text-sm text-gray-500 mt-2 italic">
                                  {question.helpText}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Answer Side */}
                        <div className="md:w-3/5 p-5">
                          <textarea
                            value={answers[question.id] || ""}
                            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                            placeholder="Enter your answer..."
                            className="w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y text-gray-800"
                          />
                          {hasAnswer && (
                            <div className="mt-2 flex items-center gap-1 text-green-600 text-xs">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Answered
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Bottom Generate Section */}
        <div className="mt-12 mb-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-8 text-center text-white">
          <h3 className="text-2xl font-bold mb-2">Ready to Generate Your Narrative?</h3>
          <p className="text-purple-100 mb-6">
            You&apos;ve answered {answeredCount} of {totalQuestions} questions.
            {answeredCount < totalQuestions && " Answer more for a better narrative!"}
          </p>
          <button
            onClick={handleGenerate}
            disabled={saving || generating || answeredCount === 0}
            className="px-8 py-4 bg-white text-purple-700 rounded-xl hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold text-lg shadow-lg hover:shadow-xl flex items-center gap-3 mx-auto"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Sales Narrative
          </button>
        </div>
      </div>
      {ConfirmModalElement}
    </div>
  );
}
