"use client";

import { useState, useEffect, useCallback } from "react";
import SalesNavBar from "@/components/SalesNavBar";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/sales-asset-library/seed-data";

interface AssetUser {
  name: string | null;
  email: string | null;
  slackUserName: string | null;
}

interface AssetVersion {
  id: string;
  url: string;
  label: string | null;
  notes: string | null;
  createdAt: string;
  createdByUser: AssetUser | null;
}

interface SalesAsset {
  id: string;
  name: string;
  description: string | null;
  category: string;
  isDefault: boolean;
  slotKey: string | null;
  order: number;
  currentUrl: string | null;
  currentLabel: string | null;
  versions: AssetVersion[];
  _count: { versions: number };
}

function userDisplay(u: AssetUser | null): string {
  if (!u) return "Someone";
  return u.name || u.slackUserName || u.email?.split("@")[0] || "Someone";
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SalesAssetLibraryPage() {
  const [assets, setAssets] = useState<SalesAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAsset, setEditingAsset] = useState<SalesAsset | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyAssetId, setHistoryAssetId] = useState<string | null>(null);
  const [historyVersions, setHistoryVersions] = useState<AssetVersion[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customCategory, setCustomCategory] = useState("custom");
  const [addingCustom, setAddingCustom] = useState(false);
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null);
  const [metaName, setMetaName] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [dragAssetId, setDragAssetId] = useState<string | null>(null);
  const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sales-asset-library");
      if (res.ok) {
        const data = await res.json();
        const loadedAssets: SalesAsset[] = data.assets || [];
        setAssets(loadedAssets);
        // Discover custom categories not in the default list
        const knownCats = new Set(CATEGORY_ORDER);
        const custom = [...new Set(loadedAssets.map((a) => a.category).filter((c) => !knownCats.has(c)))];
        setCustomCategories(custom);
      }
    } catch (error) {
      console.error("Failed to load assets:", error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    document.title = "Sales Asset Library - Mikey";
    loadAssets();
  }, [loadAssets]);

  const persistOrder = (category: string, orderedIds: string[]) => {
    orderedIds.forEach((id, i) => {
      fetch(`/api/sales-asset-library/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: i }),
      });
    });
  };

  const moveAssetUp = (assetId: string, category: string) => {
    setAssets((prev) => {
      const catAssets = prev.filter((a) => a.category === category);
      const idx = catAssets.findIndex((a) => a.id === assetId);
      if (idx <= 0) return prev;
      [catAssets[idx - 1], catAssets[idx]] = [catAssets[idx], catAssets[idx - 1]];
      persistOrder(category, catAssets.map((a) => a.id));
      const otherAssets = prev.filter((a) => a.category !== category);
      return [...otherAssets, ...catAssets].sort((a, b) => {
        const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
        return catDiff !== 0 ? catDiff : a.order - b.order;
      });
    });
  };

  const moveAssetDown = (assetId: string, category: string) => {
    setAssets((prev) => {
      const catAssets = prev.filter((a) => a.category === category);
      const idx = catAssets.findIndex((a) => a.id === assetId);
      if (idx === -1 || idx >= catAssets.length - 1) return prev;
      [catAssets[idx], catAssets[idx + 1]] = [catAssets[idx + 1], catAssets[idx]];
      persistOrder(category, catAssets.map((a) => a.id));
      const otherAssets = prev.filter((a) => a.category !== category);
      return [...otherAssets, ...catAssets].sort((a, b) => {
        const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
        return catDiff !== 0 ? catDiff : a.order - b.order;
      });
    });
  };

  const handleAssetDrop = (targetId: string, category: string) => {
    if (!dragAssetId || dragAssetId === targetId) return;
    setAssets((prev) => {
      const catAssets = prev.filter((a) => a.category === category);
      const fromIdx = catAssets.findIndex((a) => a.id === dragAssetId);
      const toIdx = catAssets.findIndex((a) => a.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = catAssets.splice(fromIdx, 1);
      catAssets.splice(toIdx, 0, moved);
      persistOrder(category, catAssets.map((a) => a.id));
      const otherAssets = prev.filter((a) => a.category !== category);
      return [...otherAssets, ...catAssets].sort((a, b) => {
        const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
        return catDiff !== 0 ? catDiff : a.order - b.order;
      });
    });
    setDragAssetId(null);
    setDragOverAssetId(null);
  };

  const openEditModal = (asset: SalesAsset) => {
    setEditingAsset(asset);
    setEditUrl(asset.currentUrl || "");
    setEditLabel("");
    setEditNotes("");
  };

  const saveVersion = async () => {
    if (!editingAsset || !editUrl.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sales-asset-library/${editingAsset.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: editUrl.trim(),
          label: editLabel.trim() || undefined,
          notes: editNotes.trim() || undefined,
        }),
      });
      if (res.ok) {
        setEditingAsset(null);
        await loadAssets();
      }
    } catch (error) {
      console.error("Failed to save version:", error);
    }
    setSaving(false);
  };

  const openHistory = async (assetId: string) => {
    setHistoryAssetId(assetId);
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/sales-asset-library/${assetId}/versions`);
      if (res.ok) {
        const data = await res.json();
        setHistoryVersions(data.versions || []);
      }
    } catch (error) {
      console.error("Failed to load history:", error);
    }
    setLoadingHistory(false);
  };

  const restoreVersion = async (version: AssetVersion) => {
    if (!historyAssetId) return;
    await fetch(`/api/sales-asset-library/${historyAssetId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: version.url,
        label: version.label ? `Restored: ${version.label}` : "Restored version",
      }),
    });
    setHistoryAssetId(null);
    await loadAssets();
  };

  const addCustomAsset = async () => {
    if (!customName.trim()) return;
    setAddingCustom(true);
    try {
      const res = await fetch("/api/sales-asset-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customName.trim(),
          description: customDescription.trim() || undefined,
          category: customCategory,
        }),
      });
      if (res.ok) {
        setShowAddCustom(false);
        setCustomName("");
        setCustomDescription("");
        setCustomCategory("custom");
        await loadAssets();
      }
    } catch (error) {
      console.error("Failed to add custom asset:", error);
    }
    setAddingCustom(false);
  };

  const openMetaEdit = (asset: SalesAsset) => {
    setEditingMetaId(asset.id);
    setMetaName(asset.name);
    setMetaDescription(asset.description || "");
  };

  const saveMeta = async () => {
    if (!editingMetaId || !metaName.trim()) return;
    await fetch(`/api/sales-asset-library/${editingMetaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: metaName.trim(), description: metaDescription.trim() || null }),
    });
    setEditingMetaId(null);
    await loadAssets();
  };

  const deleteAsset = async (asset: SalesAsset) => {
    if (!confirm(`Permanently delete "${asset.name}"? Its version history will also be deleted. This cannot be undone.`)) return;
    await fetch(`/api/sales-asset-library/${asset.id}`, { method: "DELETE" });
    await loadAssets();
  };

  const archiveAsset = async (asset: SalesAsset) => {
    await fetch(`/api/sales-asset-library/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    await loadAssets();
  };

  const archiveSection = async (category: string, label: string) => {
    if (!confirm(`Archive the "${label}" section and all its assets? You can restore it later.`)) return;
    await fetch(`/api/sales-asset-library/sections/${encodeURIComponent(category)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    await loadAssets();
  };

  const deleteSection = async (category: string, label: string) => {
    if (!confirm(`Permanently delete the "${label}" section and all its custom assets? Default assets will remain. This cannot be undone.`)) return;
    await fetch(`/api/sales-asset-library/sections/${encodeURIComponent(category)}`, {
      method: "DELETE",
    });
    await loadAssets();
  };

  // Group assets by category
  const grouped: Record<string, SalesAsset[]> = {};
  for (const asset of assets) {
    if (!grouped[asset.category]) grouped[asset.category] = [];
    grouped[asset.category].push(asset);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">📚 Sales Asset Library</h1>
          <p className="text-gray-600">
            Your team&apos;s current production GTM assets. Update links here as assets evolve — all changes are tracked in version history.
          </p>
        </div>

        {loading ? (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="h-5 w-32 bg-gray-100 rounded animate-pulse mb-3" />
                <div className="h-16 bg-gray-50 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {[...CATEGORY_ORDER, ...customCategories].filter((cat) => grouped[cat]?.length).map((category) => {
              const categoryLabel = CATEGORY_LABELS[category] || category;
              const hasOnlyDefaults = grouped[category].every((a) => a.isDefault);
              return (
              <div key={category} className="mb-8 group/section">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {categoryLabel}
                  </h2>
                  <div className="flex items-center gap-1 opacity-0 group-hover/section:opacity-100 transition-opacity">
                    <button
                      onClick={() => archiveSection(category, categoryLabel)}
                      className="text-xs text-gray-400 hover:text-amber-600 px-2 py-0.5 rounded"
                      title="Archive section"
                    >
                      Archive
                    </button>
                    {!hasOnlyDefaults && (
                      <button
                        onClick={() => deleteSection(category, categoryLabel)}
                        className="text-xs text-gray-400 hover:text-red-600 px-2 py-0.5 rounded"
                        title="Delete custom assets in this section"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  {grouped[category].map((asset) => {
                    const latestVersion = asset.versions[0];
                    const hasUrl = !!asset.currentUrl;
                    return (
                      <div
                        key={asset.id}
                        draggable
                        onDragStart={(e) => { setDragAssetId(asset.id); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { setDragAssetId(null); setDragOverAssetId(null); }}
                        onDragOver={(e) => { if (dragAssetId && dragAssetId !== asset.id) { e.preventDefault(); setDragOverAssetId(asset.id); } }}
                        onDragLeave={() => setDragOverAssetId(null)}
                        onDrop={() => handleAssetDrop(asset.id, category)}
                        className={`bg-white border rounded-xl p-4 hover:border-purple-300 hover:shadow-sm transition-all group ${
                          dragAssetId === asset.id ? "opacity-40" : ""
                        } ${dragOverAssetId === asset.id ? "border-purple-400 shadow-md" : "border-gray-200"}`}
                      >
                        {editingMetaId === asset.id ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={metaName}
                              onChange={(e) => setMetaName(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                              placeholder="Asset name"
                            />
                            <input
                              type="text"
                              value={metaDescription}
                              onChange={(e) => setMetaDescription(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                              placeholder="Description (optional)"
                            />
                            <div className="flex gap-2">
                              <button onClick={saveMeta} className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">Save</button>
                              <button onClick={() => setEditingMetaId(null)} className="px-3 py-1.5 text-gray-600 text-sm hover:bg-gray-100 rounded-lg">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 mt-1 mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                              </div>
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-gray-900 text-sm sm:text-base">{asset.name}</h3>
                                {asset.description && (
                                  <p className="text-xs text-gray-500 mt-0.5">{asset.description}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                <button onClick={() => moveAssetUp(asset.id, category)} className="p-1 text-gray-400 hover:text-purple-600" title="Move up">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                                </button>
                                <button onClick={() => moveAssetDown(asset.id, category)} className="p-1 text-gray-400 hover:text-purple-600" title="Move down">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                </button>
                                <button
                                  onClick={() => openMetaEdit(asset)}
                                  className="p-1 text-gray-400 hover:text-gray-600"
                                  title="Rename"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                </button>
                                <button
                                  onClick={() => archiveAsset(asset)}
                                  className="p-1 text-gray-400 hover:text-amber-600"
                                  title="Archive"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                                </button>
                                {!asset.isDefault && (
                                  <button
                                    onClick={() => deleteAsset(asset)}
                                    className="p-1 text-gray-400 hover:text-red-600"
                                    title="Delete permanently"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                  </button>
                                )}
                              </div>
                            </div>

                            {hasUrl ? (
                              <>
                                <div className="flex items-center gap-2 flex-wrap mb-2">
                                  <span className="text-gray-400 text-sm flex-shrink-0">🔗</span>
                                  <a
                                    href={asset.currentUrl!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline truncate flex-1 min-w-0"
                                    title={asset.currentUrl!}
                                  >
                                    {asset.currentUrl!.replace(/^https?:\/\/(www\.)?/, "")}
                                  </a>
                                  {asset.currentLabel && (
                                    <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full flex-shrink-0">
                                      {asset.currentLabel}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                  <p className="text-xs text-gray-400">
                                    {latestVersion && (
                                      <>
                                        Updated {formatRelative(latestVersion.createdAt)} by {userDisplay(latestVersion.createdByUser)}
                                        {asset._count.versions > 1 && ` · ${asset._count.versions - 1} prior version${asset._count.versions > 2 ? "s" : ""}`}
                                      </>
                                    )}
                                  </p>
                                  <div className="flex items-center gap-1">
                                    {asset._count.versions > 1 && (
                                      <button
                                        onClick={() => openHistory(asset.id)}
                                        className="text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-2 py-1 rounded"
                                      >
                                        History
                                      </button>
                                    )}
                                    <button
                                      onClick={() => openEditModal(asset)}
                                      className="text-xs text-purple-600 hover:text-purple-800 hover:bg-purple-50 px-2 py-1 rounded font-medium"
                                    >
                                      Edit
                                    </button>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <button
                                onClick={() => openEditModal(asset)}
                                className="w-full mt-1 px-3 py-2 text-sm text-purple-600 border border-dashed border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-colors"
                              >
                                + Add URL
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                  <button
                    onClick={() => { setCustomCategory(category); setShowAddCustom(true); }}
                    className="w-full py-2 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:border-purple-300 hover:text-purple-500 transition-colors"
                  >
                    + Add Asset
                  </button>
                </div>
              </div>
              );
            })}

            <div className="mt-8">
              {showAddCustom ? (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">Add Custom Asset</h3>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Asset name (e.g., Security Questionnaire)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={customDescription}
                      onChange={(e) => setCustomDescription(e.target.value)}
                      placeholder="Description (optional)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                    />
                    <select
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                    >
                      {[...CATEGORY_ORDER, ...customCategories].map((cat) => (
                        <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={addCustomAsset}
                        disabled={!customName.trim() || addingCustom}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                      >
                        {addingCustom ? "Adding..." : "Add Asset"}
                      </button>
                      <button
                        onClick={() => setShowAddCustom(false)}
                        className="px-4 py-2 text-gray-600 text-sm hover:bg-gray-100 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddCustom(true)}
                  className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50/50 transition-colors"
                >
                  + Add Custom Asset
                </button>
              )}

              {showAddSection ? (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="text"
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    placeholder="New section name..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newSectionName.trim()) {
                        const key = newSectionName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
                        if (!customCategories.includes(key)) {
                          setCustomCategories((prev) => [...prev, key]);
                          CATEGORY_LABELS[key] = newSectionName.trim();
                        }
                        setShowAddSection(false);
                        setNewSectionName("");
                        setCustomCategory(key);
                        setShowAddCustom(true);
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const key = newSectionName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
                      if (!newSectionName.trim()) return;
                      if (!customCategories.includes(key)) {
                        setCustomCategories((prev) => [...prev, key]);
                        CATEGORY_LABELS[key] = newSectionName.trim();
                      }
                      setShowAddSection(false);
                      setNewSectionName("");
                      setCustomCategory(key);
                      setShowAddCustom(true);
                    }}
                    disabled={!newSectionName.trim()}
                    className="px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                  >
                    Create
                  </button>
                  <button onClick={() => setShowAddSection(false)} className="px-3 py-2 text-gray-600 text-sm hover:bg-gray-100 rounded-lg">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddSection(true)}
                  className="mt-3 w-full py-2 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:border-purple-300 hover:text-purple-500 transition-colors"
                >
                  + Add New Section
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Edit URL Modal */}
      {editingAsset && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditingAsset(null); }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingAsset.currentUrl ? "Update" : "Add"} {editingAsset.name}
              </h3>
              <button onClick={() => setEditingAsset(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
                <input
                  type="url"
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Label <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="e.g., Q4 2026, Post-rebrand"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="What changed in this version?"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 resize-y"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setEditingAsset(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={saveVersion}
                disabled={!editUrl.trim() || saving}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyAssetId && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setHistoryAssetId(null); }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-3 flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900">
                Version History — {assets.find((a) => a.id === historyAssetId)?.name}
              </h3>
              <button onClick={() => setHistoryAssetId(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 pt-0">
              {loadingHistory ? (
                <p className="text-sm text-gray-500 py-8 text-center">Loading...</p>
              ) : historyVersions.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">No versions yet.</p>
              ) : (
                <div className="space-y-3">
                  {historyVersions.map((v, idx) => (
                    <div key={v.id} className={`border rounded-lg p-3 ${idx === 0 ? "border-purple-300 bg-purple-50/50" : "border-gray-200"}`}>
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <a
                              href={v.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:text-blue-800 hover:underline break-all"
                            >
                              {v.url.replace(/^https?:\/\/(www\.)?/, "")}
                            </a>
                            {idx === 0 && (
                              <span className="text-xs text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">Current</span>
                            )}
                            {v.label && (
                              <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">{v.label}</span>
                            )}
                          </div>
                          {v.notes && <p className="text-xs text-gray-600 mt-1">{v.notes}</p>}
                          <p className="text-xs text-gray-400 mt-1">
                            {formatRelative(v.createdAt)} by {userDisplay(v.createdByUser)}
                          </p>
                        </div>
                        {idx !== 0 && (
                          <button
                            onClick={() => restoreVersion(v)}
                            className="text-xs text-purple-600 hover:text-purple-800 hover:bg-purple-50 px-2 py-1 rounded flex-shrink-0 font-medium"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
