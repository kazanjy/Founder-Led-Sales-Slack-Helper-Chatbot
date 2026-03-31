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
import { SidebarAdCards } from "@/components/SidebarAdCards";

const RichTextEditor = dynamic(
  () => import("@/components/RichTextEditor"),
  { ssr: false }
);

interface SocialContentVersion {
  id: string;
  title?: string | null;
  content: string;
  platform: string;
  tone: string;
  postCount: number;
  topicSource: string;
  topicInput?: string | null;
  goldStandardExamples: string[];
  salesNarrativeVersionId: string;
  salesNarrativeVersion?: { id: string; createdAt: string };
  firstCallChecklistVersionId?: string | null;
  conversationId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SavedExample {
  id: string;
  platform: string;
  content: string;
  label: string | null;
  createdAt: string;
}

export default function SocialContentPage() {
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
      <SocialContentContent />
    </Suspense>
  );
}

function SocialContentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get("version");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [version, setVersion] = useState<SocialContentVersion | null>(null);
  const [hasSalesNarrative, setHasSalesNarrative] = useState(false);
  const [copied, setCopied] = useState(false);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [platform, setPlatform] = useState<"linkedin" | "twitter">("linkedin");
  const [tone, setTone] = useState("thought-leadership");
  const [customTone, setCustomTone] = useState("");
  const [postCount, setPostCount] = useState(5);
  const [topicSource, setTopicSource] = useState<"narrative" | "custom" | "content">("narrative");
  const [topicInput, setTopicInput] = useState("");
  const [goldExamples, setGoldExamples] = useState<string[]>([]);
  const [newExample, setNewExample] = useState("");
  const [includeChecklist, setIncludeChecklist] = useState(false);
  const [hasFirstCallChecklist, setHasFirstCallChecklist] = useState(false);

  // Saved examples
  const [savedExamples, setSavedExamples] = useState<SavedExample[]>([]);
  const [showSavedExamples, setShowSavedExamples] = useState(false);
  const [savingExample, setSavingExample] = useState(false);

  // Topic suggestions
  const [topicSuggestions, setTopicSuggestions] = useState<string[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editedContent, setEditedContent] = useState("");

  // Overflow menu
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    if (overflowOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [overflowOpen]);

  // More Like This overlay
  const [showMoreLikeThis, setShowMoreLikeThis] = useState(false);
  const [moreLikeThisCount, setMoreLikeThisCount] = useState(5);

  // Iterate overlay
  const [showIterate, setShowIterate] = useState(false);
  const [iteratePlatform, setIteratePlatform] = useState<"linkedin" | "twitter">("linkedin");
  const [iterateTone, setIterateTone] = useState("thought-leadership");
  const [iterateCustomTone, setIterateCustomTone] = useState("");
  const [iteratePostCount, setIteratePostCount] = useState(5);
  const [iterateTopicSource, setIterateTopicSource] = useState<"narrative" | "custom" | "content">("narrative");
  const [iterateTopicInput, setIterateTopicInput] = useState("");
  const [iterateIncludeChecklist, setIterateIncludeChecklist] = useState(false);

  const { alert: showAlert, confirm: showConfirm, ConfirmModalElement } = useConfirmModal();

  useEffect(() => {
    document.title = "Social Content - Mikey";
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

        fetch("/api/first-call-checklist/latest")
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.hasFirstCallChecklist) setHasFirstCallChecklist(true); })
          .catch(() => {});

        let url = "/api/social-content/latest";
        if (versionId) {
          url = `/api/social-content/versions/${versionId}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
          // API may fail if table doesn't exist yet — check for sales narrative directly
          const narrativeRes = await fetch("/api/sales-narrative/latest").then(r => r.ok ? r.json() : null).catch(() => null);
          setHasSalesNarrative(!!narrativeRes?.hasNarrative);
          return;
        }

        const data = await response.json();

        if (versionId) {
          setVersion(data.version);
          setEditedContent(data.version?.content || "");
          setHasSalesNarrative(true);
        } else {
          setHasSalesNarrative(data.hasSalesNarrative !== false);
          if (data.hasSocialContent) {
            setVersion(data.version);
            setEditedContent(data.version?.content || "");
            if (data.version?.id) {
              window.history.replaceState({}, "", `/social-content?version=${data.version.id}`);
            }
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

  // Load saved examples when platform changes
  useEffect(() => {
    if (!loading && hasSalesNarrative) {
      fetch(`/api/social-content/examples?platform=${platform}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.examples) setSavedExamples(data.examples); })
        .catch(() => {});
    }
  }, [platform, loading, hasSalesNarrative]);

  const handleGenerateTopics = async () => {
    setLoadingTopics(true);
    try {
      const res = await fetch("/api/social-content/topic-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      if (res.ok) {
        const data = await res.json();
        setTopicSuggestions(data.topics || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingTopics(false);
    }
  };

  const handleAddExample = () => {
    if (newExample.trim()) {
      setGoldExamples([...goldExamples, newExample.trim()]);
      setNewExample("");
    }
  };

  const handleSaveExample = async (content: string) => {
    setSavingExample(true);
    try {
      const res = await fetch("/api/social-content/examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, content }),
      });
      if (res.ok) {
        const data = await res.json();
        setSavedExamples([data.example, ...savedExamples]);
      }
    } catch {
      // silently fail
    } finally {
      setSavingExample(false);
    }
  };

  const handleDeleteSavedExample = async (id: string) => {
    const confirmed = await showConfirm({
      title: "Delete Saved Example",
      message: "Are you sure you want to delete this saved example? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/social-content/examples?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setSavedExamples(savedExamples.filter(e => e.id !== id));
      }
    } catch {
      // silently fail
    }
  };

  const handleLoadSavedExample = (content: string) => {
    if (!goldExamples.includes(content)) {
      setGoldExamples([...goldExamples, content]);
    }
    setShowSavedExamples(false);
  };

  const handleGenerate = async () => {
    const effectiveTone = tone === "other" ? customTone.trim() : tone;
    if (!effectiveTone) {
      await showAlert({ title: "Missing Tone", message: "Please specify a tone.", variant: "danger" });
      return;
    }
    if ((topicSource === "custom" || topicSource === "content") && !topicInput.trim()) {
      await showAlert({ title: "Missing Input", message: "Please provide a topic or content to repurpose.", variant: "danger" });
      return;
    }

    setGenerating(true);
    try {
      const response = await fetch("/api/social-content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          tone: effectiveTone,
          postCount,
          topicSource,
          topicInput: topicInput.trim() || undefined,
          goldStandardExamples: goldExamples.length > 0 ? goldExamples : undefined,
          includeFirstCallChecklist: includeChecklist,
        }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        await showAlert({ title: "Error", message: data.error || "Failed to generate", variant: "danger" });
        return;
      }

      // Stream the response — show content as it arrives
      setShowForm(false);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "token") {
                streamedContent += data.token;
                // Update a temporary version to show streaming content
                setVersion((prev) => prev ? { ...prev, content: streamedContent } : ({
                  id: "streaming",
                  title: "Generating...",
                  content: streamedContent,
                  platform,
                  tone: effectiveTone,
                  postCount,
                  topicSource,
                  goldStandardExamples: [],
                  salesNarrativeVersionId: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  userId: "",
                }));
                setEditedContent(streamedContent);
              } else if (currentEvent === "complete") {
                // Load the actual saved version
                const versionRes = await fetch(`/api/social-content/versions/${data.versionId}`);
                if (versionRes.ok) {
                  const vData = await versionRes.json();
                  setVersion(vData.version);
                  setEditedContent(vData.version?.content || "");
                }
                window.history.replaceState({}, "", `/social-content?version=${data.versionId}`);
              } else if (currentEvent === "error") {
                await showAlert({ title: "Error", message: data.message || "Generation failed", variant: "danger" });
              }
            } catch { /* ignore parse errors */ }
            currentEvent = "";
          }
        }
      }
    } catch (error) {
      console.error("Error generating:", error);
      await showAlert({ title: "Error", message: "Failed to generate social content. Please try again.", variant: "danger" });
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    if (version) {
      setPlatform(version.platform as "linkedin" | "twitter");
      if (["thought-leadership", "shitposting"].includes(version.tone)) {
        setTone(version.tone);
        setCustomTone("");
      } else {
        setTone("other");
        setCustomTone(version.tone);
      }
      setPostCount(version.postCount);
      setTopicSource(version.topicSource as "narrative" | "custom" | "content");
      setTopicInput(version.topicInput || "");
      setGoldExamples(version.goldStandardExamples || []);
      setIncludeChecklist(!!version.firstCallChecklistVersionId);
    }
    setShowForm(true);
  };

  // "More Like This" — generate more posts with the same config
  const handleMoreLikeThis = async () => {
    if (!version) return;
    setShowMoreLikeThis(false);
    setGenerating(true);
    try {
      const response = await fetch("/api/social-content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: version.platform,
          tone: version.tone,
          postCount: moreLikeThisCount,
          topicSource: version.topicSource,
          topicInput: version.topicInput || undefined,
          goldStandardExamples: version.goldStandardExamples?.length > 0 ? version.goldStandardExamples : undefined,
          includeFirstCallChecklist: !!version.firstCallChecklistVersionId,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to generate", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      router.push(`/social-content?version=${data.version.id}`);
    } catch {
      await showAlert({ title: "Error", message: "Failed to generate. Please try again.", variant: "danger" });
    } finally {
      setGenerating(false);
    }
  };

  // "Iterate" — open overlay with existing config for editing, then regenerate
  const handleOpenIterate = () => {
    if (!version) return;
    setIteratePlatform(version.platform as "linkedin" | "twitter");
    if (["thought-leadership", "shitposting"].includes(version.tone)) {
      setIterateTone(version.tone);
      setIterateCustomTone("");
    } else {
      setIterateTone("other");
      setIterateCustomTone(version.tone);
    }
    setIteratePostCount(version.postCount);
    setIterateTopicSource(version.topicSource as "narrative" | "custom" | "content");
    setIterateTopicInput(version.topicInput || "");
    setIterateIncludeChecklist(!!version.firstCallChecklistVersionId);
    setShowIterate(true);
  };

  const handleIterateGenerate = async () => {
    const effectiveTone = iterateTone === "other" ? iterateCustomTone.trim() : iterateTone;
    if (!effectiveTone) {
      await showAlert({ title: "Missing Tone", message: "Please specify a tone.", variant: "danger" });
      return;
    }
    if ((iterateTopicSource === "custom" || iterateTopicSource === "content") && !iterateTopicInput.trim()) {
      await showAlert({ title: "Missing Input", message: "Please provide a topic or content.", variant: "danger" });
      return;
    }
    setShowIterate(false);
    setGenerating(true);
    try {
      const response = await fetch("/api/social-content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: iteratePlatform,
          tone: effectiveTone,
          postCount: iteratePostCount,
          topicSource: iterateTopicSource,
          topicInput: iterateTopicInput.trim() || undefined,
          goldStandardExamples: version?.goldStandardExamples?.length ? version.goldStandardExamples : undefined,
          includeFirstCallChecklist: iterateIncludeChecklist,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        await showAlert({ title: "Error", message: data.error || "Failed to generate", variant: "danger" });
        return;
      }
      const data = await response.json();
      setVersion(data.version);
      setEditedContent(data.version?.content || "");
      router.push(`/social-content?version=${data.version.id}`);
    } catch {
      await showAlert({ title: "Error", message: "Failed to generate. Please try again.", variant: "danger" });
    } finally {
      setGenerating(false);
    }
  };

  // CSV Download — parse markdown posts into rows
  const handleCSVDownload = () => {
    if (!version) return;
    const content = version.content;
    // Split on "Post N" or "## Post N" headings
    const posts: string[] = [];
    const sections = content.split(/(?:^|\n)(?:#{1,3}\s*)?(?:\*\*)?Post\s+\d+(?:\*\*)?(?:\s*[-:]*)?\s*\n/i);
    for (const section of sections) {
      const trimmed = section.trim();
      if (trimmed) posts.push(trimmed);
    }
    if (posts.length === 0) {
      posts.push(content);
    }

    const platformLabel = version.platform === "linkedin" ? "LinkedIn" : "Twitter/X";
    const csvRows = [["Post #", "Platform", "Tone", "Content"]];
    posts.forEach((post, i) => {
      // Escape quotes for CSV
      const escaped = post.replace(/"/g, '""');
      csvRows.push([(i + 1).toString(), platformLabel, version.tone, escaped]);
    });

    const csvContent = csvRows.map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `social-posts-${platformLabel.toLowerCase()}-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    if (!version) return;
    const confirmed = await showConfirm({
      title: "Delete This Post?",
      message: "This will permanently delete this social content. This action cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/social-content/versions/${version.id}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleting(false);
        await showAlert({ title: "Error", message: "Failed to delete", variant: "danger" });
        return;
      }
      router.push("/social-content");
      router.refresh();
    } catch {
      setDeleting(false);
      await showAlert({ title: "Error", message: "Failed to delete", variant: "danger" });
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
      const response = await fetch(`/api/social-content/versions/${version.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent }),
      });
      if (!response.ok) throw new Error("Failed to save");
      const data = await response.json();
      setVersion({ ...version, content: data.version.content, updatedAt: data.version.updatedAt });
      setIsEditing(false);
    } catch (error) {
      console.error("Error saving:", error);
      await showAlert({ title: "Error", message: "Failed to save changes.", variant: "danger" });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
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
            <p className="text-gray-600">Loading social content...</p>
          </div>
        </div>
      </div>
    );
  }

  // No sales narrative gate
  if (!hasSalesNarrative && !version) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">📖</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Sales Narrative Required</h1>
            <p className="text-gray-600 mb-6">
              Social content is generated from your sales narrative. Create one first to get started.
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

  // Form view
  if (!version || showForm) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <GeneratingOverlay
          visible={generating}
          title="Generating Social Content"
          subtitle="Crafting engaging posts for your audience"
          emojis={["📱", "✍️", "🔥"]}
          messages={[
            "Analyzing your sales narrative",
            "Studying gold standard examples",
            "Brainstorming compelling hooks",
            "Writing posts in your voice",
            "Polishing for maximum engagement",
          ]}
        />
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
              {version ? "Regenerate" : "Generate"} Social Content
            </h1>
            <p className="text-gray-500 mb-6">Configure your social content generation.</p>

            {/* Sales Narrative Info Banner */}
            {hasSalesNarrative && (
              <div className="mb-6 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">📖</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-amber-900">Your Sales Narrative will power these posts</h3>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Mikey will use your completed Sales Narrative — including product details, positioning, competitive advantages, and customer stories — to generate tailored social content.
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

            <div className="space-y-6">
              {/* Platform */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setPlatform("linkedin")}
                    className={`flex-1 py-2.5 px-4 rounded-lg border-2 text-sm font-medium transition-colors ${
                      platform === "linkedin"
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    💼 LinkedIn
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlatform("twitter")}
                    className={`flex-1 py-2.5 px-4 rounded-lg border-2 text-sm font-medium transition-colors ${
                      platform === "twitter"
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    𝕏 Twitter/X
                  </button>
                </div>
              </div>

              {/* Tone */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tone</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: "thought-leadership", label: "🎓 Thought Leadership" },
                    { value: "shitposting", label: "🔥 Shitposting" },
                    { value: "other", label: "✏️ Other" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTone(opt.value)}
                      className={`py-2 px-4 rounded-lg border-2 text-sm font-medium transition-colors ${
                        tone === opt.value
                          ? "border-purple-600 bg-purple-50 text-purple-700"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {tone === "other" && (
                  <input
                    type="text"
                    value={customTone}
                    onChange={(e) => setCustomTone(e.target.value)}
                    placeholder="e.g. witty and sarcastic, inspirational, educational..."
                    className="mt-2 w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                )}
              </div>

              {/* Topic Source */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Topic Source</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:border-gray-300 transition-colors">
                    <input
                      type="radio"
                      name="topicSource"
                      value="narrative"
                      checked={topicSource === "narrative"}
                      onChange={() => setTopicSource("narrative")}
                      className="text-purple-600 focus:ring-purple-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900">Generate from Sales Narrative</span>
                      <p className="text-xs text-gray-500">AI picks topics from your narrative</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:border-gray-300 transition-colors">
                    <input
                      type="radio"
                      name="topicSource"
                      value="custom"
                      checked={topicSource === "custom"}
                      onChange={() => setTopicSource("custom")}
                      className="text-purple-600 focus:ring-purple-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900">Enter a Topic</span>
                      <p className="text-xs text-gray-500">Specify what you want to post about</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:border-gray-300 transition-colors">
                    <input
                      type="radio"
                      name="topicSource"
                      value="content"
                      checked={topicSource === "content"}
                      onChange={() => setTopicSource("content")}
                      className="text-purple-600 focus:ring-purple-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900">Repurpose Content</span>
                      <p className="text-xs text-gray-500">Paste content to turn into posts</p>
                    </div>
                  </label>
                </div>

                {topicSource === "narrative" && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={handleGenerateTopics}
                      disabled={loadingTopics}
                      className="px-4 py-2 bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      {loadingTopics ? (
                        <>
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Generating topic ideas...
                        </>
                      ) : (
                        <>💡 Generate Topic Ideas from Narrative</>
                      )}
                    </button>
                    {topicSuggestions.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {topicSuggestions.map((topic, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => { setTopicSource("custom"); setTopicInput(topic); }}
                            className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700 rounded-md transition-colors"
                          >
                            {topic}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {(topicSource === "custom" || topicSource === "content") && (
                  <textarea
                    value={topicInput}
                    onChange={(e) => setTopicInput(e.target.value)}
                    placeholder={topicSource === "custom" ? "e.g. Why most founders underinvest in outbound sales..." : "Paste an article, blog post, or any content to repurpose..."}
                    rows={4}
                    className="mt-3 w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                  />
                )}
              </div>

              {/* Post Count */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Number of Posts</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={15}
                    value={postCount}
                    onChange={(e) => setPostCount(parseInt(e.target.value))}
                    className="flex-1 accent-purple-600"
                  />
                  <span className="text-sm font-semibold text-gray-900 w-8 text-center">{postCount}</span>
                </div>
              </div>

              {/* Gold Standard Examples */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Gold Standard Examples <span className="text-gray-400">(optional)</span>
                  </label>
                  {savedExamples.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowSavedExamples(!showSavedExamples)}
                      className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                    >
                      {showSavedExamples ? "Hide saved" : `Load saved (${savedExamples.length})`}
                    </button>
                  )}
                </div>

                {showSavedExamples && savedExamples.length > 0 && (
                  <div className="mb-3 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                    {savedExamples.map((ex) => (
                      <div key={ex.id} className="px-3 py-2 flex items-start gap-2 hover:bg-gray-50">
                        <button
                          type="button"
                          onClick={() => handleLoadSavedExample(ex.content)}
                          className="flex-1 text-left text-sm text-gray-700 line-clamp-2"
                        >
                          {ex.label && <span className="font-medium">{ex.label}: </span>}
                          {ex.content.substring(0, 120)}...
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSavedExample(ex.id)}
                          className="text-gray-400 hover:text-red-500 p-1 flex-shrink-0"
                          title="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {goldExamples.map((ex, i) => (
                  <div key={i} className="mb-2 p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-700 relative group">
                    <div className="pr-16 whitespace-pre-wrap">{ex}</div>
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => handleSaveExample(ex)}
                        disabled={savingExample}
                        className="text-xs text-purple-600 hover:text-purple-700 px-2 py-1 bg-white rounded border border-gray-200"
                        title="Save for later"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setGoldExamples(goldExamples.filter((_, j) => j !== i))}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1 bg-white rounded border border-gray-200"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}

                <div className="flex gap-2">
                  <textarea
                    value={newExample}
                    onChange={(e) => setNewExample(e.target.value)}
                    placeholder="Paste an example post you love..."
                    rows={3}
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleAddExample}
                    disabled={!newExample.trim()}
                    className="self-end px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
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

              {/* Generate Button */}
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
                  disabled={generating}
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
                      Generate {postCount} Post{postCount > 1 ? "s" : ""}
                    </>
                  )}
                </button>
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
  const platformLabel = version.platform === "linkedin" ? "LinkedIn" : "Twitter/X";

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={generating}
        title="Generating Social Content"
        subtitle="Crafting engaging posts for your audience"
        emojis={["📱", "✍️", "🔥"]}
        messages={[
          "Analyzing your sales narrative",
          "Studying gold standard examples",
          "Brainstorming compelling hooks",
          "Writing posts in your voice",
          "Polishing for maximum engagement",
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
                <h1 className="text-xl font-semibold text-gray-900">{version.title || "Social Content"}</h1>
                <p className="text-sm text-gray-500 leading-tight">
                  Generated {formatDate(version.createdAt)}
                  {version.updatedAt !== version.createdAt && (
                    <><br />Edited {formatDate(version.updatedAt)}</>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isEditing ? (
                <>
                  <button onClick={handleCancelEditing} disabled={saving} className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-50">
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </>
              ) : (
                <>
                  <ChatAboutButton title="Chat About Social Content" getContext={() => currentContent} />
                  <button onClick={handleCopy} className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2">
                    {copied ? (
                      <><svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                    ) : (
                      <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                    )}
                  </button>
                  <button onClick={handleStartEditing} className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    Edit
                  </button>
                  <ShareDocumentButton
                    documentType="socialContent"
                    documentId={version.id}
                    title={`Social Content: ${platformLabel} ${version.tone}`}
                    content={currentContent}
                  />
                  <Link href="/social-content/history" className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    History
                  </Link>

                  {/* Overflow menu */}
                  <div className="relative" ref={overflowRef}>
                    <button
                      onClick={() => setOverflowOpen(!overflowOpen)}
                      className="px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                      title="More actions"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
                      </svg>
                    </button>
                    {overflowOpen && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[180px]">
                        <button onClick={() => { setOverflowOpen(false); setMoreLikeThisCount(5); setShowMoreLikeThis(true); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                          More Like This
                        </button>
                        <button onClick={() => { setOverflowOpen(false); handleOpenIterate(); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          Iterate
                        </button>
                        <button onClick={() => { setOverflowOpen(false); handleCSVDownload(); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          Download CSV
                        </button>
                        <div className="border-t border-gray-100 my-1"></div>
                        <button onClick={() => { setOverflowOpen(false); handleDelete(); }} disabled={deleting} className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 disabled:opacity-50">
                          {deleting ? (
                            <svg className="w-4 h-4 animate-spin text-red-400" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          )}
                          {deleting ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    )}
                  </div>

                  <NewButtonDropdown onRegenerate={handleRegenerate} onUploadPDF={() => {}} generating={generating} />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex gap-8">
      <div className="flex-1 min-w-0">
        {!isEditing && (
          <div className="flex flex-wrap gap-3 mb-6">
            <div className="px-4 py-2 bg-blue-50 text-blue-800 text-sm rounded-xl border border-blue-100">
              <span className="font-semibold text-blue-600">Platform:</span> {platformLabel}
            </div>
            <div className="px-4 py-2 bg-purple-50 text-purple-800 text-sm rounded-xl border border-purple-100">
              <span className="font-semibold text-purple-600">Tone:</span> {version.tone}
            </div>
            <div className="px-4 py-2 bg-gray-50 text-gray-700 text-sm rounded-xl border border-gray-200">
              <span className="font-semibold text-gray-500">Posts:</span> {version.postCount}
            </div>
            <div className="px-4 py-2 bg-gray-50 text-gray-700 text-sm rounded-xl border border-gray-200">
              <span className="font-semibold text-gray-500">Source:</span> {version.topicSource === "narrative" ? "Sales Narrative" : version.topicSource === "content" ? "Repurposed Content" : "Custom Topic"}
            </div>
            {version.topicInput && (
              <div className="px-4 py-2 bg-gray-50 text-gray-700 text-sm rounded-xl border border-gray-200">
                <span className="font-semibold text-gray-500">Topic:</span> {version.topicInput}
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-6">
            {isEditing ? (
              <RichTextEditor value={editedContent} onChange={(val) => setEditedContent(val)} height={600} />
            ) : (
              <div className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentContent}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>{/* end main content */}
      <div className="hidden lg:block w-64 flex-shrink-0">
        <div className="sticky top-8">
          <SidebarAdCards currentPage="socialContent" />
        </div>
      </div>
      </div>{/* end flex row */}
      </div>
      {/* More Like This Overlay */}
      {showMoreLikeThis && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowMoreLikeThis(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">More Like This</h3>
            <p className="text-sm text-gray-500 mb-6">Generate more posts using the same settings.</p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">How many posts?</label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={1}
                  max={15}
                  value={moreLikeThisCount}
                  onChange={e => setMoreLikeThisCount(Number(e.target.value))}
                  className="flex-1 accent-purple-600"
                />
                <span className="text-lg font-semibold text-purple-600 w-8 text-center">{moreLikeThisCount}</span>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowMoreLikeThis(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleMoreLikeThis} className="px-5 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium">Generate</button>
            </div>
          </div>
        </div>
      )}

      {/* Iterate Overlay */}
      {showIterate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowIterate(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Iterate on This Post</h3>
            <p className="text-sm text-gray-500 mb-6">Adjust settings and generate a new version.</p>

            {/* Platform */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
              <div className="flex gap-2">
                <button onClick={() => setIteratePlatform("linkedin")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${iteratePlatform === "linkedin" ? "bg-blue-100 text-blue-800 border border-blue-200" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>LinkedIn</button>
                <button onClick={() => setIteratePlatform("twitter")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${iteratePlatform === "twitter" ? "bg-blue-100 text-blue-800 border border-blue-200" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>Twitter/X</button>
              </div>
            </div>

            {/* Tone */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Tone</label>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setIterateTone("thought-leadership"); setIterateCustomTone(""); }} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${iterateTone === "thought-leadership" ? "bg-purple-100 text-purple-800 border border-purple-200" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>Thought Leadership</button>
                <button onClick={() => { setIterateTone("shitposting"); setIterateCustomTone(""); }} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${iterateTone === "shitposting" ? "bg-purple-100 text-purple-800 border border-purple-200" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>Shitposting</button>
                <button onClick={() => setIterateTone("other")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${iterateTone === "other" ? "bg-purple-100 text-purple-800 border border-purple-200" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>Other</button>
              </div>
              {iterateTone === "other" && (
                <input
                  type="text"
                  value={iterateCustomTone}
                  onChange={e => setIterateCustomTone(e.target.value)}
                  placeholder="e.g., witty, provocative, casual"
                  className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              )}
            </div>

            {/* Number of Posts */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Number of Posts</label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={1}
                  max={15}
                  value={iteratePostCount}
                  onChange={e => setIteratePostCount(Number(e.target.value))}
                  className="flex-1 accent-purple-600"
                />
                <span className="text-lg font-semibold text-purple-600 w-8 text-center">{iteratePostCount}</span>
              </div>
            </div>

            {/* Topic Source */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Topic Source</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={iterateTopicSource === "narrative"} onChange={() => setIterateTopicSource("narrative")} className="accent-purple-600" />
                  <span className="text-sm text-gray-700">From Sales Narrative</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={iterateTopicSource === "custom"} onChange={() => setIterateTopicSource("custom")} className="accent-purple-600" />
                  <span className="text-sm text-gray-700">Custom Topic</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={iterateTopicSource === "content"} onChange={() => setIterateTopicSource("content")} className="accent-purple-600" />
                  <span className="text-sm text-gray-700">Repurpose Content</span>
                </label>
              </div>
              {(iterateTopicSource === "custom" || iterateTopicSource === "content") && (
                <textarea
                  value={iterateTopicInput}
                  onChange={e => setIterateTopicInput(e.target.value)}
                  placeholder={iterateTopicSource === "custom" ? "Enter your topic..." : "Paste content to repurpose..."}
                  rows={3}
                  className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              )}
            </div>

            {/* Include First Call Checklist */}
            {hasFirstCallChecklist && (
              <div className="mb-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={iterateIncludeChecklist} onChange={e => setIterateIncludeChecklist(e.target.checked)} className="accent-purple-600 w-4 h-4" />
                  <span className="text-sm text-gray-700">Include First Call Checklist context</span>
                </label>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button onClick={() => setShowIterate(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleIterateGenerate} className="px-5 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium">Generate</button>
            </div>
          </div>
        </div>
      )}

      {ConfirmModalElement}
    </div>
  );
}
