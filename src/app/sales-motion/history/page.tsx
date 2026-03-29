"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface CollectionSummary {
  id: string;
  title: string;
  status: string;
  dealCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function SalesMotionHistory() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);

  useEffect(() => {
    document.title = "Sales Motion History - Mikey";
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

        const response = await fetch("/api/sales-motion/history");
        if (response.ok) {
          const data = await response.json();
          setCollections(data.collections || []);
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
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      draft: "bg-gray-100 text-gray-600",
      processing: "bg-yellow-100 text-yellow-700",
      complete: "bg-green-100 text-green-700",
    };
    return colors[status] || colors.draft;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/sales-motion"
              className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Sales Motion History</h1>
              <p className="text-sm text-gray-500">{collections.length} analysis{collections.length !== 1 ? "es" : ""}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin h-8 w-8 text-purple-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : collections.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🔄</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Analyses Yet</h2>
            <p className="text-gray-600 mb-6">Analyze your first set of deals to see them here.</p>
            <Link
              href="/sales-motion/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-medium"
            >
              Analyze Sales Motion
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {collections.map((c, index) => (
              <Link
                key={c.id}
                href={`/sales-motion?collectionId=${c.id}`}
                className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-purple-300 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 truncate">{c.title}</h3>
                      {index === 0 && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                          Latest
                        </span>
                      )}
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusBadge(c.status)}`}>
                        {c.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {c.dealCount} deal{c.dealCount !== 1 ? "s" : ""} · Created {formatDate(c.createdAt)}
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
