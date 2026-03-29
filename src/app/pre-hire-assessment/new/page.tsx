"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

export default function NewPreHireAssessment() {
  const router = useRouter();
  const [roleType, setRoleType] = useState<"ae" | "sdr">("ae");
  const [narrativeDate, setNarrativeDate] = useState<string | null>(null);
  const [icpDate, setIcpDate] = useState<string | null>(null);
  const [aeProfileDate, setAeProfileDate] = useState<string | null>(null);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);

  useEffect(() => {
    document.title = "New Pre-Hire Assessment - Mikey";
  }, []);

  // Check all source assets
  useEffect(() => {
    async function checkSources() {
      try {
        const [narRes, icpRes, aeRes] = await Promise.all([
          fetch("/api/sales-narrative/latest"),
          fetch("/api/icp/latest"),
          fetch("/api/hiring-profile/latest"),
        ]);
        if (narRes.ok) {
          const d = await narRes.json();
          if (d.hasNarrative && d.version?.createdAt) setNarrativeDate(d.version.createdAt);
        }
        if (icpRes.ok) {
          const d = await icpRes.json();
          if (d.hasIcp && d.version?.createdAt) setIcpDate(d.version.createdAt);
        }
        if (aeRes.ok) {
          const d = await aeRes.json();
          if (d.hasProfile && d.version?.createdAt) setAeProfileDate(d.version.createdAt);
        }
      } catch { /* ignore */ }
      setSourcesLoaded(true);
    }
    checkSources();
  }, []);

  const hasNarrative = narrativeDate !== null;

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const handleGenerate = () => {
    router.push(`/pre-hire-assessment?generating=true&roleType=${roleType}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SalesNavBar />
      <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 45px)" }}>
        <div className="w-full max-w-lg px-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              Create Pre-Hire Assessment
            </h1>
            <p className="text-gray-500 mb-6">
              Generate a customized take-home assessment for sales candidates, tailored to your sales motion and ICP.
            </p>

            {/* Source assets panel */}
            {sourcesLoaded && (
              <div className="mb-6 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
                <h3 className="text-sm font-semibold text-amber-900 mb-3">These assets will power this assessment</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {narrativeDate ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                      <span className="text-sm text-gray-700">Sales Narrative</span>
                      {narrativeDate && <span className="text-xs text-gray-400">{formatDate(narrativeDate)}</span>}
                    </div>
                    <a href={narrativeDate ? "/sales-narrative" : "/sales-narrative/edit"} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
                      {narrativeDate ? "Update" : "Create"}
                    </a>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {icpDate ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                      <span className="text-sm text-gray-700">Ideal Customer Profile</span>
                      {icpDate && <span className="text-xs text-gray-400">{formatDate(icpDate)}</span>}
                    </div>
                    <a href="/icp" target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
                      {icpDate ? "Update" : "Create"}
                    </a>
                  </div>
                  {roleType === "ae" && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {aeProfileDate ? (
                          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        ) : (
                          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        )}
                        <span className="text-sm text-gray-700">AE Hiring Profile</span>
                        {aeProfileDate && <span className="text-xs text-gray-400">{formatDate(aeProfileDate)}</span>}
                      </div>
                      <a href="/hiring-profile" target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2">
                        {aeProfileDate ? "Update" : "Create"}
                      </a>
                    </div>
                  )}
                </div>
                {!narrativeDate && (
                  <p className="text-xs text-red-600 mt-3 font-medium">
                    A Sales Narrative is required before generating an assessment.
                  </p>
                )}
                {narrativeDate && (
                  <p className="text-xs text-gray-400 mt-3">
                    For a more tailored assessment, keep these assets up to date.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-5">
              {/* Role Type Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Role Type
                </label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setRoleType("ae")}
                    className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                      roleType === "ae"
                        ? "bg-purple-600 text-white"
                        : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Account Executive
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoleType("sdr")}
                    className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors border-l border-gray-300 ${
                      roleType === "sdr"
                        ? "bg-purple-600 text-white"
                        : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    SDR / BDR
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {roleType === "ae"
                    ? "Includes: Sales Motion Fit, Written Intake, Video Prompt, and Prospecting Exercise"
                    : "Includes: Written Intake, Video Prompt, and Prospecting Exercise"}
                </p>
              </div>

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={hasNarrative === false}
                className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all font-semibold text-lg shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Assessment
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
