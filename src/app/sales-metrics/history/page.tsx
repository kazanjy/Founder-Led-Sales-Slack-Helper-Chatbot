"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface Assessment {
  id: string;
  title: string | null;
  completedAt: string;
  conversationId: string | null;
  csvFileName: string | null;
  answerCount: number;
}

export default function SalesMetricsHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<Assessment[]>([]);

  useEffect(() => {
    document.title = "Sales Metrics History - Mikey";
  }, []);

  useEffect(() => {
    async function loadHistory() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        const response = await fetch("/api/sales-metrics/history");
        if (response.ok) {
          const data = await response.json();
          setAssessments(data.assessments || []);
        }
      } catch (error) {
        console.error("Error loading history:", error);
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, [router]);

  return (
    <>
      <SalesNavBar />
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Sales Metrics History</h1>
            <Link
              href="/sales-metrics"
              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
            >
              New Analysis
            </Link>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-gray-500">Loading history...</p>
            </div>
          ) : assessments.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
              <div className="text-4xl mb-3">📊</div>
              <p className="text-gray-600 mb-4">No sales metrics analyses yet.</p>
              <Link
                href="/sales-metrics"
                className="text-purple-600 hover:text-purple-700 font-medium"
              >
                Run your first analysis
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {assessments.map((a) => (
                <div
                  key={a.id}
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:border-purple-300 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 truncate">
                        {a.title || "Sales Metrics Analysis"}
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        <span>{new Date(a.completedAt).toLocaleDateString()}</span>
                        {a.csvFileName && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                            CSV: {a.csvFileName}
                          </span>
                        )}
                        <span>{a.answerCount} metrics</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {a.conversationId && (
                        <Link
                          href={`/chat/${a.conversationId}`}
                          className="px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                        >
                          💬 Chat
                        </Link>
                      )}
                      <Link
                        href={`/sales-metrics/history?id=${a.id}`}
                        className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                      >
                        View
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
