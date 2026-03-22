"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Stats {
  total: number;
  published: number;
  hidden: number;
  draft: number;
  twitterCount: number;
  askMikeyCount: number;
  totalViews: number;
  avgViews: number;
  last7Days: number;
  last30Days: number;
}

interface AnswerRow {
  id: string;
  question: string;
  slug: string;
  preview: string;
  source: string;
  status: string;
  viewCount: number;
  twitterHandle: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function AdminPublicMikeyPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [tab, setTab] = useState<"all" | "moderation">("all");

  const fetchAnswers = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "20", sort });
    if (tab === "moderation") {
      params.set("status", "draft");
    } else if (statusFilter) {
      params.set("status", statusFilter);
    }
    if (sourceFilter) params.set("source", sourceFilter);
    if (search) params.set("search", search);

    const res = await fetch(`/api/admin/public-mikey/answers?${params}`);
    if (res.ok) {
      const data = await res.json();
      setAnswers(data.answers);
      setPagination(data.pagination);
    }
  }, [page, statusFilter, sourceFilter, search, sort, tab]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [statsRes] = await Promise.all([
          fetch("/api/admin/public-mikey/stats"),
          fetchAnswers(),
        ]);
        if (statsRes.ok) {
          const data = await statsRes.json();
          setStats(data.stats);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchAnswers]);

  const handleStatusChange = async (id: string, newStatus: string) => {
    await fetch(`/api/admin/public-mikey/answers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchAnswers();
    // Refresh stats
    const statsRes = await fetch("/api/admin/public-mikey/stats");
    if (statsRes.ok) {
      const data = await statsRes.json();
      setStats(data.stats);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to hide this answer?")) return;
    await handleStatusChange(id, "hidden");
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "published":
        return "bg-green-100 text-green-700";
      case "draft":
        return "bg-yellow-100 text-yellow-700";
      case "hidden":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-600";
    }
  };

  const sourceBadge = (source: string) => {
    return source === "twitter"
      ? "bg-blue-100 text-blue-700"
      : "bg-emerald-100 text-emerald-700";
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Public Mikey</h1>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
          <StatCard label="Total Answers" value={stats.total} />
          <StatCard label="Published" value={stats.published} />
          <StatCard label="Draft" value={stats.draft} highlight={stats.draft > 0} />
          <StatCard label="Hidden" value={stats.hidden} />
          <StatCard label="Total Views" value={stats.totalViews} />
          <StatCard label="Twitter" value={stats.twitterCount} />
          <StatCard label="Ask Mikey" value={stats.askMikeyCount} />
          <StatCard label="Avg Views" value={stats.avgViews} />
          <StatCard label="Last 7 Days" value={stats.last7Days} />
          <StatCard label="Last 30 Days" value={stats.last30Days} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => { setTab("all"); setPage(1); }}
          className={`px-3 py-1.5 text-sm font-medium rounded-md ${
            tab === "all"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          All Answers
        </button>
        <button
          onClick={() => { setTab("moderation"); setPage(1); }}
          className={`px-3 py-1.5 text-sm font-medium rounded-md ${
            tab === "moderation"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Moderation Queue
          {stats && stats.draft > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-yellow-500 text-white rounded-full">
              {stats.draft}
            </span>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search questions..."
            className="w-48 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Search
          </button>
        </form>

        {tab === "all" && (
          <>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
            >
              <option value="">All Statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="hidden">Hidden</option>
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
            >
              <option value="">All Sources</option>
              <option value="twitter">Twitter</option>
              <option value="ask-mikey">Ask Mikey</option>
            </select>
          </>
        )}

        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
        >
          <option value="createdAt">Newest</option>
          <option value="viewCount">Most Viewed</option>
        </select>
      </div>

      {/* Answers table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Question
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">
                Source
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-20">
                Views
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-28">
                Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-36">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {answers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                  {tab === "moderation"
                    ? "No answers pending moderation."
                    : "No answers found."}
                </td>
              </tr>
            ) : (
              answers.map((answer) => (
                <tr key={answer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/public-mikey/${answer.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-blue-600 line-clamp-1"
                    >
                      {answer.question}
                    </Link>
                    {answer.twitterHandle && (
                      <span className="text-xs text-gray-400 ml-2">
                        @{answer.twitterHandle}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${sourceBadge(
                        answer.source
                      )}`}
                    >
                      {answer.source === "twitter" ? "Twitter" : "Ask Mikey"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge(
                        answer.status
                      )}`}
                    >
                      {answer.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {answer.viewCount}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(answer.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {answer.status === "draft" && (
                        <button
                          onClick={() => handleStatusChange(answer.id, "published")}
                          className="text-xs text-green-600 hover:text-green-800 font-medium"
                        >
                          Publish
                        </button>
                      )}
                      {answer.status === "published" && (
                        <button
                          onClick={() => handleDelete(answer.id)}
                          className="text-xs text-red-600 hover:text-red-800 font-medium"
                        >
                          Hide
                        </button>
                      )}
                      {answer.status === "hidden" && (
                        <button
                          onClick={() => handleStatusChange(answer.id, "published")}
                          className="text-xs text-green-600 hover:text-green-800 font-medium"
                        >
                          Restore
                        </button>
                      )}
                      <Link
                        href={`/answers/${answer.slug}`}
                        target="_blank"
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page >= pagination.totalPages}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`p-4 rounded-lg border ${
        highlight ? "border-yellow-300 bg-yellow-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
