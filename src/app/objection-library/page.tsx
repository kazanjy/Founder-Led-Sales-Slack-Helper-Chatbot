"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";
import { useConfirmModal } from "@/components/useConfirmModal";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { OBJECTION_CATEGORIES, CATEGORY_KEYS, getCategoryInfo } from "@/lib/objection-library/categories";

interface ObjectionEntry {
  id: string;
  objection: string;
  category: string;
  orgPersona: string;
  humanPersona: string;
  handle: string;
  notes: string | null;
  source: string;
  sortOrder: number;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function ObjectionLibraryPage() {
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
      <ObjectionLibraryContent />
    </Suspense>
  );
}

function ObjectionLibraryContent() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [entries, setEntries] = useState<ObjectionEntry[]>([]);
  const [hasSalesNarrative, setHasSalesNarrative] = useState(false);
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Bootstrap form state
  const [showBootstrapForm, setShowBootstrapForm] = useState(false);
  const [orgPersona, setOrgPersona] = useState("");
  const [humanPersona, setHumanPersona] = useState("");
  const [prefilling, setPrefilling] = useState(false);

  // Add/Edit modal state
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ObjectionEntry | null>(null);
  const [entryForm, setEntryForm] = useState({
    objection: "",
    category: "PRODUCT",
    handle: "",
    orgPersona: "",
    humanPersona: "",
    notes: "",
  });
  const [savingEntry, setSavingEntry] = useState(false);

  // Iterate modal state
  const [showIterateModal, setShowIterateModal] = useState(false);
  const [iterateEntry, setIterateEntry] = useState<ObjectionEntry | null>(null);
  const [iterateFeedback, setIterateFeedback] = useState("");
  const [iterating, setIterating] = useState(false);

  const { confirm, alert: showAlert, ConfirmModalElement } = useConfirmModal();

  useEffect(() => {
    document.title = "Objection Library - Mikey";
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

        const summaryRes = await fetch("/api/objection-library/latest");
        const summaryData = await summaryRes.json();

        setHasSalesNarrative(summaryData.hasSalesNarrative !== false);

        if (summaryData.hasObjectionLibrary) {
          const entriesRes = await fetch("/api/objection-library/entries");
          const entriesData = await entriesRes.json();
          setEntries(entriesData.entries || []);
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router]);

  // Prefill personas from narrative
  const handlePrefill = async () => {
    setPrefilling(true);
    try {
      const res = await fetch("/api/cold-call-script/prefill-personas", { method: "POST" });
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

  // Auto-prefill when bootstrap form shows
  useEffect(() => {
    if (showBootstrapForm && !orgPersona && !humanPersona && !prefilling && hasSalesNarrative) {
      handlePrefill();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBootstrapForm]);

  const handleBootstrap = async () => {
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
      const response = await fetch("/api/objection-library/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgPersona: orgPersona.trim(),
          humanPersona: humanPersona.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        await showAlert({
          title: "Error",
          message: data.error || "Failed to generate objections",
          variant: "danger",
        });
        return;
      }

      const data = await response.json();
      setEntries((prev) => [...prev, ...data.entries]);
      setShowBootstrapForm(false);
    } catch (error) {
      console.error("Error bootstrapping:", error);
      await showAlert({
        title: "Error",
        message: "Failed to generate objections. Please try again.",
        variant: "danger",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleAddEntry = () => {
    setEditingEntry(null);
    setEntryForm({
      objection: "",
      category: "PRODUCT",
      handle: "",
      orgPersona: orgPersona || "",
      humanPersona: humanPersona || "",
      notes: "",
    });
    setShowEntryModal(true);
  };

  const handleEditEntry = (entry: ObjectionEntry) => {
    setEditingEntry(entry);
    setEntryForm({
      objection: entry.objection,
      category: entry.category,
      handle: entry.handle,
      orgPersona: entry.orgPersona,
      humanPersona: entry.humanPersona,
      notes: entry.notes || "",
    });
    setShowEntryModal(true);
  };

  const handleSaveEntry = async () => {
    if (!entryForm.objection.trim() || !entryForm.handle.trim() || !entryForm.orgPersona.trim() || !entryForm.humanPersona.trim()) {
      await showAlert({
        title: "Missing Fields",
        message: "Please fill in all required fields.",
        variant: "danger",
      });
      return;
    }

    setSavingEntry(true);
    try {
      if (editingEntry) {
        // Update existing
        const res = await fetch(`/api/objection-library/entries/${editingEntry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entryForm),
        });
        if (!res.ok) throw new Error("Failed to update");
        const data = await res.json();
        setEntries((prev) => prev.map((e) => (e.id === editingEntry.id ? data.entry : e)));
      } else {
        // Create new
        const res = await fetch("/api/objection-library/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entryForm),
        });
        if (!res.ok) throw new Error("Failed to create");
        const data = await res.json();
        setEntries((prev) => [...prev, data.entry]);
      }
      setShowEntryModal(false);
    } catch (error) {
      console.error("Error saving entry:", error);
      await showAlert({
        title: "Error",
        message: "Failed to save entry. Please try again.",
        variant: "danger",
      });
    } finally {
      setSavingEntry(false);
    }
  };

  const handleDeleteEntry = async (entry: ObjectionEntry) => {
    const confirmed = await confirm({
      title: "Delete Objection",
      message: `Are you sure you want to delete this objection handle?\n\n"${entry.objection.substring(0, 100)}..."`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      await fetch(`/api/objection-library/entries/${entry.id}`, { method: "DELETE" });
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (error) {
      console.error("Error deleting entry:", error);
    }
  };

  const handleOpenIterate = (entry: ObjectionEntry) => {
    setIterateEntry(entry);
    setIterateFeedback("");
    setShowIterateModal(true);
  };

  const handleIterate = async () => {
    if (!iterateEntry || !iterateFeedback.trim()) return;

    setIterating(true);
    try {
      const res = await fetch("/api/objection-library/iterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: iterateEntry.id,
          feedback: iterateFeedback.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to iterate");
      const data = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === iterateEntry.id ? data.entry : e)));
      setShowIterateModal(false);
    } catch (error) {
      console.error("Error iterating:", error);
      await showAlert({
        title: "Error",
        message: "Failed to improve handle. Please try again.",
        variant: "danger",
      });
    } finally {
      setIterating(false);
    }
  };

  // Filter entries
  const filteredEntries = entries.filter((e) => {
    if (activeCategory !== "ALL" && e.category !== activeCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        e.objection.toLowerCase().includes(q) ||
        e.handle.toLowerCase().includes(q) ||
        (e.notes && e.notes.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Category counts
  const categoryCounts: Record<string, number> = { ALL: entries.length };
  for (const entry of entries) {
    categoryCounts[entry.category] = (categoryCounts[entry.category] || 0) + 1;
  }

  // Get unique personas
  const personaCombos = Array.from(
    new Set(entries.map((e) => `${e.orgPersona} | ${e.humanPersona}`))
  );

  const sourceLabels: Record<string, string> = {
    bootstrap: "Bootstrap",
    manual: "Manual",
    "call-review": "Call Review",
    chat: "Chat",
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
            <p className="text-gray-600">Loading objection library...</p>
          </div>
        </div>
      </div>
    );
  }

  // No sales narrative gate
  if (!hasSalesNarrative && entries.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-4">📖</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Sales Narrative Required</h1>
            <p className="text-gray-600 mb-6">
              The objection library is generated from your sales narrative. Create a sales narrative first to get started.
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

  // Empty state — no entries yet
  if (entries.length === 0 && !showBootstrapForm) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="text-center max-w-lg px-6">
            <div className="text-6xl mb-4">🛡️</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Objection Library</h1>
            <p className="text-gray-600 mb-2">
              Build a library of objection handles organized by category and persona. Know exactly how to respond when prospects push back.
            </p>
            <p className="text-gray-500 text-sm mb-6">
              Bootstrap will generate 8-10 product-specific objection handles from your sales narrative.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setShowBootstrapForm(true)}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Bootstrap Your Library
              </button>
              <button
                onClick={handleAddEntry}
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Add Manually
              </button>
            </div>
          </div>
        </div>
        {showEntryModal && renderEntryModal()}
        {ConfirmModalElement}
      </div>
    );
  }

  // Bootstrap form
  if (showBootstrapForm) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SalesNavBar />
        <GeneratingOverlay
          visible={generating}
          title="Bootstrapping Objection Library"
          subtitle="Generating product-specific objection handles from your narrative"
          emojis={["🛡️", "💬", "🎯"]}
          messages={[
            "Analyzing your sales narrative",
            "Identifying common objections",
            "Crafting tactical responses",
            "Organizing by category",
            "Tailoring to your persona",
          ]}
        />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
          <div className="w-full max-w-lg px-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
              <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
                🛡️ Bootstrap Objection Library
              </h1>
              <p className="text-gray-500 mb-6">Generate 8-10 objection handles tailored to your target persona.</p>

              <div className="space-y-4">
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
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-50 resize-none"
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
                  <textarea
                    value={humanPersona}
                    onChange={(e) => setHumanPersona(e.target.value)}
                    placeholder={prefilling ? "AI is thinking..." : "e.g. VP of Sales"}
                    disabled={prefilling}
                    rows={3}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-50 resize-none"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  {entries.length > 0 && (
                    <button
                      onClick={() => setShowBootstrapForm(false)}
                      className="px-4 py-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleBootstrap}
                    disabled={generating || prefilling}
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
                        Generate Objections
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

  // Library view with entries
  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <GeneratingOverlay
        visible={generating}
        title="Bootstrapping More Objections"
        subtitle="Adding more product-specific objection handles"
        emojis={["🛡️", "💬", "🎯"]}
        messages={[
          "Analyzing your sales narrative",
          "Identifying additional objections",
          "Crafting tactical responses",
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
                <h1 className="text-xl font-semibold text-gray-900">Objection Library</h1>
                <p className="text-sm text-gray-500">
                  {entries.length} objection{entries.length !== 1 ? "s" : ""} across {Object.keys(categoryCounts).length - 1} categories
                  {personaCombos.length > 0 && ` · ${personaCombos.length} persona${personaCombos.length !== 1 ? "s" : ""}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleAddEntry}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Objection
              </button>
              <Link
                href="/objection-library/history"
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                History
              </Link>
              <button
                onClick={() => setShowBootstrapForm(true)}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Re-Bootstrap
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Category filter tabs + search */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1 overflow-x-auto -mb-px py-1">
              <button
                onClick={() => setActiveCategory("ALL")}
                className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeCategory === "ALL"
                    ? "border-purple-600 text-purple-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                All ({categoryCounts.ALL || 0})
              </button>
              {CATEGORY_KEYS.map((key) => {
                const info = OBJECTION_CATEGORIES[key];
                const count = categoryCounts[key] || 0;
                if (count === 0) return null;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveCategory(key)}
                    className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                      activeCategory === key
                        ? "border-purple-600 text-purple-600"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {info.label.split(" ")[0]} ({count})
                  </button>
                );
              })}
            </div>

            <div className="flex-shrink-0 pb-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search objections..."
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 w-48"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Entry cards */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {filteredEntries.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {searchQuery ? "No matching objections found." : "No objections in this category."}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredEntries.map((entry) => {
              const catInfo = getCategoryInfo(entry.category);
              return (
                <div key={entry.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Category badge + source + persona */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${catInfo.color} ${catInfo.textColor} ${catInfo.borderColor} border`}>
                          {catInfo.label}
                        </span>
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          {sourceLabels[entry.source] || entry.source}
                        </span>
                        <span className="text-xs text-gray-400">
                          {entry.orgPersona} · {entry.humanPersona}
                        </span>
                      </div>

                      {/* Objection text */}
                      <p className="text-gray-900 font-semibold mb-2 text-[15px]">
                        &ldquo;{entry.objection}&rdquo;
                      </p>

                      {/* Handle */}
                      <div className="text-gray-700 text-sm whitespace-pre-wrap">
                        {entry.handle}
                      </div>

                      {/* Notes */}
                      {entry.notes && (
                        <div className="mt-2 text-xs text-gray-500 italic">
                          Notes: {entry.notes}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleEditEntry(entry)}
                        className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleOpenIterate(entry)}
                        className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                        title="Improve with AI"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteEntry(entry)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Entry Add/Edit Modal */}
      {showEntryModal && renderEntryModal()}

      {/* Iterate Modal */}
      {showIterateModal && iterateEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !iterating && setShowIterateModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Improve This Handle</h2>

            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500 mb-1">Objection:</p>
              <p className="text-sm font-medium text-gray-800">&ldquo;{iterateEntry.objection}&rdquo;</p>
              <p className="text-sm text-gray-500 mt-2 mb-1">Current handle:</p>
              <p className="text-sm text-gray-700">{iterateEntry.handle}</p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                What would you like to improve?
              </label>
              <textarea
                value={iterateFeedback}
                onChange={(e) => setIterateFeedback(e.target.value)}
                placeholder="e.g. Make it more empathetic, add a specific case study reference, make it shorter..."
                rows={3}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowIterateModal(false)}
                disabled={iterating}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleIterate}
                disabled={iterating || !iterateFeedback.trim()}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {iterating ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Improving...
                  </>
                ) : (
                  "Improve Handle"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {ConfirmModalElement}
    </div>
  );

  function renderEntryModal() {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !savingEntry && setShowEntryModal(false)}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            {editingEntry ? "Edit Objection" : "Add Objection"}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Objection *</label>
              <textarea
                value={entryForm.objection}
                onChange={(e) => setEntryForm({ ...entryForm, objection: e.target.value })}
                placeholder="What the prospect actually says..."
                rows={2}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
              <select
                value={entryForm.category}
                onChange={(e) => setEntryForm({ ...entryForm, category: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                {CATEGORY_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {OBJECTION_CATEGORIES[key].label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Handle (Response) *</label>
              <textarea
                value={entryForm.handle}
                onChange={(e) => setEntryForm({ ...entryForm, handle: e.target.value })}
                placeholder="How to respond to this objection..."
                rows={4}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Org Persona *</label>
                <input
                  type="text"
                  value={entryForm.orgPersona}
                  onChange={(e) => setEntryForm({ ...entryForm, orgPersona: e.target.value })}
                  placeholder="e.g. Series B SaaS"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Human Persona *</label>
                <input
                  type="text"
                  value={entryForm.humanPersona}
                  onChange={(e) => setEntryForm({ ...entryForm, humanPersona: e.target.value })}
                  placeholder="e.g. VP of Sales"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={entryForm.notes}
                onChange={(e) => setEntryForm({ ...entryForm, notes: e.target.value })}
                placeholder="Any additional context..."
                rows={2}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowEntryModal(false)}
                disabled={savingEntry}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEntry}
                disabled={savingEntry}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {savingEntry ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </>
                ) : (
                  editingEntry ? "Save Changes" : "Add Entry"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
