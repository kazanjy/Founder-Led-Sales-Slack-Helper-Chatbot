"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface PublicAnswer {
  id: string;
  question: string;
  slug: string;
  answer: string;
  preview: string;
  source: string;
  status: string;
  viewCount: number;
  twitterTweetId: string | null;
  twitterTweetUrl: string | null;
  twitterHandle: string | null;
  twitterThreadContext: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function AdminPublicMikeyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [answer, setAnswer] = useState<PublicAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editAnswer, setEditAnswer] = useState("");
  const [editPreview, setEditPreview] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/admin/public-mikey/answers/${id}`);
        if (res.ok) {
          const data = await res.json();
          setAnswer(data.answer);
          setEditAnswer(data.answer.answer);
          setEditPreview(data.answer.preview);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/public-mikey/answers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: editAnswer, preview: editPreview }),
      });
      if (res.ok) {
        const data = await res.json();
        setAnswer(data.answer);
        setEditing(false);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    const res = await fetch(`/api/admin/public-mikey/answers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      const data = await res.json();
      setAnswer(data.answer);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Permanently delete this answer? This cannot be undone.")) return;
    const res = await fetch(`/api/admin/public-mikey/answers/${id}?hard=true`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.push("/admin/public-mikey");
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!answer) {
    return <div className="text-center py-12 text-gray-500">Answer not found.</div>;
  }

  const statusColor = {
    published: "bg-green-100 text-green-700",
    draft: "bg-yellow-100 text-yellow-700",
    hidden: "bg-red-100 text-red-700",
  }[answer.status] || "bg-gray-100 text-gray-600";

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/public-mikey"
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          &larr; Back to Public Mikey
        </Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900 flex-1 mr-4">
            {answer.question}
          </h1>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor}`}>
            {answer.status}
          </span>
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 text-sm">
          <div>
            <span className="text-gray-500">Source</span>
            <div className="font-medium">
              {answer.source === "twitter" ? "Twitter" : "Ask Mikey"}
            </div>
          </div>
          <div>
            <span className="text-gray-500">Views</span>
            <div className="font-medium">{answer.viewCount}</div>
          </div>
          <div>
            <span className="text-gray-500">Created</span>
            <div className="font-medium">
              {new Date(answer.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
          <div>
            <span className="text-gray-500">Updated</span>
            <div className="font-medium">
              {new Date(answer.updatedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
        </div>

        {/* Twitter metadata */}
        {answer.source === "twitter" && (
          <div className="bg-blue-50 rounded-lg p-4 mb-6 text-sm">
            <h3 className="font-medium text-blue-900 mb-2">Twitter Details</h3>
            {answer.twitterHandle && (
              <div className="text-blue-700">Handle: @{answer.twitterHandle}</div>
            )}
            {answer.twitterTweetUrl && (
              <div className="text-blue-700">
                Tweet:{" "}
                <a
                  href={answer.twitterTweetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {answer.twitterTweetUrl}
                </a>
              </div>
            )}
            {answer.twitterThreadContext && (
              <div className="mt-2">
                <span className="text-blue-700 font-medium">Thread Context:</span>
                <pre className="mt-1 text-xs text-blue-800 whitespace-pre-wrap bg-blue-100 rounded p-2 max-h-40 overflow-y-auto">
                  {answer.twitterThreadContext}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Answer content */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">Answer</h2>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <textarea
                value={editAnswer}
                onChange={(e) => setEditAnswer(e.target.value)}
                rows={12}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div>
                <label className="text-xs font-medium text-gray-500">
                  Preview (max 280 chars)
                </label>
                <input
                  type="text"
                  value={editPreview}
                  onChange={(e) => setEditPreview(e.target.value.slice(0, 280))}
                  maxLength={280}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setEditAnswer(answer.answer);
                    setEditPreview(answer.preview);
                  }}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm max-w-none text-gray-700 bg-gray-50 rounded-lg p-4">
              {answer.answer.split("\n").map((p, i) =>
                p.trim() ? <p key={i}>{p}</p> : null
              )}
            </div>
          )}
        </div>

        {/* Preview */}
        {!editing && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Preview</h2>
            <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
              {answer.preview}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-200">
          {answer.status !== "published" && (
            <button
              onClick={() => handleStatusChange("published")}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Publish
            </button>
          )}
          {answer.status === "published" && (
            <button
              onClick={() => handleStatusChange("hidden")}
              className="px-4 py-2 text-sm bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
            >
              Hide
            </button>
          )}
          {answer.status === "hidden" && (
            <button
              onClick={() => handleStatusChange("draft")}
              className="px-4 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              Move to Draft
            </button>
          )}
          <Link
            href={`/answers/${answer.slug}`}
            target="_blank"
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            View Public Page
          </Link>
          <button
            onClick={handleDelete}
            className="px-4 py-2 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50 ml-auto"
          >
            Delete Permanently
          </button>
        </div>
      </div>
    </div>
  );
}
