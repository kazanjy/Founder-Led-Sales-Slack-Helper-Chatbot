"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AskMikeyPage() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmed = question.trim();
    if (trimmed.length < 10) {
      setError("Please enter a more detailed question (at least 10 characters).");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/public/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      const data = await res.json();
      router.push(`/answers/${data.answer.slug}`);
    } catch {
      setError("Failed to submit question. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/answers" className="text-lg font-bold text-gray-900">
            Ask Mikey
          </Link>
          <Link
            href="/answers"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Browse Answers
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Ask Mikey
          </h1>
          <p className="text-lg text-gray-600">
            Get expert advice on founder-led sales. Your question and Mikey&apos;s
            answer will be public and visible to everyone.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="question"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Your question
            </label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g., How do I price my first SaaS deal as a technical founder?"
              rows={4}
              maxLength={2000}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none"
              disabled={loading}
            />
            <div className="flex justify-between mt-1">
              <p className="text-xs text-gray-400">
                This is a public Q&A — your question will be visible to everyone.
              </p>
              <span className="text-xs text-gray-400">
                {question.length}/2000
              </span>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || question.trim().length < 10}
            className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Mikey is thinking..." : "Ask Mikey"}
          </button>
        </form>
      </main>
    </div>
  );
}
