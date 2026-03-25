"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface VersionSummary {
  id: string;
  orgPersona: string;
  humanPersona: string;
  specialNotes?: string | null;
  deckMode: string;
  sourcePdfName?: string | null;
  gammaUrl?: string | null;
  gammaPdfUrl?: string | null;
  gammaPptxUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function SalesDeckHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<VersionSummary[]>([]);

  useEffect(() => {
    document.title = "Sales Deck History - Mikey";
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

        const response = await fetch("/api/sales-deck/history");
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

  const deckModeLabel = (mode: string) =>
    mode === "existing" ? "Existing Deck Improvement" : "Fresh Deck";

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
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/sales-deck"
              className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Sales Deck History</h1>
              <p className="text-sm text-gray-500">
                {versions.length} version{versions.length !== 1 ? "s" : ""} generated
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {versions.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📊</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No History Yet</h2>
            <p className="text-gray-600 mb-6">
              Generate your first sales deck to see history here.
            </p>
            <Link
              href="/sales-deck"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              Generate Sales Deck
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {versions.map((version, index) => (
              <Link
                key={version.id}
                href={`/sales-deck?version=${version.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-6 hover:border-purple-300 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-lg font-semibold text-gray-900">
                        Version {versions.length - index}
                      </span>
                      {index === 0 && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                          Latest
                        </span>
                      )}
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        version.deckMode === "existing"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-orange-100 text-orange-700"
                      }`}>
                        {deckModeLabel(version.deckMode)}
                      </span>
                      {version.updatedAt !== version.createdAt && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                          Edited
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-purple-50 text-purple-600 text-xs font-medium rounded">
                        {version.orgPersona}
                      </span>
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs font-medium rounded">
                        {version.humanPersona}
                      </span>
                    </div>
                    {version.sourcePdfName && (
                      <p className="text-xs text-gray-500 mb-1 line-clamp-1">
                        <span className="font-medium text-gray-600">Source:</span> {version.sourcePdfName}
                      </p>
                    )}
                    {version.specialNotes && (
                      <p className="text-xs text-gray-500 mb-1 line-clamp-1">
                        <span className="font-medium text-gray-600">Notes:</span> {version.specialNotes}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span>Created {formatDate(version.createdAt)}</span>
                      {version.updatedAt !== version.createdAt && (
                        <>
                          <span className="text-gray-300">•</span>
                          <span>Edited {formatDate(version.updatedAt)}</span>
                        </>
                      )}
                    </div>
                    {(version.gammaUrl || version.gammaPdfUrl || version.gammaPptxUrl) && (
                      <div className="flex items-center gap-3 mt-2">
                        {version.gammaUrl && (
                          <a
                            href={version.gammaUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-medium rounded-md hover:bg-purple-100 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 text-xs font-medium rounded-md hover:bg-red-100 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            PDF
                          </a>
                        )}
                        {version.gammaPptxUrl && (
                          <a
                            href={version.gammaPptxUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-md hover:bg-blue-100 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            PPTX
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
