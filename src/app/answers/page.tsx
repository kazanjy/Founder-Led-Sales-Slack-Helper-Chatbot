"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AnswerSummary {
  id: string;
  question: string;
  slug: string;
  preview: string;
  source: string;
  viewCount: number;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function AnswersIndexPage() {
  const [answers, setAnswers] = useState<AnswerSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  useEffect(() => {
    async function fetchAnswers() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: "20" });
        if (search) params.set("search", search);
        const res = await fetch(`/api/public/answers?${params}`);
        if (res.ok) {
          const data = await res.json();
          setAnswers(data.answers);
          setPagination(data.pagination);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    fetchAnswers();
  }, [page, search]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/answers" className="text-lg font-bold text-gray-900">
            Ask Mikey
          </Link>
          <Link
            href="/ask"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            Ask a Question
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Founder-Led Sales Q&A
        </h1>
        <p className="text-gray-600 mb-6">
          Browse answers to common founder-led sales questions, powered by Mikey.
        </p>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-8">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search questions..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Search
            </button>
          </div>
        </form>

        {/* Answers list */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : answers.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">
              {search ? "No answers match your search." : "No answers yet."}
            </p>
            <Link
              href="/ask"
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Be the first to ask Mikey a question!
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {answers.map((answer) => (
              <Link
                key={answer.id}
                href={`/answers/${answer.slug}`}
                className="block p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <h2 className="text-base font-semibold text-gray-900 mb-1">
                  {answer.question}
                </h2>
                <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                  {answer.preview}
                </p>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span
                    className={`px-1.5 py-0.5 rounded-full ${
                      answer.source === "twitter"
                        ? "bg-blue-50 text-blue-600"
                        : "bg-green-50 text-green-600"
                    }`}
                  >
                    {answer.source === "twitter" ? "Twitter" : "Ask Mikey"}
                  </span>
                  <span>
                    {new Date(answer.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span>{answer.viewCount} views</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              onClick={() =>
                setPage((p) => Math.min(pagination.totalPages, p + 1))
              }
              disabled={page >= pagination.totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
