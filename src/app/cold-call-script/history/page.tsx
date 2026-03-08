"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface VersionSummary {
  id: string;
  orgPersona: string;
  humanPersona: string;
  scriptType: string;
  createdAt: string;
  updatedAt: string;
}

export default function ColdCallScriptHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<VersionSummary[]>([]);

  useEffect(() => {
    document.title = "Cold Call Script History - Mikey";
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

        const response = await fetch("/api/cold-call-script/history");
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

  const scriptTypeLabel = (type: string) =>
    type === "inbound" ? "Inbound Lead Response" : "Outbound Cold Call";

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
              href="/cold-call-script"
              className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Cold Call Script History</h1>
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
            <div className="text-6xl mb-4">📞</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No History Yet</h2>
            <p className="text-gray-600 mb-6">
              Generate your first cold call script to see history here.
            </p>
            <Link
              href="/cold-call-script"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
            >
              Generate Cold Call Script
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {versions.map((version, index) => (
              <Link
                key={version.id}
                href={`/cold-call-script?version=${version.id}`}
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
                        version.scriptType === "inbound"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-orange-100 text-orange-700"
                      }`}>
                        {scriptTypeLabel(version.scriptType)}
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
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span>Created {formatDate(version.createdAt)}</span>
                      {version.updatedAt !== version.createdAt && (
                        <>
                          <span className="text-gray-300">•</span>
                          <span>Edited {formatDate(version.updatedAt)}</span>
                        </>
                      )}
                    </div>
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
