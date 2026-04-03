"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface VersionSummary {
  id: string;
  callType: string;
  title: string;
  overallScore: number;
  maxScore: number;
  createdAt: string;
}

export default function CallReviewHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  useEffect(() => {
    document.title = "Call Review History - Mikey";
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

        const response = await fetch("/api/call-review/versions");
        if (!response.ok) throw new Error("Failed to load");

        const data = await response.json();
        setVersions(data.versions);
      } catch (error) {
        console.error("Error loading history:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router]);

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

  const getScoreColor = (score: number, max: number) => {
    const pct = max > 0 ? score / max : 0;
    if (pct >= 0.8) return "text-green-600";
    if (pct >= 0.6) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBg = (score: number, max: number) => {
    const pct = max > 0 ? score / max : 0;
    if (pct >= 0.8) return "bg-green-100 text-green-700";
    if (pct >= 0.6) return "bg-yellow-100 text-yellow-700";
    return "bg-red-100 text-red-700";
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
            <p className="text-gray-600">Loading history...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/call-review"
                className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Call Review History</h1>
                <p className="text-sm text-gray-500">
                  {versions.length} review{versions.length !== 1 ? "s" : ""} completed
                </p>
              </div>
            </div>
            <Link
              href="/call-review"
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center gap-2 font-medium shadow-md hover:shadow-lg text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Review
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {versions.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📞</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Reviews Yet</h2>
            <p className="text-gray-600 mb-6">
              Analyze your first call transcript to see history here.
            </p>
            <Link
              href="/call-review"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Analyze a Call
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {versions.map((version, index) => (
              <Link
                key={version.id}
                href={`/call-review?version=${version.id}`}
                className="group block bg-white rounded-xl border border-gray-200 p-5 hover:border-purple-300 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1.5">
                      {editingId === version.id ? (
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={async () => {
                            if (editingTitle.trim() && editingTitle !== version.title) {
                              await fetch(`/api/call-review/versions/${version.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ title: editingTitle.trim() }),
                              });
                              setVersions((prev) => prev.map((v) => v.id === version.id ? { ...v, title: editingTitle.trim() } : v));
                            }
                            setEditingId(null);
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingId(null); }}
                          onClick={(e) => e.preventDefault()}
                          autoFocus
                          className="text-base font-semibold text-gray-900 bg-white border border-purple-300 rounded px-2 py-0.5 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 w-full"
                        />
                      ) : (
                        <span className="text-base font-semibold text-gray-900 truncate">
                          {version.title || `Call Review ${versions.length - index}`}
                        </span>
                      )}
                      {editingId !== version.id && (
                        <button
                          onClick={(e) => { e.preventDefault(); setEditingId(version.id); setEditingTitle(version.title || ""); }}
                          className="flex-shrink-0 p-0.5 text-gray-400 hover:text-purple-600 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Edit name"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                      )}
                      {index === 0 && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full flex-shrink-0">
                          Latest
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span>{formatDate(version.createdAt)}</span>
                      <span className="text-gray-300">&middot;</span>
                      <span className="capitalize">{version.callType} call</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                    <div className="text-right">
                      <div className={`text-xl font-bold ${getScoreColor(version.overallScore, version.maxScore)}`}>
                        {version.overallScore}/{version.maxScore}
                      </div>
                      <div className={`text-xs font-medium px-2 py-0.5 rounded-full ${getScoreBg(version.overallScore, version.maxScore)}`}>
                        {Math.round((version.overallScore / version.maxScore) * 100)}%
                      </div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
