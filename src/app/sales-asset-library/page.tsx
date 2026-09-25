"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import SalesNavBar from "@/components/SalesNavBar";
import ExportDocumentButton from "@/components/ExportDocumentButton";
import { buildAssetLibraryMarkdown } from "@/lib/playbook-export";
import { Linkify } from "@/components/Linkify";
import { useCmdEnterToSubmit } from "@/components/useCmdEnterToSubmit";
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

// Human-friendly name for an asset's current link. Prefers the
// version label (which is the filename for uploaded files), falls
// back to the URL's hostname for external links, and finally to a
// generic "Open" when neither is available. Keeps the raw signed
// storage URL out of the UI.
function assetLinkName(currentUrl: string, currentLabel: string | null): string {
  if (currentLabel && currentLabel.trim()) return currentLabel.trim();
  try {
    return new URL(currentUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Open";
  }
}

// True when the current link is an uploaded file (Supabase storage
// signed URL) rather than an external web link — used to pick the
// document vs. link icon.
function isUploadedFile(currentUrl: string): boolean {
  return /\/storage\/v1\/object\//.test(currentUrl);
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
  const router = useRouter();
  const [assets, setAssets] = useState<SalesAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAsset, setEditingAsset] = useState<SalesAsset | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editUploadFile, setEditUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [modalDragOver, setModalDragOver] = useState(false);
  const [dragOverAssetIdForFile, setDragOverAssetIdForFile] = useState<string | null>(null);
  // Per-card upload state so each card can show its own "Uploading…"
  // spinner without conflating with the page-wide `saving` used by
  // the modal save flow.
  const [uploadingAssetId, setUploadingAssetId] = useState<string | null>(null);
  const [uploadingAssetName, setUploadingAssetName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Tracks which asset's URL was just copied, for the transient
  // "Copied!" affordance on the Copy Link button.
  const [copiedUrlAssetId, setCopiedUrlAssetId] = useState<string | null>(null);
  const [historyAssetId, setHistoryAssetId] = useState<string | null>(null);
  const [historyVersions, setHistoryVersions] = useState<AssetVersion[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [addingInCategory, setAddingInCategory] = useState<string | null>(null);
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
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const [dragSectionKey, setDragSectionKey] = useState<string | null>(null);
  const [dragOverSectionKey, setDragOverSectionKey] = useState<string | null>(null);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const authRes = await fetch("/api/auth/me");
      const authData = await authRes.json();
      if (!authData.user) {
        router.push("/?error=not_logged_in");
        return;
      }
      const res = await fetch("/api/sales-asset-library");
      if (res.ok) {
        const data = await res.json();
        const loadedAssets: SalesAsset[] = data.assets || [];
        setAssets(loadedAssets);
        // Discover custom categories not in the default list
        const knownCats = new Set(CATEGORY_ORDER);
        const custom = [...new Set(loadedAssets.map((a) => a.category).filter((c) => !knownCats.has(c)))];
        setCustomCategories(custom);
        // Initialize section order from localStorage or defaults
        const allCats = [...CATEGORY_ORDER, ...custom];
        try {
          const saved = localStorage.getItem("assetLibrary:sectionOrder");
          if (saved) {
            const parsed = JSON.parse(saved) as string[];
            // Merge: saved order first, then any new categories appended
            const merged = [...parsed.filter((c: string) => allCats.includes(c)), ...allCats.filter((c) => !parsed.includes(c))];
            setSectionOrder(merged);
          } else {
            setSectionOrder(allCats);
          }
        } catch {
          setSectionOrder(allCats);
        }
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

  // Scroll to anchor after assets load
  useEffect(() => {
    if (!loading && assets.length > 0 && window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading, assets.length]);

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
      catAssets.forEach((a, i) => { a.order = i; });
      persistOrder(category, catAssets.map((a) => a.id));
      const otherAssets = prev.filter((a) => a.category !== category);
      return [...otherAssets, ...catAssets];
    });
  };

  const moveAssetDown = (assetId: string, category: string) => {
    setAssets((prev) => {
      const catAssets = prev.filter((a) => a.category === category);
      const idx = catAssets.findIndex((a) => a.id === assetId);
      if (idx === -1 || idx >= catAssets.length - 1) return prev;
      [catAssets[idx], catAssets[idx + 1]] = [catAssets[idx + 1], catAssets[idx]];
      catAssets.forEach((a, i) => { a.order = i; });
      persistOrder(category, catAssets.map((a) => a.id));
      const otherAssets = prev.filter((a) => a.category !== category);
      return [...otherAssets, ...catAssets];
    });
  };

  const handleAssetDrop = (targetId: string, targetCategory: string) => {
    if (!dragAssetId || dragAssetId === targetId) return;
    setAssets((prev) => {
      const draggedAsset = prev.find((a) => a.id === dragAssetId);
      if (!draggedAsset) return prev;

      const sourceCategory = draggedAsset.category;

      if (sourceCategory === targetCategory) {
        // Same category — reorder within
        const catAssets = prev.filter((a) => a.category === targetCategory);
        const fromIdx = catAssets.findIndex((a) => a.id === dragAssetId);
        const toIdx = catAssets.findIndex((a) => a.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return prev;
        const [moved] = catAssets.splice(fromIdx, 1);
        catAssets.splice(toIdx, 0, moved);
        catAssets.forEach((a, i) => { a.order = i; });
        persistOrder(targetCategory, catAssets.map((a) => a.id));
        const otherAssets = prev.filter((a) => a.category !== targetCategory);
        return [...otherAssets, ...catAssets];
      } else {
        // Cross-category — move asset to target category
        // Remove from source
        const sourceCatAssets = prev.filter((a) => a.category === sourceCategory && a.id !== dragAssetId);
        sourceCatAssets.forEach((a, i) => { a.order = i; });
        persistOrder(sourceCategory, sourceCatAssets.map((a) => a.id));

        // Insert into target at the drop position
        const targetCatAssets = prev.filter((a) => a.category === targetCategory);
        const toIdx = targetCatAssets.findIndex((a) => a.id === targetId);
        draggedAsset.category = targetCategory;
        targetCatAssets.splice(toIdx >= 0 ? toIdx : targetCatAssets.length, 0, draggedAsset);
        targetCatAssets.forEach((a, i) => { a.order = i; });
        persistOrder(targetCategory, targetCatAssets.map((a) => a.id));

        // Update category on the server
        fetch(`/api/sales-asset-library/${dragAssetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: targetCategory, order: toIdx >= 0 ? toIdx : targetCatAssets.length - 1 }),
        });

        const otherAssets = prev.filter((a) => a.category !== sourceCategory && a.category !== targetCategory);
        return [...otherAssets, ...sourceCatAssets, ...targetCatAssets];
      }
    });
    setDragAssetId(null);
    setDragOverAssetId(null);
  };

  const handleAssetDropOnSection = (targetCategory: string) => {
    if (!dragAssetId) return;
    setAssets((prev) => {
      const draggedAsset = prev.find((a) => a.id === dragAssetId);
      if (!draggedAsset || draggedAsset.category === targetCategory) {
        setDragAssetId(null);
        return prev;
      }
      const sourceCategory = draggedAsset.category;
      const sourceCatAssets = prev.filter((a) => a.category === sourceCategory && a.id !== dragAssetId);
      sourceCatAssets.forEach((a, i) => { a.order = i; });
      persistOrder(sourceCategory, sourceCatAssets.map((a) => a.id));

      const targetCatAssets = prev.filter((a) => a.category === targetCategory);
      draggedAsset.category = targetCategory;
      draggedAsset.order = targetCatAssets.length;
      targetCatAssets.push(draggedAsset);
      targetCatAssets.forEach((a, i) => { a.order = i; });
      persistOrder(targetCategory, targetCatAssets.map((a) => a.id));

      fetch(`/api/sales-asset-library/${dragAssetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: targetCategory, order: draggedAsset.order }),
      });

      const otherAssets = prev.filter((a) => a.category !== sourceCategory && a.category !== targetCategory);
      return [...otherAssets, ...sourceCatAssets, ...targetCatAssets];
    });
    setDragAssetId(null);
    setDragOverAssetId(null);
  };

  const saveSectionOrder = (order: string[]) => {
    setSectionOrder(order);
    localStorage.setItem("assetLibrary:sectionOrder", JSON.stringify(order));
  };

  const moveSectionUp = (category: string) => {
    const idx = sectionOrder.indexOf(category);
    if (idx <= 0) return;
    const next = [...sectionOrder];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    saveSectionOrder(next);
  };

  const moveSectionDown = (category: string) => {
    const idx = sectionOrder.indexOf(category);
    if (idx === -1 || idx >= sectionOrder.length - 1) return;
    const next = [...sectionOrder];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    saveSectionOrder(next);
  };

  // True when a DataTransfer carries a real filesystem drag — used to
  // route the existing card-reorder drag handlers OFF and the file-
  // upload path ON when the user drags a PDF/DOCX in from their OS.
  const isFileDrag = (dt: DataTransfer): boolean =>
    Array.from(dt.types || []).includes("Files");

  const DOCX_MIME_ANY = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const isUploadableFile = (f: File): boolean => {
    const lc = f.name.toLowerCase();
    return (
      f.type === "application/pdf" ||
      f.type === DOCX_MIME_ANY ||
      lc.endsWith(".pdf") ||
      lc.endsWith(".docx")
    );
  };

  // Direct-drop path for the library cards. Skips the modal — uploads
  // the file straight to the target asset via the multipart endpoint,
  // then reloads. Users who want to add a label / notes can still
  // click into the modal.
  const uploadFileToAsset = async (assetId: string, file: File) => {
    if (!isUploadableFile(file)) {
      setUploadError(`Unsupported file type. Only .pdf and .docx are accepted.`);
      return;
    }
    setUploadingAssetId(assetId);
    setUploadingAssetName(file.name);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/sales-asset-library/${assetId}/versions/upload`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || `Upload failed: ${res.status}`);
        return;
      }
      await loadAssets();
    } catch (error) {
      console.error("Direct-drop upload failed:", error);
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploadingAssetId(null);
      setUploadingAssetName(null);
    }
  };

  const handleSectionDrop = (targetKey: string) => {
    if (!dragSectionKey || dragSectionKey === targetKey) return;
    const fromIdx = sectionOrder.indexOf(dragSectionKey);
    const toIdx = sectionOrder.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...sectionOrder];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    saveSectionOrder(next);
    setDragSectionKey(null);
    setDragOverSectionKey(null);
  };

  const openEditModal = (asset: SalesAsset) => {
    setEditingAsset(asset);
    setEditName(asset.name);
    setEditDescription(asset.description || "");
    setEditUrl(asset.currentUrl || "");
    setEditLabel("");
    setEditNotes("");
    setEditUploadFile(null);
    setUploadError(null);
  };

  const saveVersion = async () => {
    if (!editingAsset) return;
    setSaving(true);
    setUploadError(null);
    try {
      // 1) Update name/description if changed
      const nameChanged = editName.trim() !== editingAsset.name;
      const descChanged = (editDescription.trim() || null) !== (editingAsset.description || null);
      if (nameChanged || descChanged) {
        await fetch(`/api/sales-asset-library/${editingAsset.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editName.trim(),
            description: editDescription.trim() || null,
          }),
        });
      }

      // 2a) If a file was picked, POST to the upload endpoint. This
      //     stores the blob in Supabase, extracts text (for the
      //     agent's searchCollateral / getFullAccountContext), and
      //     creates the version row with the signed URL as its
      //     `url` field.
      if (editUploadFile) {
        const fd = new FormData();
        fd.append("file", editUploadFile);
        if (editLabel.trim()) fd.append("label", editLabel.trim());
        if (editNotes.trim()) fd.append("notes", editNotes.trim());
        const res = await fetch(`/api/sales-asset-library/${editingAsset.id}/versions/upload`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setUploadError(data.error || `Upload failed: ${res.status}`);
          setSaving(false);
          return;
        }
      } else {
        // 2b) URL-only branch — legacy path. Only fires if no file
        //     was uploaded AND the URL actually changed.
        const urlChanged = editUrl.trim() !== (editingAsset.currentUrl || "");
        if (editUrl.trim() && urlChanged) {
          await fetch(`/api/sales-asset-library/${editingAsset.id}/versions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: editUrl.trim(),
              label: editLabel.trim() || undefined,
              notes: editNotes.trim() || undefined,
            }),
          });
        }
      }

      setEditingAsset(null);
      setEditUploadFile(null);
      await loadAssets();
    } catch (error) {
      console.error("Failed to save:", error);
      setUploadError(error instanceof Error ? error.message : "Save failed");
    }
    setSaving(false);
  };

  useCmdEnterToSubmit(saveVersion, !!editingAsset && !!editName.trim() && !saving);

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

  const [customUrl, setCustomUrl] = useState("");
  // File picked (or dropped) in the Add Custom Asset form — uploaded
  // onto the freshly-created asset when Add is clicked.
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [addDragOver, setAddDragOver] = useState(false);
  const addFileInputRef = useRef<HTMLInputElement | null>(null);

  // Drop a file straight onto "+ Add Custom Asset": creates the asset
  // (named from the file) and uploads in one motion.
  const createAssetFromFile = async (file: File, categoryOverride?: string) => {
    if (!isUploadableFile(file)) {
      setUploadError("Unsupported file type. Only .pdf and .docx are accepted.");
      return;
    }
    setAddingCustom(true);
    setUploadError(null);
    try {
      const res = await fetch("/api/sales-asset-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name.replace(/\.(pdf|docx)$/i, ""),
          category: categoryOverride || "custom",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || "Failed to create the asset");
        return;
      }
      const data = await res.json();
      if (data.asset?.id) {
        await uploadFileToAsset(data.asset.id, file);
      }
      setShowAddCustom(false);
      await loadAssets();
    } catch (error) {
      console.error("Create-from-file failed:", error);
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setAddingCustom(false);
    }
  };

  const addCustomAsset = async (categoryOverride?: string) => {
    if (!customName.trim()) return;
    const cat = categoryOverride || customCategory;
    setAddingCustom(true);
    try {
      const res = await fetch("/api/sales-asset-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customName.trim(),
          description: customDescription.trim() || undefined,
          category: cat,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // A picked/dropped file wins; otherwise a pasted URL becomes
        // the first version.
        if (customFile && data.asset?.id) {
          await uploadFileToAsset(data.asset.id, customFile);
        } else if (customUrl.trim() && data.asset?.id) {
          await fetch(`/api/sales-asset-library/${data.asset.id}/versions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: customUrl.trim() }),
          });
        }
        setShowAddCustom(false);
        setAddingInCategory(null);
        setCustomName("");
        setCustomDescription("");
        setCustomUrl("");
        setCustomFile(null);
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

  // Group assets by category, sorted by order within each
  const grouped: Record<string, SalesAsset[]> = {};
  for (const asset of assets) {
    if (!grouped[asset.category]) grouped[asset.category] = [];
    grouped[asset.category].push(asset);
  }
  for (const cat of Object.keys(grouped)) {
    grouped[cat].sort((a, b) => a.order - b.order);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">📚 Sales Asset Library</h1>
            {assets.length > 0 && (
              <ExportDocumentButton
                markdown={buildAssetLibraryMarkdown("Sales Asset Library", assets)}
                title="Sales Asset Library"
                filenameFallback="sales-asset-library"
                hint="Download the asset list as Markdown or PDF"
              />
            )}
          </div>
          <p className="text-gray-600 dark:text-gray-300">
            Your team&apos;s current production GTM assets. Update links here as assets evolve — all changes are tracked in version history.
          </p>
          {/* Agent-access callout — makes it explicit that the library
              isn't just storage; Mikey reads it in chat + Slack. */}
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-purple-100 dark:border-purple-900 bg-purple-50 dark:bg-purple-900/20 px-3 py-2 text-sm text-purple-800 dark:text-purple-200">
            <span className="text-base leading-none mt-0.5">🤖</span>
            <p>
              <span className="font-medium">Mikey can search and reference these assets in chat and Slack.</span>{" "}
              Uploaded files (PDF / .docx) are fully readable — their text is extracted so Mikey can quote and reason over the contents. Linked URLs are surfaced by name and description.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <div className="h-5 w-32 bg-gray-100 rounded animate-pulse mb-3" />
                <div className="h-16 bg-gray-50 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Add Custom Asset — moved to the top of the library so
                the primary "create new thing" affordance is visible
                without scrolling past every existing section. */}
            <div className="mb-6">
              {showAddCustom ? (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Add Custom Asset</h3>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Asset name (e.g., Security Questionnaire)"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                      autoFocus
                    />
                    <input
                      type="url"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      placeholder="URL (optional — paste link now or add later)"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                    />
                    <div
                      onClick={() => addFileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setAddDragOver(true); }}
                      onDragLeave={() => setAddDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setAddDragOver(false);
                        const f = e.dataTransfer.files?.[0];
                        if (!f) return;
                        if (!isUploadableFile(f)) {
                          setUploadError("Unsupported file type. Only .pdf and .docx are accepted.");
                          return;
                        }
                        setUploadError(null);
                        setCustomFile(f);
                        if (!customName.trim()) setCustomName(f.name.replace(/\.(pdf|docx)$/i, ""));
                      }}
                      className={`w-full px-3 py-2.5 border-2 border-dashed rounded-lg text-sm cursor-pointer transition-colors ${
                        addDragOver
                          ? "border-purple-400 bg-purple-50 text-purple-700"
                          : customFile
                          ? "border-green-300 bg-green-50/60 text-green-800"
                          : "border-gray-300 dark:border-gray-700 text-gray-400 hover:border-purple-300 hover:text-purple-600"
                      }`}
                    >
                      {customFile ? (
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate">📄 {customFile.name} — uploads when you add the asset</span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setCustomFile(null); }}
                            className="text-green-700 hover:text-red-600 flex-shrink-0"
                            title="Remove file"
                          >
                            ✕
                          </button>
                        </span>
                      ) : (
                        <>📎 Drop a .pdf / .docx here, or click to browse (optional)</>
                      )}
                    </div>
                    <input
                      ref={addFileInputRef}
                      type="file"
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          if (!isUploadableFile(f)) {
                            setUploadError("Unsupported file type. Only .pdf and .docx are accepted.");
                          } else {
                            setUploadError(null);
                            setCustomFile(f);
                            if (!customName.trim()) setCustomName(f.name.replace(/\.(pdf|docx)$/i, ""));
                          }
                        }
                        e.target.value = "";
                      }}
                    />
                    <input
                      type="text"
                      value={customDescription}
                      onChange={(e) => setCustomDescription(e.target.value)}
                      placeholder="Description (optional)"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                    />
                    <select
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                    >
                      {[...CATEGORY_ORDER, ...customCategories].map((cat) => (
                        <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                      ))}
                    </select>
                    {uploadError && (
                      <p className="text-xs text-red-600">{uploadError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => addCustomAsset()}
                        disabled={!customName.trim() || addingCustom}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                      >
                        {addingCustom ? "Adding..." : customFile ? "Add & Upload" : "Add Asset"}
                      </button>
                      <button
                        onClick={() => { setShowAddCustom(false); setCustomFile(null); setUploadError(null); }}
                        className="px-4 py-2 text-gray-600 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setShowAddCustom(true)}
                    onDragOver={(e) => { e.preventDefault(); setAddDragOver(true); }}
                    onDragLeave={() => setAddDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setAddDragOver(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) createAssetFromFile(f);
                    }}
                    disabled={addingCustom}
                    className={`w-full py-3 border-2 border-dashed rounded-xl text-sm transition-colors disabled:opacity-60 ${
                      addDragOver
                        ? "border-purple-500 bg-purple-50 text-purple-700 font-medium"
                        : "border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50/50"
                    }`}
                  >
                    {addingCustom
                      ? "Creating asset…"
                      : addDragOver
                      ? "📄 Drop to create an asset from this file"
                      : "+ Add Custom Asset — click, or drop a .pdf / .docx"}
                  </button>
                  {uploadError && !showAddCustom && (
                    <p className="mt-1.5 text-xs text-red-600">{uploadError}</p>
                  )}
                </>
              )}
            </div>

            {sectionOrder.filter((cat) => grouped[cat]?.length).map((category) => {
              const categoryLabel = CATEGORY_LABELS[category] || category;
              return (
              <div
                key={category}
                id={`section-${category}`}
                className={`mb-8 group/section scroll-mt-24 ${dragSectionKey === category ? "opacity-40" : ""} ${dragOverSectionKey === category ? "ring-2 ring-purple-300 rounded-xl" : ""}`}
                draggable
                onDragStart={(e) => { setDragSectionKey(category); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => { setDragSectionKey(null); setDragOverSectionKey(null); }}
                onDragOver={(e) => {
                  // File drags: preventDefault so the browser doesn't
                  // navigate to the dropped file when it lands on the
                  // section container instead of a specific card.
                  // Actual upload routing happens on the card
                  // handlers below.
                  if (isFileDrag(e.dataTransfer)) { e.preventDefault(); return; }
                  if (dragSectionKey && dragSectionKey !== category && !dragAssetId) { e.preventDefault(); setDragOverSectionKey(category); }
                  if (dragAssetId) { e.preventDefault(); }
                }}
                onDragLeave={() => setDragOverSectionKey(null)}
                onDrop={(e) => {
                  // If a file drop bubbles up here without being
                  // caught by a card, swallow it — better than
                  // letting the browser open the file directly.
                  if (isFileDrag(e.dataTransfer)) { e.preventDefault(); return; }
                  if (dragSectionKey) handleSectionDrop(category);
                  if (dragAssetId) handleAssetDropOnSection(category);
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 opacity-0 group-hover/section:opacity-100 transition-opacity">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                    </div>
                    <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {categoryLabel}
                    </h2>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover/section:opacity-100 transition-opacity">
                    <button onClick={() => moveSectionUp(category)} className="p-1 text-gray-400 hover:text-purple-600" title="Move section up">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                    </button>
                    <button onClick={() => moveSectionDown(category)} className="p-1 text-gray-400 hover:text-purple-600" title="Move section down">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    <button
                      onClick={() => archiveSection(category, categoryLabel)}
                      className="text-xs text-gray-400 hover:text-amber-600 px-2 py-0.5 rounded"
                      title="Archive section"
                    >
                      Archive
                    </button>
                    <button
                      onClick={() => deleteSection(category, categoryLabel)}
                      className="text-xs text-gray-400 hover:text-red-600 px-2 py-0.5 rounded"
                      title="Delete section"
                    >
                      Delete
                    </button>
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
                        onDragStart={(e) => { e.stopPropagation(); setDragAssetId(asset.id); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { setDragAssetId(null); setDragOverAssetId(null); }}
                        onDragOver={(e) => {
                          // Route between two drag modes:
                          //   1) File drag from OS → become an upload dropzone
                          //   2) Reorder drag from another card → existing behavior
                          if (isFileDrag(e.dataTransfer)) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = "copy";
                            setDragOverAssetIdForFile(asset.id);
                            return;
                          }
                          if (dragAssetId && dragAssetId !== asset.id) {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverAssetId(asset.id);
                          }
                        }}
                        onDragLeave={(e) => {
                          e.stopPropagation();
                          setDragOverAssetId(null);
                          setDragOverAssetIdForFile((cur) => (cur === asset.id ? null : cur));
                        }}
                        onDrop={(e) => {
                          e.stopPropagation();
                          if (isFileDrag(e.dataTransfer)) {
                            e.preventDefault();
                            setDragOverAssetIdForFile(null);
                            const file = e.dataTransfer.files?.[0];
                            if (file) void uploadFileToAsset(asset.id, file);
                            return;
                          }
                          handleAssetDrop(asset.id, category);
                        }}
                        id={`asset-${asset.slotKey || asset.id}`}
                        className={`relative bg-white dark:bg-gray-800 border rounded-xl p-4 hover:border-purple-300 hover:shadow-sm transition-all group scroll-mt-24 ${
                          dragAssetId === asset.id ? "opacity-40" : ""
                        } ${
                          uploadingAssetId === asset.id
                            ? "border-purple-500 border-2 shadow-md"
                            : dragOverAssetIdForFile === asset.id
                              ? "border-purple-500 border-dashed border-2 bg-purple-50 dark:bg-purple-900/20 shadow-md"
                              : dragOverAssetId === asset.id
                                ? "border-purple-400 shadow-md"
                                : "border-gray-200 dark:border-gray-700"
                        }`}
                      >
                        {/* Per-card uploading overlay — surfaces during
                            the direct-drop path (dragging a file onto
                            a card outside the modal). Skips render
                            when the card isn't the active upload
                            target. */}
                        {uploadingAssetId === asset.id && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/85 dark:bg-gray-800/85 backdrop-blur-sm">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-sm font-medium shadow-sm">
                              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                              </svg>
                              <span>
                                Uploading{uploadingAssetName ? ` ${uploadingAssetName}` : ""}…
                              </span>
                            </div>
                          </div>
                        )}
                        {editingMetaId === asset.id ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={metaName}
                              onChange={(e) => setMetaName(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                              placeholder="Asset name"
                            />
                            <input
                              type="text"
                              value={metaDescription}
                              onChange={(e) => setMetaDescription(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                              placeholder="Description (optional)"
                            />
                            <div className="flex gap-2">
                              <button onClick={saveMeta} className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">Save</button>
                              <button onClick={() => setEditingMetaId(null)} className="px-3 py-1.5 text-gray-600 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 mt-1 mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                              </div>
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base">{asset.name}</h3>
                                {asset.description && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5"><Linkify>{asset.description}</Linkify></p>
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
                                  onClick={() => {
                                    const anchor = `asset-${asset.slotKey || asset.id}`;
                                    const url = `${window.location.origin}/sales-asset-library#${anchor}`;
                                    navigator.clipboard.writeText(url);
                                    window.history.replaceState({}, "", `#${anchor}`);
                                  }}
                                  className="p-1 text-gray-400 hover:text-purple-600"
                                  title="Copy a link to this row in the library"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                </button>
                                <button
                                  onClick={() => openEditModal(asset)}
                                  className="p-1 text-gray-400 hover:text-gray-600"
                                  title="Edit"
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
                                <button
                                  onClick={() => asset.isDefault ? archiveAsset(asset) : deleteAsset(asset)}
                                  className="p-1 text-gray-400 hover:text-red-600"
                                  title={asset.isDefault ? "Remove (archive)" : "Delete permanently"}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              </div>
                            </div>

                            {hasUrl ? (
                              <>
                                <div className="flex items-center gap-2 flex-wrap mb-2">
                                  {/* Open button — labeled with the filename /
                                      hostname, not the raw signed URL. */}
                                  <a
                                    href={asset.currentUrl!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 max-w-full text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 dark:text-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 px-3 py-1.5 rounded-lg transition-colors min-w-0"
                                    title={asset.currentUrl!}
                                  >
                                    {isUploadedFile(asset.currentUrl!) ? (
                                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                                        <path d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2H6Z" fill="currentColor" opacity="0.25"/>
                                        <path d="M14 2V8H20L14 2Z" fill="currentColor" opacity="0.5"/>
                                      </svg>
                                    ) : (
                                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                    )}
                                    <span className="truncate">{assetLinkName(asset.currentUrl!, asset.currentLabel)}</span>
                                    <svg className="w-3.5 h-3.5 flex-shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                  </a>
                                  {/* Copy Link — copies the actual asset URL. */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(asset.currentUrl!);
                                      setCopiedUrlAssetId(asset.id);
                                      setTimeout(() => setCopiedUrlAssetId((cur) => (cur === asset.id ? null : cur)), 1500);
                                    }}
                                    className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-300 hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1.5 rounded-lg transition-colors flex-shrink-0"
                                    title="Copy link to clipboard"
                                  >
                                    {copiedUrlAssetId === asset.id ? (
                                      <>
                                        <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                        Copied
                                      </>
                                    ) : (
                                      <>
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                        Copy Link
                                      </>
                                    )}
                                  </button>
                                </div>
                                {latestVersion?.notes && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic whitespace-pre-wrap"><Linkify>{latestVersion.notes}</Linkify></p>
                                )}
                                <div className="flex items-center justify-between flex-wrap gap-2 mt-1">
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
                                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded"
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
                                + Add URL or Upload File
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                  {addingInCategory === category ? (
                    <div className="border border-purple-200 bg-purple-50/30 rounded-xl p-3 space-y-2">
                      <input
                        type="text"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="Asset name (e.g., Security Questionnaire)"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { setAddingInCategory(null); setCustomName(""); setCustomDescription(""); setCustomUrl(""); }
                        }}
                      />
                      <input
                        type="url"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        placeholder="URL (optional — paste link now or add later)"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                      />
                      <input
                        type="text"
                        value={customDescription}
                        onChange={(e) => setCustomDescription(e.target.value)}
                        placeholder="Description (optional)"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => addCustomAsset(category)}
                          disabled={!customName.trim() || addingCustom}
                          className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                        >
                          {addingCustom ? "Adding..." : "Add"}
                        </button>
                        <button
                          onClick={() => { setAddingInCategory(null); setCustomName(""); setCustomDescription(""); }}
                          className="px-3 py-1.5 text-gray-600 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingInCategory(category); setCustomName(""); setCustomDescription(""); }}
                      className="w-full py-2 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-400 hover:border-purple-300 hover:text-purple-500 transition-colors"
                    >
                      + Add Asset
                    </button>
                  )}
                </div>
              </div>
              );
            })}

            <div className="mt-8">
              {showAddSection ? (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="text"
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    placeholder="New section name..."
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
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
                  <button onClick={() => setShowAddSection(false)} className="px-3 py-2 text-gray-600 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddSection(true)}
                  className="mt-3 w-full py-2 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-400 hover:border-purple-300 hover:text-purple-500 transition-colors"
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
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Edit Asset</h3>
              <button onClick={() => setEditingAsset(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Asset name"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Description <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Short description of this asset"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-2">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider font-medium">
                  {editingAsset.currentUrl
                    ? "Update — link a URL or upload a file (creates a new version)"
                    : "Add — link a URL or upload a file"}
                </p>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">URL</label>
                <input
                  type="url"
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  autoFocus
                />
                {/* File upload alternative — PDF / DOCX. Accepts
                    either a click-to-pick file OR a drag-and-drop
                    from the OS. Drop-zone styling activates while a
                    file is being dragged over. On save, if a file
                    is set, the URL branch is skipped and the multipart
                    upload endpoint handles storage + text extraction. */}
                <div
                  className={`mt-3 rounded-lg border-2 border-dashed p-3 transition-colors ${
                    modalDragOver
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                      : "border-gray-300 dark:border-gray-700"
                  }`}
                  onDragOver={(e) => {
                    if (!isFileDrag(e.dataTransfer)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setModalDragOver(true);
                  }}
                  onDragLeave={() => setModalDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setModalDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    if (!isUploadableFile(file)) {
                      setUploadError("Unsupported file type. Only .pdf and .docx are accepted.");
                      return;
                    }
                    setEditUploadFile(file);
                    setUploadError(null);
                  }}
                >
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Or upload a file <span className="text-gray-400 font-normal">(drag & drop, or click — PDF / .docx, text is extracted so the agent can search it)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setEditUploadFile(file);
                        setUploadError(null);
                      }}
                      className="text-sm text-gray-700 dark:text-gray-200 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-purple-50 file:text-purple-700 file:text-xs file:font-medium hover:file:bg-purple-100"
                    />
                    {editUploadFile && (
                      <button
                        type="button"
                        onClick={() => setEditUploadFile(null)}
                        className="text-xs text-gray-500 hover:text-red-600"
                        title="Clear selection"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {editUploadFile && (
                    <p className="mt-1 text-xs text-purple-600 dark:text-purple-300">
                      Selected: {editUploadFile.name} ({Math.round(editUploadFile.size / 1024)}KB) — will replace URL on save.
                    </p>
                  )}
                  {modalDragOver && !editUploadFile && (
                    <p className="mt-1 text-xs text-purple-600 dark:text-purple-300">
                      Drop file to upload…
                    </p>
                  )}
                  {uploadError && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{uploadError}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Version Label <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="e.g., Q4 2026, Post-rebrand"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Version Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="What changed in this version?"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 resize-y"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setEditingAsset(null)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={saveVersion}
                disabled={!editName.trim() || saving}
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
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-3 flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Version History — {assets.find((a) => a.id === historyAssetId)?.name}
              </h3>
              <button onClick={() => setHistoryAssetId(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 pt-0">
              {loadingHistory ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Loading...</p>
              ) : historyVersions.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">No versions yet.</p>
              ) : (
                <div className="space-y-3">
                  {historyVersions.map((v, idx) => (
                    <div key={v.id} className={`border rounded-lg p-3 ${idx === 0 ? "border-purple-300 bg-purple-50/50" : "border-gray-200 dark:border-gray-700"}`}>
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
                              <span className="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 px-2 py-0.5 rounded-full">{v.label}</span>
                            )}
                          </div>
                          {v.notes && <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap"><Linkify>{v.notes}</Linkify></p>}
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
