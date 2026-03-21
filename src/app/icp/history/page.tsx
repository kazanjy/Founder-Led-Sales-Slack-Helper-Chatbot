"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface IcpHistoryVersion {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export default function IcpHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<IcpHistoryVersion[]>([]);

  useEffect(() => {
    document.title = "ICP History - Mikey";
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

        const response = await fetch("/api/icp/history");
        if (response.ok) {
          const data = await response.json();
          setVersions(data.versions || []);
        }
      } catch (error) {
        console.error("Error loading history:", error);
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, [router]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/icp" className="text-gray-500 hover:text-gray-700 flex items-center gap-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">ICP History</h1>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center py-12">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No ICP versions yet.</p>
            <Link href="/icp" className="text-purple-600 hover:text-purple-700 font-medium mt-2 inline-block">
              Create your first ICP →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {versions.map((v, index) => (
              <Link
                key={v.id}
                href={`/icp?version=${v.id}`}
                className="block bg-white rounded-xl border border-gray-200 hover:border-purple-300 hover:shadow-sm transition-all p-5"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900">{v.title || `Version ${versions.length - index}`}</h3>
                      {index === 0 && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">Latest</span>
                      )}
                      {v.updatedAt !== v.createdAt && (
                        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">Edited</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Created {formatDate(v.createdAt)}
                      {v.updatedAt !== v.createdAt && <> · Edited {formatDate(v.updatedAt)}</>}
                    </p>
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
