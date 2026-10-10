"use client";

import { useState, useRef, useEffect } from "react";

interface ExtendNarrativeModalProps {
  isOpen: boolean;
  parentVersionId: string;
  onClose: () => void;
  onComplete: (newVersionId: string) => void;
}

interface ExtractedSource {
  type: "url" | "pdf";
  key: string;
  content: string;
}

interface QuestionAnswer {
  questionId: string;
  question: string;
  category: string;
  globalOrder: number;
  answer: string;
}

type Step = "input" | "extending" | "review" | "generating" | "done";

export default function ExtendNarrativeModal({
  isOpen,
  parentVersionId,
  onClose,
  onComplete,
}: ExtendNarrativeModalProps) {
  const [step, setStep] = useState<Step>("input");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [specificUrls, setSpecificUrls] = useState<string[]>([""]);
  // Holds both PDFs and images — split server-side by mime/extension
  // on submit. Naming kept as pdfFiles for the smallest-diff refactor
  // of the existing modal state.
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionAnswer[]>([]);
  const [generatingProgress, setGeneratingProgress] = useState<string>("");

  // Sources collected from the extend-stream SSE — passed forward to
  // generate-stream so the new version persists them.
  const sourcesRef = useRef<{
    parentVersionId: string;
    extractedSources: ExtractedSource[];
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      // Reset on close so reopening is a fresh modal.
      setStep("input");
      setWebsiteUrl("");
      setSpecificUrls([""]);
      setPdfFiles([]);
      setError(null);
      setQuestions([]);
      setGeneratingProgress("");
      sourcesRef.current = null;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const hasInputs = !!websiteUrl.trim() || specificUrls.some((u) => u.trim()) || pdfFiles.length > 0;

  const uploadFiles = async (): Promise<{
    pdfs: { name: string; storagePath: string }[];
    images: { name: string; storagePath: string; mimeType: string }[];
  }> => {
    if (pdfFiles.length === 0) return { pdfs: [], images: [] };
    const urlRes = await fetch("/api/files/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: pdfFiles.map((f) => ({ name: f.name })),
        source: "narrative-extend",
      }),
    });
    if (!urlRes.ok) throw new Error("Failed to get upload URLs");
    const { files: fileEntries } = (await urlRes.json()) as {
      files: Array<{ name: string; storagePath: string; signedUrl: string }>;
    };
    await Promise.all(
      fileEntries.map(async (entry, i) => {
        const file = pdfFiles.find((f) => f.name === entry.name) || pdfFiles[i];
        const putRes = await fetch(entry.signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Failed to upload ${entry.name}`);
      })
    );

    const fileByName = new Map(pdfFiles.map((f) => [f.name, f]));
    const pdfs: { name: string; storagePath: string }[] = [];
    const images: { name: string; storagePath: string; mimeType: string }[] = [];
    for (const entry of fileEntries) {
      const original = fileByName.get(entry.name);
      const mimeType = original?.type || "";
      const lower = entry.name.toLowerCase();
      const isImage =
        mimeType.startsWith("image/") ||
        lower.endsWith(".png") || lower.endsWith(".jpg") ||
        lower.endsWith(".jpeg") || lower.endsWith(".webp") || lower.endsWith(".gif");
      if (isImage) {
        images.push({ name: entry.name, storagePath: entry.storagePath, mimeType: mimeType || "image/png" });
      } else {
        pdfs.push({ name: entry.name, storagePath: entry.storagePath });
      }
    }
    return { pdfs, images };
  };

  const handleExtend = async () => {
    if (!hasInputs) return;
    setStep("extending");
    setError(null);
    setQuestions([]);

    try {
      const { pdfs, images } = await uploadFiles();
      const res = await fetch("/api/sales-narrative/extend-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentVersionId,
          newWebsiteUrl: websiteUrl.trim() || undefined,
          newSpecificUrls: specificUrls.filter((u) => u.trim()),
          newPdfFiles: pdfs.length > 0 ? pdfs : undefined,
          newImageFiles: images.length > 0 ? images : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Extend failed (${res.status})`);
      }

      // Build a question map as we receive answers.
      const questionsByID = new Map<string, QuestionAnswer>();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      // Pull the canonical question set so we can hydrate the labels
      // as answers stream in.
      const qRes = await fetch("/api/sales-narrative/questions");
      if (qRes.ok) {
        const qData = await qRes.json();
        for (const q of qData.questions || []) {
          questionsByID.set(q.id, {
            questionId: q.id,
            question: q.question,
            category: q.category,
            globalOrder: q.globalOrder,
            answer: "",
          });
        }
        setQuestions(Array.from(questionsByID.values()).sort((a, b) => a.globalOrder - b.globalOrder));
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (currentEvent === "sources") {
                sourcesRef.current = {
                  parentVersionId: parsed.parentVersionId,
                  extractedSources: parsed.extractedSources || [],
                };
              } else if (currentEvent === "answer") {
                const q = questionsByID.get(parsed.questionId);
                if (q) {
                  q.answer = parsed.answer;
                  setQuestions(Array.from(questionsByID.values()).sort((a, b) => a.globalOrder - b.globalOrder));
                }
              } else if (currentEvent === "error") {
                throw new Error(parsed.error || "Stream error");
              }
            } catch (parseErr) {
              if (currentEvent === "error") throw parseErr;
              /* otherwise ignore parse errors mid-stream */
            }
          }
        }
      }

      setStep("review");
    } catch (err) {
      console.error("[ExtendModal] extend failed:", err);
      setError(err instanceof Error ? err.message : "Extend failed");
      setStep("input");
    }
  };

  const handleGenerate = async () => {
    if (!sourcesRef.current) {
      setError("No sources collected from extend pass");
      return;
    }
    setStep("generating");
    setError(null);

    try {
      // Save the (possibly user-edited) answers first so generate-
      // stream's per-question latest-answer lookup picks them up.
      await Promise.all(
        questions
          .filter((q) => q.answer && q.answer.trim())
          .map((q) =>
            fetch(`/api/sales-narrative/answers/${q.questionId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ answer: q.answer }),
            }).catch((e) => console.error("[ExtendModal] save answer failed:", e))
          )
      );

      const res = await fetch("/api/sales-narrative/generate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentVersionId: sourcesRef.current.parentVersionId,
          extractedSources: sourcesRef.current.extractedSources,
          // sourceUrls / sourcePdfNames are derived from the union the
          // server already knows about via parentVersionId + new sources.
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Generate failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let newVersionId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (currentEvent === "narrative_token") {
                setGeneratingProgress((p) => p + (parsed.token || ""));
              } else if (currentEvent === "complete" && parsed.versionId) {
                newVersionId = parsed.versionId;
              }
            } catch { /* ignore */ }
          }
        }
      }

      if (newVersionId) {
        setStep("done");
        onComplete(newVersionId);
      } else {
        throw new Error("Generate finished but no versionId returned");
      }
    } catch (err) {
      console.error("[ExtendModal] generate failed:", err);
      setError(err instanceof Error ? err.message : "Generate failed");
      setStep("review");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Extend Sales Narrative
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-md border border-red-200 bg-red-50 text-red-700 text-sm">
              {error}
            </div>
          )}

          {step === "input" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Add new source documents. Mikey will combine them with the original
                sources to re-draft your Q&amp;A, then you can generate an updated narrative.
              </p>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Website URL (optional — Mikey will re-crawl this site)
                </label>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://newsubsite.example.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Specific URLs (optional)
                </label>
                {specificUrls.map((u, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={u}
                      onChange={(e) => {
                        const next = [...specificUrls];
                        next[i] = e.target.value;
                        setSpecificUrls(next);
                      }}
                      placeholder="https://example.com/blog/launch"
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800"
                    />
                    {specificUrls.length > 1 && (
                      <button
                        onClick={() => setSpecificUrls(specificUrls.filter((_, idx) => idx !== i))}
                        className="text-gray-400 hover:text-red-600 text-sm"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setSpecificUrls([...specificUrls, ""])}
                  className="text-xs text-purple-600 dark:text-purple-300 hover:underline"
                >
                  + Add another URL
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">
                  PDFs or images (optional) — PNG / JPG one-pagers, screenshots, slides
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf,.png,.jpg,.jpeg,.webp,.gif,image/*"
                  multiple
                  onChange={(e) => {
                    const incoming = Array.from(e.target.files || []);
                    if (incoming.length === 0) return;
                    setPdfFiles((prev) => {
                      const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
                      const merged = [...prev];
                      for (const f of incoming) {
                        const key = `${f.name}|${f.size}`;
                        if (!seen.has(key)) { seen.add(key); merged.push(f); }
                      }
                      return merged;
                    });
                    // Reset so picking the same file twice still fires onChange.
                    e.target.value = "";
                  }}
                  className="hidden"
                />
                <div
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingOver(false);
                    const dropped = Array.from(e.dataTransfer.files || []).filter((f) =>
                      f.type === "application/pdf" || f.type.startsWith("image/")
                    );
                    if (dropped.length === 0) return;
                    setPdfFiles((prev) => {
                      const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
                      const merged = [...prev];
                      for (const f of dropped) {
                        const key = `${f.name}|${f.size}`;
                        if (!seen.has(key)) { seen.add(key); merged.push(f); }
                      }
                      return merged;
                    });
                  }}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDragEnter={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
                  onDragLeave={(e) => {
                    // Only clear when the drag actually leaves the drop zone
                    // (not when crossing onto a child element).
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setIsDraggingOver(false);
                  }}
                  className={`relative border-2 border-dashed rounded-lg transition-colors ${
                    isDraggingOver
                      ? "border-purple-400 bg-purple-50 dark:bg-purple-900/20"
                      : "border-gray-300 dark:border-gray-700 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/10"
                  }`}
                >
                  {pdfFiles.length === 0 ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center justify-center py-6 cursor-pointer"
                    >
                      <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                        {isDraggingOver ? "Drop files here" : "Click to upload or drag & drop"}
                      </span>
                      <span className="text-xs text-gray-400 mt-1">PDF, PNG, JPG, WEBP, GIF</span>
                    </div>
                  ) : (
                    <div className="p-4">
                      <div className="flex flex-wrap gap-2">
                        {pdfFiles.map((file, i) => {
                          const isImage = file.type.startsWith("image/");
                          return (
                            <span
                              key={`${file.name}-${i}`}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border ${
                                isImage
                                  ? "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200"
                                  : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200"
                              }`}
                            >
                              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                {isImage ? (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                ) : (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                )}
                              </svg>
                              {file.name}
                              <button
                                type="button"
                                onClick={() => setPdfFiles((prev) => prev.filter((_, idx) => idx !== i))}
                                className="ml-0.5 opacity-60 hover:opacity-100"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 mt-3 text-sm text-purple-600 hover:text-purple-700 dark:text-purple-300 cursor-pointer"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add more files
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === "extending" && (
            <div className="py-8 text-center">
              <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Extracting new sources + re-drafting your Q&amp;A with the combined context…
              </p>
              {questions.filter((q) => q.answer).length > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  {questions.filter((q) => q.answer).length} of {questions.length} answers ready
                </p>
              )}
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Review the updated Q&amp;A below. Edit anything inline. When you&apos;re happy,
                generate the new narrative.
              </p>
              {questions.map((q) => (
                <div key={q.questionId} className="space-y-1">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">
                    <span className="text-gray-400">{q.category}</span> · {q.question}
                  </label>
                  <textarea
                    value={q.answer}
                    onChange={(e) => {
                      const next = questions.map((qq) =>
                        qq.questionId === q.questionId ? { ...qq, answer: e.target.value } : qq
                      );
                      setQuestions(next);
                    }}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800"
                  />
                </div>
              ))}
            </div>
          )}

          {step === "generating" && (
            <div className="py-8">
              <div className="flex items-center gap-3 mb-3">
                <svg className="animate-spin h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm text-gray-700 dark:text-gray-200">Generating updated narrative…</p>
              </div>
              {generatingProgress && (
                <pre className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap max-h-64 overflow-y-auto bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
                  {generatingProgress.slice(-2000)}
                </pre>
              )}
            </div>
          )}

          {step === "done" && (
            <div className="py-8 text-center">
              <div className="text-4xl mb-3">✓</div>
              <p className="text-sm text-gray-700 dark:text-gray-200">
                New narrative version created. Redirecting…
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          {step === "input" && (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleExtend}
                disabled={!hasInputs}
                className="px-4 py-1.5 text-sm font-medium bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
              >
                Extract + redraft Q&amp;A
              </button>
            </>
          )}
          {step === "review" && (
            <>
              <button
                onClick={() => setStep("input")}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                ← Back
              </button>
              <button
                onClick={handleGenerate}
                className="px-4 py-1.5 text-sm font-medium bg-purple-600 text-white rounded-md hover:bg-purple-700"
              >
                Generate updated narrative
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
