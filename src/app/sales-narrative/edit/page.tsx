"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useConfirmModal } from "@/components/useConfirmModal";

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

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [grouped, setGrouped] = useState<CategoryGroup[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isHeaderSticky, setIsHeaderSticky] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { alert: showAlert, ConfirmModalElement } = useConfirmModal();

  // Smart Pre-Fill state
  const [prefillUrl, setPrefillUrl] = useState("");
  const [prefillFiles, setPrefillFiles] = useState<File[]>([]);
  const [prefilling, setPrefilling] = useState(false);
  const [prefillMessageIndex, setPrefillMessageIndex] = useState(0);
  const [prefillDone, setPrefillDone] = useState(false);
  const [prefillPanelOpen, setPrefillPanelOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Set browser tab title
  useEffect(() => {
    document.title = "Edit Sales Narrative - Mikey";
  }, []);

  // Cycle through loading messages when generating
  useEffect(() => {
    if (!generating) {
      setLoadingMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [generating]);

  // Cycle through pre-fill loading messages
  useEffect(() => {
    if (!prefilling) {
      setPrefillMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setPrefillMessageIndex((prev) => (prev + 1) % PREFILL_MESSAGES.length);
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

        for (let i = 0; i < fileEntries.length; i++) {
          const entry = fileEntries[i];
          const file = prefillFiles.find((f) => f.name === entry.name) || prefillFiles[i];

          const putRes = await fetch(entry.signedUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });

          if (!putRes.ok) {
            throw new Error(`Failed to upload ${entry.name} (${putRes.status})`);
          }
        }

        uploadedPdfs = fileEntries.map((f) => ({ name: f.name, storagePath: f.storagePath }));
      }

      // Step 2: Call prefill with website URL and storage paths (tiny request)
      const response = await fetch("/api/sales-narrative/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteUrl: prefillUrl.trim() || undefined,
          pdfFiles: uploadedPdfs.length > 0 ? uploadedPdfs : undefined,
        }),
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

      // Merge: only fill empty fields, and track which ones we filled
      const filledIds: string[] = [];
      setAnswers((prev) => {
        const updated = { ...prev };
        for (const [questionId, answer] of Object.entries(prefillAnswers)) {
          if (!updated[questionId]?.trim() && answer.trim()) {
            updated[questionId] = answer;
            filledIds.push(questionId);
          }
        }
        return updated;
      });

      setPrefillDone(true);
      setPrefillPanelOpen(false);
      setHasUnsavedChanges(true);

      // Auto-save the pre-filled answers (only the ones we actually filled)
      for (const questionId of filledIds) {
        const answer = prefillAnswers[questionId];
        if (answer?.trim()) {
          handleSaveAnswer(questionId, answer);
        }
      }

      await showAlert({
        title: "Pre-Fill Complete",
        message: `Pre-filled ${data.filledCount} of ${data.totalQuestions} questions from your materials. Review and edit the answers below!`,
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const pdfs = selected.filter((f) => f.type === "application/pdf");
    setPrefillFiles((prev) => [...prev, ...pdfs]);
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setPrefillFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    // Save all answers first
    await handleSaveAll();

    setGenerating(true);
    try {
      const response = await fetch("/api/sales-narrative/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate narrative");
      }

      const data = await response.json();
      setHasUnsavedChanges(false);
      // Navigate to the main page which will show the new version
      router.push(`/sales-narrative?version=${data.version.id}`);
    } catch (error) {
      console.error("Error generating narrative:", error);
      await showAlert({
        title: "Error",
        message: error instanceof Error ? error.message : "Failed to generate narrative. Please try again.",
        variant: "danger",
      });
      setGenerating(false);
    }
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
      {generating && (
        <div className="fixed inset-0 bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-700 z-50 flex flex-col items-center justify-center text-white">
          <div className="flex gap-3 text-5xl mb-8">
            {["✍️", "📝", "✨"].map((emoji, i) => (
              <span
                key={i}
                className="animate-bounce"
                style={{ animationDelay: `${i * 0.2}s`, animationDuration: "1s" }}
              >
                {emoji}
              </span>
            ))}
          </div>

          <div className="relative w-20 h-20 mb-8">
            <div className="absolute inset-0 border-4 border-white/20 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-transparent border-t-white rounded-full animate-spin"></div>
            <div className="absolute inset-2 border-4 border-transparent border-t-white/60 rounded-full animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }}></div>
          </div>

          <h3 className="text-2xl font-bold mb-4 text-center px-6">
            Generating Your Sales Narrative
          </h3>

          <div className="h-8 flex items-center justify-center">
            <p className="text-lg text-white/90 animate-pulse">
              {LOADING_MESSAGES[loadingMessageIndex]}...
            </p>
          </div>

          <p className="text-sm text-white/60 mt-8">
            Creating your narrative, value propositions, and tagline
          </p>
        </div>
      )}

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
                <p className="text-xs text-gray-400 mt-1">
                  We&apos;ll crawl your site for product, solution, customer, and pricing pages
                </p>
              </div>

              {/* PDF Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PDF Files <span className="text-gray-400 font-normal">(sales decks, one-pagers, etc.)</span>
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={prefilling}
                    className="px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-lg hover:border-amber-400 hover:bg-amber-50 transition-colors text-sm text-gray-600 flex items-center gap-2 disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add PDFs
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  {prefillFiles.length === 0 && (
                    <span className="text-sm text-gray-400">No files selected</span>
                  )}
                </div>

                {/* File chips */}
                {prefillFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
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
                )}
              </div>

              {/* Action button */}
              <div className="flex items-center gap-4 pt-2">
                <button
                  onClick={handlePrefill}
                  disabled={prefilling || (!prefillUrl.trim() && prefillFiles.length === 0)}
                  className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
                >
                  {prefilling ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {PREFILL_MESSAGES[prefillMessageIndex]}...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Analyze &amp; Pre-Fill
                    </>
                  )}
                </button>

                {prefilling && (
                  <p className="text-sm text-gray-500 animate-pulse">
                    This may take 30-60 seconds...
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

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
