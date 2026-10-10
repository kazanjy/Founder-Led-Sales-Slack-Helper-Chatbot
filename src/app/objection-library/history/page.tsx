"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface BootstrapRun {
  id: string;
  orgPersona: string;
  humanPersona: string;
  entryCount: number;
  createdAt: string;
}

export default function ObjectionLibraryHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [bootstraps, setBootstraps] = useState<BootstrapRun[]>([]);

  useEffect(() => {
    document.title = "Objection Library History - Mikey";
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

        const res = await fetch("/api/objection-library/history");
        if (res.ok) {
          const data = await res.json();
          setBootstraps(data.bootstraps || []);
        }
      } catch (error) {
        console.error("Error loading history:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router]);

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
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
            <p className="text-gray-600 dark:text-gray-300">Loading history...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/objection-library"
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Bootstrap History</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {bootstraps.length} bootstrap run{bootstraps.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="max-w-3xl mx-auto px-6 py-6">
        {bootstraps.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No bootstrap runs yet.
          </div>
        ) : (
          <div className="space-y-3">
            {bootstraps.map((run) => (
              <div key={run.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-900 dark:text-gray-100 font-medium">
                      {run.entryCount} objection{run.entryCount !== 1 ? "s" : ""} generated
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      <span className="text-purple-600">{run.orgPersona}</span> · <span className="text-blue-600">{run.humanPersona}</span>
                    </p>
                  </div>
                  <span className="text-sm text-gray-400">{formatDate(run.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
