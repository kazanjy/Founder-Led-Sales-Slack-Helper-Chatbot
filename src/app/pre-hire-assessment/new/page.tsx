"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

export default function NewPreHireAssessment() {
  const router = useRouter();
  const [roleType, setRoleType] = useState<"ae" | "sdr">("ae");
  const [hasNarrative, setHasNarrative] = useState<boolean | null>(null);

  useEffect(() => {
    document.title = "New Pre-Hire Assessment - Mikey";
  }, []);

  // Check if sales narrative exists
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/sales-narrative/latest");
        if (res.ok) {
          const data = await res.json();
          setHasNarrative(data.hasNarrative);
        }
      } catch {
        setHasNarrative(false);
      }
    }
    check();
  }, []);

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

            {/* Sales Narrative info banner */}
            {hasNarrative === true && (
              <div className="mb-6 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">📖</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-amber-900">Your Sales Narrative and ICP will power this assessment</h3>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Mikey will use your product details, ICP, value prop, and hiring profile to generate a tailored candidate assessment.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {hasNarrative === false && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-sm text-red-800">
                  You need a <Link href="/sales-narrative/edit" className="underline font-medium">Sales Narrative</Link> before generating an assessment. The assessment is customized from your narrative and ICP.
                </p>
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
