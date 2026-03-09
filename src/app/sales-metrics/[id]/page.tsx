"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";

interface AnalysisResult {
  top3Strengths: Array<{ title: string; detail: string }>;
  top3Improvements: Array<{ title: string; detail: string }>;
  workOnNext: { title: string; detail: string; actionSteps: string[] };
  metricsTable: Record<string, { value: string; benchmark: string; rating: string }>;
  generalAnalysis: string;
  csvDeepDive?: {
    winRateBySource?: string;
    trends?: string;
    repPerformance?: string;
    pipelineHealth?: string;
    otherInsights?: string;
  };
}

interface AssessmentDetail {
  id: string;
  title: string | null;
  completedAt: string;
  conversationId: string | null;
  csvFileName: string | null;
  calculatedMetrics: AnalysisResult | null;
  analysisReport: string | null;
  categories: Array<{
    name: string;
    questions: Array<{
      questionId: string;
      globalOrder: number;
      question: string;
      answer: string;
      source: string;
    }>;
  }>;
}

export default function SalesMetricsDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "Sales Metrics Report - Mikey";
  }, []);

  useEffect(() => {
    async function loadAssessment() {
      try {
        const authRes = await fetch("/api/auth/me");
        const authData = await authRes.json();
        if (!authData.user) {
          router.push("/?error=not_logged_in");
          return;
        }

        const response = await fetch(`/api/sales-metrics/history?id=${id}`);
        if (!response.ok) {
          router.push("/sales-metrics/history");
          return;
        }

        const data = await response.json();
        setAssessment(data.assessment);

        if (data.assessment?.title) {
          document.title = `${data.assessment.title} - Mikey`;
        }
      } catch (error) {
        console.error("Error loading assessment:", error);
        router.push("/sales-metrics/history");
      } finally {
        setLoading(false);
      }
    }
    loadAssessment();
  }, [id, router]);

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Build a flat question list for metric table lookups
  const allQuestions = assessment?.categories?.flatMap((c) => c.questions) || [];

  // Parse the analysis from calculatedMetrics (which stores the metricsTable)
  // and analysisReport (which is markdown). We need to reconstruct the structured result.
  // The calculatedMetrics stores the full analysis result's metricsTable.
  // The analysisReport is the markdown. Let's parse what we can.
  const metrics = assessment?.calculatedMetrics;

  if (loading) {
    return (
      <>
        <SalesNavBar />
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600">Loading report...</p>
          </div>
        </div>
      </>
    );
  }

  if (!assessment) {
    return (
      <>
        <SalesNavBar />
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600 mb-4">Assessment not found.</p>
            <Link href="/sales-metrics/history" className="text-purple-600 hover:text-purple-700 font-medium">
              Back to History
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <SalesNavBar />
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="mb-6">
            <Link
              href="/sales-metrics/history"
              className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
            >
              &larr; Back to History
            </Link>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {assessment.title || "Sales Metrics Analysis"}
                </h1>
                <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                  <span>{new Date(assessment.completedAt).toLocaleDateString()}</span>
                  {assessment.csvFileName && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                      CSV: {assessment.csvFileName}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleShare}
                  className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  {copied ? "Copied!" : "Share"}
                </button>
                {assessment.conversationId && (
                  <Link
                    href={`/chat/${assessment.conversationId}`}
                    target="_blank"
                    className="px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition-colors font-medium"
                  >
                    Chat
                  </Link>
                )}
                <Link
                  href="/sales-metrics"
                  className="px-3 py-1.5 text-sm bg-purple-600 text-white hover:bg-purple-700 rounded-lg transition-colors font-medium"
                >
                  New Analysis
                </Link>
              </div>
            </div>
          </div>

          {/* Metrics Table */}
          {metrics && Object.keys(metrics).length > 0 && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {Object.entries(metrics)
                  .slice(0, 4)
                  .map(([key, metric]) => {
                    const q = allQuestions.find((q) => String(q.globalOrder) === key);
                    return (
                      <div key={key} className="bg-white rounded-xl border border-gray-200 p-4">
                        <p className="text-xs text-gray-500 mb-1 truncate">{q?.question?.replace(/\?$/, "") || `Metric ${key}`}</p>
                        <p className="text-xl font-bold text-gray-900">{metric.value || "N/A"}</p>
                        <p className="text-xs text-gray-400 mt-1">Benchmark: {metric.benchmark}</p>
                      </div>
                    );
                  })}
              </div>

              {/* Full Metrics Table */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
                <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">All Metrics</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-6 py-2 text-gray-600 font-medium">Metric</th>
                        <th className="text-left px-4 py-2 text-gray-600 font-medium">Your Value</th>
                        <th className="text-left px-4 py-2 text-gray-600 font-medium">Benchmark</th>
                        <th className="text-left px-4 py-2 text-gray-600 font-medium">Rating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {Object.entries(metrics).map(([key, metric]) => {
                        const q = allQuestions.find((q) => String(q.globalOrder) === key);
                        const ratingColors = {
                          good: "bg-green-100 text-green-700",
                          ok: "bg-yellow-100 text-yellow-700",
                          needs_work: "bg-red-100 text-red-700",
                        };
                        const ratingColor = ratingColors[metric.rating as keyof typeof ratingColors] || "bg-gray-100 text-gray-700";
                        return (
                          <tr key={key}>
                            <td className="px-6 py-3 text-gray-800">{q?.question || `Metric ${key}`}</td>
                            <td className="px-4 py-3 font-medium text-gray-900">{metric.value || "N/A"}</td>
                            <td className="px-4 py-3 text-gray-500">{metric.benchmark}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${ratingColor}`}>
                                {metric.rating === "needs_work" ? "Needs Work" : metric.rating === "good" ? "Good" : "OK"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Analysis Report (markdown) */}
          {assessment.analysisReport && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Analysis Report</h2>
              <div
                className="prose prose-sm max-w-none text-gray-700"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(assessment.analysisReport) }}
              />
            </div>
          )}

          {/* Your Answers */}
          {assessment.categories && assessment.categories.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
              <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Your Responses</h2>
              </div>
              <div className="divide-y divide-gray-100">
                {assessment.categories.map((cat) => (
                  <div key={cat.name}>
                    <div className="px-6 py-2 bg-gray-50/50">
                      <h3 className="text-sm font-medium text-gray-600">{cat.name}</h3>
                    </div>
                    {cat.questions.map((q) => (
                      <div key={q.questionId} className="px-6 py-3 flex items-start justify-between gap-4">
                        <p className="text-sm text-gray-700">{q.question}</p>
                        <div className="text-sm font-medium text-gray-900 text-right shrink-0">
                          {q.answer || <span className="text-gray-400">-</span>}
                          {q.source === "csv" && (
                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                              CSV
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom Actions */}
          <div className="flex items-center gap-4 pb-8">
            {assessment.conversationId && (
              <Link
                href={`/chat/${assessment.conversationId}`}
                target="_blank"
                className="px-6 py-2.5 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-700 transition-colors"
              >
                Chat About These Results
              </Link>
            )}
            <button
              onClick={handleShare}
              className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors"
            >
              {copied ? "Link Copied!" : "Share Report"}
            </button>
            <Link
              href="/sales-metrics"
              className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors"
            >
              Run New Analysis
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function markdownToHtml(md: string): string {
  return md
    .replace(/### (.*)/g, '<h3 class="text-base font-semibold text-gray-800 mt-4 mb-2">$1</h3>')
    .replace(/## (.*)/g, '<h2 class="text-lg font-semibold text-gray-800 mt-4 mb-2">$1</h2>')
    .replace(/# (.*)/g, '<h1 class="text-xl font-bold text-gray-900 mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^- (.*)/gm, '<li class="ml-4">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/g, '<ul class="list-disc pl-4 space-y-1 my-2">$&</ul>')
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split("|").filter((c) => c.trim());
      if (cells.every((c) => c.trim().match(/^-+$/))) return "";
      const tag = "td";
      const row = cells.map((c) => `<${tag} class="px-3 py-1 border border-gray-200">${c.trim()}</${tag}>`).join("");
      return `<tr>${row}</tr>`;
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, '<table class="w-full border-collapse border border-gray-200 my-2 text-sm">$&</table>')
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}
