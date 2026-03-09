"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import SalesNavBar from "@/components/SalesNavBar";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { ShareDocumentButton } from "@/components/ShareDocumentButton";

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

  // Build context for ChatAboutButton
  const getChatContext = () => {
    let context = "";
    if (assessment.analysisReport) {
      context += assessment.analysisReport + "\n\n";
    }
    if (assessment.categories?.length) {
      context += "## Your Responses\n\n";
      for (const cat of assessment.categories) {
        context += `### ${cat.name}\n`;
        for (const q of cat.questions) {
          context += `- ${q.question}: ${q.answer}${q.source === "csv" ? " (from CSV)" : ""}\n`;
        }
        context += "\n";
      }
    }
    return context;
  };

  // Build share content
  const buildShareContent = () => {
    let content = `# ${assessment.title || "Sales Metrics Analysis"}\n\n`;
    content += `Date: ${new Date(assessment.completedAt).toLocaleDateString()}\n`;
    if (assessment.csvFileName) {
      content += `CSV: ${assessment.csvFileName}\n`;
    }
    content += "\n";
    if (assessment.analysisReport) {
      content += assessment.analysisReport;
    }
    return content;
  };

  return (
    <>
      <SalesNavBar />
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/sales-metrics/history" className="text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-gray-900 truncate max-w-md">
                  {assessment.title || "Sales Metrics Analysis"}
                </h1>
                <p className="text-sm text-gray-500">
                  {(() => { const d = new Date(assessment.completedAt); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; })()}
                  {assessment.csvFileName && (
                    <> &middot; <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">{assessment.csvFileName}</span></>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ChatAboutButton
                title={`Chat About Sales Metrics: ${assessment.title || "Analysis"}`}
                getContext={getChatContext}
              />
              <Link
                href="/sales-metrics/history"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                History
              </Link>
              <ShareDocumentButton
                documentType="salesMetrics"
                documentId={assessment.id}
                title={assessment.title || "Sales Metrics Analysis"}
                content={buildShareContent()}
              />
              {assessment.conversationId && (
                <Link
                  href={`/chat/${assessment.conversationId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat
                </Link>
              )}
              <Link
                href="/sales-metrics"
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all flex items-center gap-2 font-medium shadow-md hover:shadow-lg text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Analysis
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 py-8">

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

          <div className="pb-8"></div>
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
