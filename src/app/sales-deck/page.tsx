"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dynamic from "next/dynamic";
import { copyMarkdownAsRichText } from "@/lib/clipboard";
import { useConfirmModal } from "@/components/useConfirmModal";
import SalesNavBar from "@/components/SalesNavBar";
import { ShareDocumentButton } from "@/components/ShareDocumentButton";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { NewButtonDropdown } from "@/components/NewButtonDropdown";

const RichTextEditor = dynamic(
  () => import("@/components/RichTextEditor"),
  { ssr: false }
);

interface SalesDeckVersion {
  id: string;
  content: string;
  orgPersona: string;
  humanPersona: string;
  specialNotes?: string | null;
  deckMode: string;
  sourcePdfName?: string | null;
  salesNarrativeVersionId: string;
  salesNarrativeVersion?: {
    id: string;
    createdAt: string;
  };
  firstCallChecklistVersionId?: string | null;
  conversationId?: string | null;
  // Gamma-specific fields
  gammaUrl?: string | null;
  gammaPdfUrl?: string | null;
  gammaPptxUrl?: string | null;
  prospectUrl?: string | null;
  contextUrls?: string[];
  contextPdfNames?: string[];
  brandAnalysis?: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function SalesDeckPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <SalesDeckContent />
    </Suspense>
  );
}

function SalesDeckContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [version, setVersion] = useState<SalesDeckVersion | null>(null);
  const [hasSalesNarrative, setHasSalesNarrative] = useState(false);
  const [hasFirstCallChecklist, setHasFirstCallChecklist] = useState(false);
  const [copied, setCopied] = useState(false);

  // Persona form state
  const [showForm, setShowForm] = useState(false);
  const [orgPersona, setOrgPersona] = useState("");
  const [humanPersona, setHumanPersona] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [deckMode, setDeckMode] = useState<"fresh" | "existing" | "gamma">("gamma");
  const [includeChecklist, setIncludeChecklist] = useState(false);
  const [existingDeckFile, setExistingDeckFile] = useState<File | null>(null);
  const [existingDeckText, setExistingDeckText] = useState("");
  const [existingDeckFileName, setExistingDeckFileName] = useState("");
  const [parsingPdf, setParsingPdf] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // Gamma-specific state
  const [prospectUrl, setProspectUrl] = useState("");
  const [contextUrls, setContextUrls] = useState<string[]>([""]);
  const [contextPdfFiles, setContextPdfFiles] = useState<File[]>([]);
  const [contextPdfTexts, setContextPdfTexts] = useState<Array<{ fileName: string; text: string }>>([]);
  const [parsingContextPdf, setParsingContextPdf] = useState(false);
  const [analyzingBrand, setAnalyzingBrand] = useState(false);
  const [brandAnalysis, setBrandAnalysis] = useState("");
  const [brandScreenshot, setBrandScreenshot] = useState("");
  const [gammaDragOver, setGammaDragOver] = useState(false);
  const gammaFileInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { alert: showAlert, confirm: showConfirm, ConfirmModalElement } = useConfirmModal();
  const [importing, setImporting] = useState(false);
  const [retryingGamma, setRetryingGamma] = useState(false);

  useEffect(() => {
    document.title = "Sales Deck - Mikey";
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        // Pre-populate prospect URL from user's email domain
        if (authData.user.email && !prospectUrl) {
          const domain = authData.user.email.split("@")[1];
          if (domain && !["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "protonmail.com", "mail.com", "zoho.com"].includes(domain.toLowerCase())) {
            setProspectUrl(domain);
          }
        }

        // Check for first call checklist availability
        fetch("/api/first-call-checklist/latest")
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.hasFirstCallChecklist) setHasFirstCallChecklist(true); })
          .catch(() => {});

        let url = "/api/sales-deck/latest";
        if (versionId) {
          url = `/api/sales-deck/versions/${versionId}`;
        }

        const response = await fetch(url);
        if (!response.ok) return;

        const data = await response.json();

        if (versionId) {
          setVersion(data.version);
          setEditedContent(data.version?.content || "");
          setHasSalesNarrative(true);
        } else {
          setHasSalesNarrative(data.hasSalesNarrative !== false);
          if (data.hasSalesDeck) {
            setVersion(data.version);
            setEditedContent(data.version?.content || "");
          }
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router, versionId]);

  // Auto-prefill personas when form is visible
  useEffect(() => {
    if (!loading && !orgPersona && !humanPersona && !prefilling && hasSalesNarrative) {
      if (!version || showForm) {
        handlePrefill();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, showForm, version, hasSalesNarrative]);

  const handlePrefill = async () => {
    setPrefilling(true);
    try {
      const res = await fetch("/api/sales-deck/prefill-personas", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.orgPersona) setOrgPersona(data.orgPersona);
        if (data.humanPersona) setHumanPersona(data.humanPersona);
      }
    } catch {
      // silently fail
    } finally {
      setPrefilling(false);
    }
  };

  const handlePdfUpload = async (file: File) => {
    setParsingPdf(true);
    setExistingDeckFile(file);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/sales-deck/parse-pdf", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json();
        await showAlert({ title: "Error", message: data.error || "Failed to parse PDF", variant: "danger" });
        setExistingDeckFile(null);
        return;
      }
      const data = await res.json();
      setExistingDeckText(data.text);
      setExistingDeckFileName(data.fileName);
    } catch {
      await showAlert({ title: "Error", message: "Failed to parse PDF. Please try again.", variant: "danger" });
      setExistingDeckFile(null);
    } finally {
      setParsingPdf(false);
    }
  };

  const handleRemovePdf = () => {
    setExistingDeckFile(null);
    setExistingDeckText("");
    setExistingDeckFileName("");
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  // --- Gamma handlers ---

  const handleContextPdfUpload = async (files: File[]) => {
    setParsingContextPdf(true);
    const newTexts: Array<{ fileName: string; text: string }> = [];
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/sales-deck/parse-pdf", { method: "POST", body: formData });
        if (res.ok) {
          const data = await res.json();
          newTexts.push({ fileName: data.fileName, text: data.text });
        }
      }
      setContextPdfFiles((prev) => [...prev, ...files]);
      setContextPdfTexts((prev) => [...prev, ...newTexts]);
    } catch {
      await showAlert({ title: "Error", message: "Failed to parse one or more PDFs.", variant: "danger" });
    } finally {
      setParsingContextPdf(false);
    }
  };

  const handleRemoveContextPdf = (index: number) => {
    setContextPdfFiles((prev) => prev.filter((_, i) => i !== index));
    setContextPdfTexts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAnalyzeBrand = async () => {
    const url = prospectUrl.trim();
    if (!url) {
      await showAlert({ title: "Missing URL", message: "Enter your website URL first.", variant: "danger" });
      return;
    }
    setAnalyzingBrand(true);
    try {
      const res = await fetch("/api/sales-deck/analyze-brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.startsWith("http") ? url : `https://${url}` }),
      });
      if (!res.ok) {
        const data = await res.json();
        await showAlert({ title: "Error", message: data.error || "Brand analysis failed", variant: "danger" });
        return;
      }
      const data = await res.json();
      setBrandAnalysis(data.brandAnalysis);
      setBrandScreenshot(data.screenshotDataUrl);
    } catch {
      await showAlert({ title: "Error", message: "Brand analysis failed. Please try again.", variant: "danger" });
    } finally {
      setAnalyzingBrand(false);
    }
  };

  const handleGenerateGamma = async () => {
    if (!orgPersona.trim() || !humanPersona.trim()) {
      await showAlert({
        title: "Missing Fields",
        message: "Please fill in both the organization persona and target role.",
        variant: "danger",
      });
      return;
    }

    setGenerating(true);
    try {
      const filteredUrls = contextUrls.filter((u) => u.trim());
      const response = await fetch("/api/sales-deck/generate-gamma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgPersona: orgPersona.trim(),
          humanPersona: humanPersona.trim(),
          specialNotes: specialNotes.trim() || undefined,
          prospectUrl: prospectUrl.trim() || undefined,
          contextUrls: filteredUrls,
          brandAnalysis: brandAnalysis || undefined,
          contextPdfTexts,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        await showAlert({
          title: "Error",
          message: data.error || "Failed to generate Gamma presentation",
          variant: "danger",
        });
        return;
      }

      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      setShowForm(false);

      if (data.gammaFailed) {
        await showAlert({
          title: "Gamma Presentation Unavailable",
          message: "The deck outline was generated successfully, but we couldn't create the Gamma presentation. You can retry from the results page or use the outline as-is.",
          variant: "warning",
        });
      }
    } catch (error) {
      console.error("Error generating Gamma deck:", error);
      await showAlert({
        title: "Error",
        message: "Failed to generate Gamma presentation. Please try again.",
        variant: "danger",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleRetryGamma = async () => {
    if (!version) return;
    setRetryingGamma(true);
    try {
      const response = await fetch("/api/sales-deck/retry-gamma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id }),
      });

      if (!response.ok) {
        const data = await response.json();
        await showAlert({
          title: "Gamma Generation Failed",
          message: data.error || "Failed to generate Gamma presentation. Please try again.",
          variant: "danger",
        });
        return;
      }

      const data = await response.json();
      setVersion({
        ...version,
        gammaUrl: data.gammaUrl,
        gammaPdfUrl: data.gammaPdfUrl,
        gammaPptxUrl: data.gammaPptxUrl,
      });
    } catch (error) {
      console.error("Error retrying Gamma:", error);
      await showAlert({
        title: "Error",
        message: "Failed to generate Gamma presentation. Please try again.",
        variant: "danger",
      });
    } finally {
      setRetryingGamma(false);
    }
  };

  const handleGenerate = async () => {
    if (deckMode === "gamma") {
      return handleGenerateGamma();
    }

    if (!orgPersona.trim() || !humanPersona.trim()) {
      await showAlert({
        title: "Missing Fields",
        message: "Please fill in both the organization persona and target role.",
        variant: "danger",
      });
      return;
    }

    if (deckMode === "existing" && !existingDeckText) {
      await showAlert({
        title: "Missing Deck",
        message: "Please upload your existing deck PDF to use 'Improve Existing' mode.",
        variant: "danger",
      });
      return;
    }

    setGenerating(true);
    try {
      const response = await fetch("/api/sales-deck/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgPersona: orgPersona.trim(),
          humanPersona: humanPersona.trim(),
          specialNotes: specialNotes.trim() || undefined,
          deckMode,
          includeFirstCallChecklist: includeChecklist,
          existingDeckContent: deckMode === "existing" ? existingDeckText : undefined,
          existingDeckFileName: deckMode === "existing" ? existingDeckFileName : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        await showAlert({
          title: "Error",
          message: data.error || "Failed to generate sales deck",
          variant: "danger",
        });
        return;
      }

      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      setShowForm(false);
    } catch (error) {
      console.error("Error generating:", error);
      await showAlert({
        title: "Error",
        message: "Failed to generate sales deck. Please try again.",
        variant: "danger",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    if (version) {
      setOrgPersona(version.orgPersona);
      setHumanPersona(version.humanPersona);
      setSpecialNotes(version.specialNotes || "");
      setDeckMode(version.deckMode as "fresh" | "existing" | "gamma");
      setIncludeChecklist(!!version.firstCallChecklistVersionId);
      // Restore gamma-specific fields
      if (version.deckMode === "gamma") {
        setProspectUrl(version.prospectUrl || "");
        setBrandAnalysis(version.brandAnalysis || "");
      }
    }
    setShowForm(true);
  };

  const handleImportPDF = async (file: File) => {
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("appletType", "salesDeck");
      const response = await fetch("/api/import", { method: "POST", body: formData });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to import PDF", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      setShowForm(false);
    } catch (error) {
      console.error("Error importing PDF:", error);
      await showAlert({ title: "Error", message: "Failed to import PDF. Please try again.", variant: "danger" });
    } finally {
      setImporting(false);
    }
  };

  const handleCopy = async () => {
    if (!version) return;
    const success = await copyMarkdownAsRichText(version.content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDelete = async () => {
    if (!version) return;
    const confirmed = await showConfirm({
      title: "Delete Sales Deck",
      message: "Are you sure you want to delete this Sales Deck? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales-deck/versions/${version.id}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        if (data.hasRemaining) {
          window.location.href = "/sales-deck";
        } else {
          router.push("/sales-deck");
        }
      } else {
        setDeleting(false);
        await showAlert({ title: "Error", message: "Failed to delete. Please try again.", variant: "danger" });
      }
    } catch {
      setDeleting(false);
      await showAlert({ title: "Error", message: "Failed to delete. Please try again.", variant: "danger" });
    }
  };

  const handleClone = async () => {
    if (!version) return;
    try {
      const res = await fetch("/api/documents/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: "salesDeck", documentId: version.id }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (error) {
      console.error("Error cloning:", error);
    }
  };

  const handleStartEditing = () => {
    if (version) setEditedContent(version.content);
    setIsEditing(true);
  };

  const handleCancelEditing = () => {
    if (version) setEditedContent(version.content);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!version) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/sales-deck/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent }),
      });

      if (!response.ok) throw new Error("Failed to save");

      const data = await response.json();
      setVersion({
        ...version,
        content: data.version.content,
        updatedAt: data.version.updatedAt,
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Error saving:", error);
      await showAlert({
        title: "Error",
        message: "Failed to save changes. Please try again.",
        variant: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  };

  const deckModeLabel = (mode: string) =>
    mode === "gamma" ? "Gamma Presentation" : mode === "existing" ? "Existing Deck Improvement" : "Fresh Deck";

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
            <p className="text-gray-600">Loading sales deck...</p>
          </div>
        </div>
      </div>
    );
  }

  // No sales narrative - gate
  if (!hasSalesNarrative && !version) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">📖</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Sales Narrative Required</h1>
            <p className="text-gray-600 mb-6">
              The sales deck is generated from your sales narrative. Create a sales narrative first to get started.
            </p>
            <Link
              href="/sales-narrative"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              Create Sales Narrative
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Persona configuration form (no version yet, or regenerating)
  if (!version || showForm) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="w-full max-w-3xl px-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
              <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
                {version ? "Regenerate" : "Generate"} Sales Deck
              </h1>
              <p className="text-gray-500 mb-6">Configure the target persona and deck style for your sales presentation.</p>

              {/* Sales Narrative Info Banner */}
              {hasSalesNarrative && (
                <div className="mb-6 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl flex-shrink-0">📖</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-amber-900">Your Sales Narrative will power this deck</h3>
                      <p className="text-xs text-amber-700 mt-0.5">
                        Mikey will use your completed Sales Narrative — including product details, positioning, competitive advantages, and customer stories — to generate a tailored deck.
                      </p>
                      <a
                        href="/sales-narrative"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-amber-800 hover:text-amber-950 underline underline-offset-2"
                      >
                        View your Sales Narrative
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {/* Deck Mode Toggle */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Deck Mode
                  </label>
                  <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setDeckMode("gamma")}
                      className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                        deckMode === "gamma"
                          ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      Gamma Deck
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeckMode("fresh")}
                      className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors border-l border-gray-300 ${
                        deckMode === "fresh"
                          ? "bg-purple-600 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      Fresh Deck
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeckMode("existing")}
                      className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors border-l border-gray-300 ${
                        deckMode === "existing"
                          ? "bg-purple-600 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      Improve Existing
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {deckMode === "gamma"
                      ? "Generate a polished Gamma presentation with brand-matched styling"
                      : deckMode === "fresh"
                      ? "Create a brand new deck outline with speaker notes from your sales narrative"
                      : "Upload your existing deck PDF and get AI-powered improvement suggestions"}
                  </p>
                </div>

                {/* Hidden file input — always rendered so ref is stable */}
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePdfUpload(file);
                    e.target.value = "";
                  }}
                />

                {deckMode === "existing" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Upload Existing Deck <span className="text-red-500">*</span>
                    </label>
                    {existingDeckFile && existingDeckText ? (
                      <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-green-800 truncate">{existingDeckFile.name}</p>
                          <p className="text-xs text-green-600">{Math.round(existingDeckText.length / 1000)}k characters extracted</p>
                        </div>
                        <button
                          onClick={handleRemovePdf}
                          className="p-1 text-green-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Remove file"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : parsingPdf ? (
                      <div className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                        <svg className="animate-spin h-5 w-5 text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-sm text-purple-700">Parsing PDF...</span>
                      </div>
                    ) : (
                      <div
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
                        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOver(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file && file.name.toLowerCase().endsWith(".pdf")) {
                            handlePdfUpload(file);
                          }
                        }}
                        onClick={() => pdfInputRef.current?.click()}
                        className={`w-full p-4 border-2 border-dashed rounded-lg transition-colors cursor-pointer text-center ${
                          dragOver
                            ? "border-purple-500 bg-purple-50"
                            : "border-gray-300 hover:border-purple-400 hover:bg-purple-50"
                        }`}
                      >
                        <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <p className="text-sm font-medium text-gray-700">
                          {dragOver ? "Drop your PDF here" : "Click or drag & drop your deck PDF"}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">PDF files up to 50 pages supported</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Gamma-specific fields */}
                {deckMode === "gamma" && (
                  <>
                    {/* Hidden file input for gamma PDFs */}
                    <input
                      ref={gammaFileInputRef}
                      type="file"
                      accept=".pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) handleContextPdfUpload(Array.from(files));
                        e.target.value = "";
                      }}
                    />

                    {/* Your Website URL + Brand Analysis */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Your Website URL <span className="text-gray-400">(optional)</span>
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        We&apos;ll analyze your brand to match your deck&apos;s look & feel
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={prospectUrl}
                          onChange={(e) => setProspectUrl(e.target.value)}
                          placeholder="e.g. yourcompany.com"
                          disabled={analyzingBrand}
                          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-50"
                        />
                        <button
                          type="button"
                          onClick={handleAnalyzeBrand}
                          disabled={analyzingBrand || !prospectUrl.trim()}
                          className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 text-sm font-medium whitespace-nowrap flex items-center gap-2"
                        >
                          {analyzingBrand ? (
                            <>
                              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Analyzing...
                            </>
                          ) : (
                            "Analyze Brand"
                          )}
                        </button>
                      </div>
                      {brandAnalysis && (
                        <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                          <div className="flex items-start gap-2">
                            <svg className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-indigo-800">Brand analysis complete</p>
                              <p className="text-xs text-indigo-600 mt-0.5 line-clamp-2">{brandAnalysis.slice(0, 150)}...</p>
                            </div>
                            <button
                              onClick={() => { setBrandAnalysis(""); setBrandScreenshot(""); }}
                              className="p-1 text-indigo-400 hover:text-red-500 rounded transition-colors"
                              title="Clear analysis"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Context URLs */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Context Page URLs <span className="text-gray-400">(optional)</span>
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Paste links to product pages, case studies, or competitor sites for extra context
                      </p>
                      <div className="space-y-2">
                        {contextUrls.map((url, i) => (
                          <div key={i} className="flex gap-2">
                            <input
                              type="text"
                              value={url}
                              onChange={(e) => {
                                const updated = [...contextUrls];
                                updated[i] = e.target.value;
                                // Auto-add new row when typing in last field
                                if (i === contextUrls.length - 1 && e.target.value.trim()) {
                                  updated.push("");
                                }
                                setContextUrls(updated);
                              }}
                              placeholder="https://..."
                              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                            />
                            {contextUrls.length > 1 && (
                              <button
                                onClick={() => setContextUrls(contextUrls.filter((_, idx) => idx !== i))}
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Context PDFs */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Context PDFs <span className="text-gray-400">(optional)</span>
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Upload sales decks, one-pagers, or case study PDFs for additional context
                      </p>
                      {contextPdfFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {contextPdfFiles.map((file, i) => (
                            <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-full text-sm">
                              <span className="text-purple-800 truncate max-w-[200px]">{file.name}</span>
                              <button
                                onClick={() => handleRemoveContextPdf(i)}
                                className="p-0.5 text-purple-400 hover:text-red-500 rounded-full transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {parsingContextPdf ? (
                        <div className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                          <svg className="animate-spin h-5 w-5 text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span className="text-sm text-purple-700">Parsing PDFs...</span>
                        </div>
                      ) : (
                        <div
                          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setGammaDragOver(true); }}
                          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setGammaDragOver(false); }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setGammaDragOver(false);
                            const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
                            if (files.length > 0) handleContextPdfUpload(files);
                          }}
                          onClick={() => gammaFileInputRef.current?.click()}
                          className={`w-full p-4 border-2 border-dashed rounded-lg transition-colors cursor-pointer text-center ${
                            gammaDragOver
                              ? "border-purple-500 bg-purple-50"
                              : "border-gray-300 hover:border-purple-400 hover:bg-purple-50"
                          }`}
                        >
                          <svg className="w-6 h-6 text-gray-400 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <p className="text-sm font-medium text-gray-700">
                            {gammaDragOver ? "Drop PDFs here" : "Click or drag & drop PDFs"}
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Organizational Persona
                  </label>
                  <div className="relative">
                    <textarea
                      value={orgPersona}
                      onChange={(e) => setOrgPersona(e.target.value)}
                      placeholder={prefilling ? "AI is thinking..." : "e.g. Series B SaaS company"}
                      disabled={prefilling}
                      rows={3}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-50 resize-y"
                    />
                    <button
                      onClick={handlePrefill}
                      disabled={prefilling}
                      className="absolute right-2 top-2 p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-colors disabled:opacity-50"
                      title="AI Prefill"
                    >
                      {prefilling ? (
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Target Role / Human Persona
                  </label>
                  <div className="relative">
                    <textarea
                      value={humanPersona}
                      onChange={(e) => setHumanPersona(e.target.value)}
                      placeholder={prefilling ? "AI is thinking..." : "e.g. VP of Sales"}
                      disabled={prefilling}
                      rows={3}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-50 resize-y"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Special Notes <span className="text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    value={specialNotes}
                    onChange={(e) => setSpecialNotes(e.target.value)}
                    placeholder="e.g. Focus on ROI metrics, include competitive positioning against Salesforce..."
                    rows={3}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y"
                  />
                </div>

                {hasFirstCallChecklist && (
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeChecklist}
                      onChange={(e) => setIncludeChecklist(e.target.checked)}
                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    Include First Call Checklist context
                  </label>
                )}

                <div className="flex items-center gap-3 pt-2">
                  {version && (
                    <button
                      onClick={() => setShowForm(false)}
                      className="px-4 py-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleGenerate}
                    disabled={generating || prefilling || parsingPdf || parsingContextPdf || analyzingBrand || (deckMode === "existing" && !existingDeckText)}
                    className="flex-1 px-6 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {generating ? (
                      <>
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        {deckMode === "gamma" ? "Generate Gamma Deck" : "Generate Sales Deck"}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {ConfirmModalElement}
      </div>
    );
  }

  // Generated view
  const currentContent = isEditing ? editedContent : version.content;

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={generating}
        title={version?.deckMode === "gamma" || deckMode === "gamma" ? "Generating Gamma Presentation" : "Generating Sales Deck"}
        subtitle={version?.deckMode === "gamma" || deckMode === "gamma" ? "Building a polished, brand-matched presentation" : "Crafting a compelling presentation that wins deals"}
        emojis={version?.deckMode === "gamma" || deckMode === "gamma" ? ["🎨", "📊", "🚀"] : ["📊", "🎯", "🎤"]}
        messages={version?.deckMode === "gamma" || deckMode === "gamma" ? [
          "Analyzing your sales narrative",
          "Scraping context from provided URLs",
          "Processing PDF documents",
          "Pre-processing content with AI",
          "Generating slides via Gamma",
          "Exporting to PDF and PPTX",
          "Almost there...",
        ] : [
          "Analyzing your sales narrative",
          "Structuring the problem slides",
          "Crafting the solution story",
          "Building social proof section",
          "Writing speaker scripts",
          "Polishing your deck outline",
        ]}
      />
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
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
                <h1 className="text-xl font-semibold text-gray-900">Sales Deck</h1>
                <p className="text-sm text-gray-500 leading-tight">
                  {deckModeLabel(version.deckMode)} · Generated {formatDate(version.createdAt)}
                  {version.updatedAt !== version.createdAt && (
                    <><br />Edited {formatDate(version.updatedAt)}</>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isEditing ? (
                <>
                  <button
                    onClick={handleCancelEditing}
                    disabled={saving}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Save Changes
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <ChatAboutButton
                    title="Chat About Sales Deck"
                    getContext={() => currentContent}
                  />
                  <button
                    onClick={handleCopy}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
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
                        Copy
                      </>
                    )}
                  </button>
                  <ShareDocumentButton
                    documentType="salesDeck"
                    documentId={version.id}
                    title={`Sales Deck: ${version.orgPersona} — ${version.humanPersona}`}
                    content={currentContent}
                  />
                  <button
                    onClick={handleStartEditing}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </button>
                  <Link
                    href="/sales-deck/history"
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    History
                  </Link>
                  <button
                    onClick={handleClone}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Clone
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-4 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {deleting ? (
                      <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                  <NewButtonDropdown
                    onRegenerate={handleRegenerate}
                    onUploadPDF={handleImportPDF}
                    generating={generating}
                    importing={importing}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Persona badges */}
        {!isEditing && (
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="px-4 py-3 bg-purple-50 text-purple-800 text-sm rounded-xl border border-purple-100 flex-1">
                <span className="font-semibold text-purple-600">Org Persona:</span> {version.orgPersona}
              </div>
              <div className="px-4 py-3 bg-blue-50 text-blue-800 text-sm rounded-xl border border-blue-100 flex-1">
                <span className="font-semibold text-blue-600">Human Persona:</span> {version.humanPersona}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="px-3 py-2 bg-orange-50 text-orange-800 text-sm rounded-lg border border-orange-100">
                <span className="font-semibold text-orange-600">Mode:</span> {deckModeLabel(version.deckMode)}
              </div>
              {version.sourcePdfName && (
                <div className="px-3 py-2 bg-gray-50 text-gray-700 text-sm rounded-lg border border-gray-200">
                  <span className="font-semibold text-gray-500">Source:</span> {version.sourcePdfName}
                </div>
              )}
              {version.prospectUrl && (
                <div className="px-3 py-2 bg-indigo-50 text-indigo-800 text-sm rounded-lg border border-indigo-100">
                  <span className="font-semibold text-indigo-600">Website:</span> {version.prospectUrl}
                </div>
              )}
            </div>
            {/* Gamma action links */}
            {version.deckMode === "gamma" && (version.gammaUrl || version.gammaPdfUrl || version.gammaPptxUrl) && (
              <div className="flex items-center gap-3 flex-wrap">
                {version.gammaUrl && (
                  <a
                    href={version.gammaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all font-medium shadow-sm"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Open in Gamma
                  </a>
                )}
                {version.gammaPdfUrl && (
                  <a
                    href={version.gammaPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors font-medium"
                  >
                    <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download PDF
                  </a>
                )}
                {version.gammaPptxUrl && (
                  <a
                    href={version.gammaPptxUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors font-medium"
                  >
                    <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download PPTX
                  </a>
                )}
              </div>
            )}
            {/* Gamma failed banner with retry */}
            {version.deckMode === "gamma" && !version.gammaUrl && !version.gammaPdfUrl && !version.gammaPptxUrl && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-amber-900">Gamma presentation not generated</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        The deck outline was created, but the Gamma presentation couldn&apos;t be built. You can retry or use the outline below as-is.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleRetryGamma}
                    disabled={retryingGamma}
                    className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all font-medium shadow-sm disabled:opacity-50"
                  >
                    {retryingGamma ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Retry Gamma
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
            {version.specialNotes && (
              <div className="px-4 py-3 bg-gray-50 text-gray-700 text-sm rounded-xl border border-gray-200">
                <span className="font-semibold text-gray-500">Notes:</span> {version.specialNotes}
              </div>
            )}
          </div>
        )}

        {!isEditing && (
          <div className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Generated From
            </h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-800 font-medium">Sales Narrative</p>
                {version.salesNarrativeVersion && (
                  <p className="text-sm text-gray-500">
                    Created {formatDate(version.salesNarrativeVersion.createdAt)}
                  </p>
                )}
              </div>
              <Link
                href="/sales-narrative"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-600 hover:text-purple-700 text-sm font-medium"
              >
                View Narrative →
              </Link>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-6">
            {isEditing ? (
              <RichTextEditor
                value={editedContent}
                onChange={(val) => setEditedContent(val)}
                height={600}
              />
            ) : (
              <div className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900 prose-table:text-sm prose-th:bg-gray-100 prose-th:border prose-th:border-gray-300 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-gray-300 prose-td:px-3 prose-td:py-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentContent}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>

      </div>
      {ConfirmModalElement}
    </div>
  );
}
