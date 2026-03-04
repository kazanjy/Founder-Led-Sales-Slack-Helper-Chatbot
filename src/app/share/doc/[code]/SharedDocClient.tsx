"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface SharedDocument {
  documentType: string;
  title: string;
  content: string;
  createdAt: string;
}

const typeLabels: Record<string, string> = {
  salesNarrative: "Sales Narrative",
  discoveryQuestions: "Discovery Questions",
  firstCallChecklist: "First Call Checklist",
  preCallPlanning: "Pre-Call Checklist",
  preCallResearch: "Pre-Call Research",
};

interface SharedDocClientProps {
  code: string;
}

export default function SharedDocClient({ code }: SharedDocClientProps) {
  const [doc, setDoc] = useState<SharedDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDoc() {
      try {
        const res = await fetch(`/api/share/doc/${code}`);
        const data = await res.json();

        if (data.error) {
          setError(data.error);
        } else {
          setDoc(data.document);
        }
      } catch {
        setError("Failed to load document");
      } finally {
        setLoading(false);
      }
    }

    loadDoc();
  }, [code]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <img
            src="/mikey-avatar.png"
            alt="Mikey"
            className="w-16 h-16 rounded-xl mx-auto mb-4"
          />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Oops!</h1>
          <p className="text-gray-500">{error || "Document not found"}</p>
          <a
            href="/"
            className="inline-block mt-4 text-blue-600 hover:underline"
          >
            Go to Mikey
          </a>
        </div>
      </div>
    );
  }

  const typeLabel = typeLabels[doc.documentType] || doc.documentType;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-[900px] mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 hover:opacity-80 flex-shrink-0">
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className="w-8 h-8 rounded-lg"
            />
            <span className="font-semibold text-gray-900">Mikey</span>
          </a>
          <span className="text-sm text-gray-500 text-center hidden sm:block">
            Shared {typeLabel} from Mikey, the Founder-Led Sales assistant.
          </span>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className="w-5 h-5 rounded"
            />
            Try Mikey
          </a>
        </div>
      </header>

      {/* Document content */}
      <main className="max-w-[800px] mx-auto px-6 py-8">
        <div className="mb-6">
          <span className="inline-block px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium mb-3">
            {typeLabel}
          </span>
          <h1 className="text-2xl font-bold text-gray-900">{doc.title}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Shared {new Date(doc.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>

        <div className="prose max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-hr:my-4 text-[17px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-gray-200 text-center">
          <p className="text-sm text-gray-500 mb-4">
            This {typeLabel.toLowerCase()} was created with Mikey, the Founder-Led Sales assistant.
          </p>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <img
              src="/mikey-avatar.png"
              alt="Mikey"
              className="w-5 h-5 rounded"
            />
            Try Mikey
          </a>
        </div>
      </main>
    </div>
  );
}
