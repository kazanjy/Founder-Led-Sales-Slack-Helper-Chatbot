"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface GetStartedModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GetStartedModal({ isOpen, onClose }: GetStartedModalProps) {
  const router = useRouter();
  const [websiteUrl, setWebsiteUrl] = useState("");

  if (!isOpen) return null;

  const handleGetStarted = () => {
    const url = websiteUrl.trim();
    if (url) {
      router.push(`/sales-narrative/edit?prefillUrl=${encodeURIComponent(url)}`);
    } else {
      router.push("/sales-narrative/edit");
    }
  };

  const handleSkip = () => {
    localStorage.setItem("getStartedModalDismissed", "true");
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-8 pt-8 pb-6 text-center">
          <img
            src="/mikey-avatar.png"
            alt="Mikey"
            className="w-20 h-20 mx-auto mb-4 rounded-xl border-2 border-white/20 shadow-lg"
          />
          <h2 className="text-2xl font-bold text-white mb-2">
            Let&apos;s get started!
          </h2>
          <p className="text-blue-100">
            Feed Mikey your messaging so he can help you sell.
          </p>
        </div>

        {/* Body */}
        <div className="px-8 py-6">
          <p className="text-gray-600 mb-5">
            Drop in your website URL and Mikey will crawl it to build your <strong>Sales Narrative</strong> &mdash; your product story, value prop, and elevator pitches. This powers everything else: discovery questions, call prep, outreach sequences, and more.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Your website URL
            </label>
            <input
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://yourcompany.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none text-lg"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGetStarted();
              }}
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-2">
              Mikey will crawl your site and auto-fill your sales narrative questionnaire. You can also upload PDFs or answer manually.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={handleGetStarted}
              className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl hover:from-purple-700 hover:to-blue-700 transition-all font-semibold text-lg shadow-md hover:shadow-lg flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {websiteUrl.trim() ? "Build My Sales Narrative" : "Get Started"}
            </button>
            <button
              onClick={handleSkip}
              className="w-full px-6 py-2 text-gray-500 hover:text-gray-700 transition-colors text-sm"
            >
              Skip for now &mdash; I&apos;ll explore on my own
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
