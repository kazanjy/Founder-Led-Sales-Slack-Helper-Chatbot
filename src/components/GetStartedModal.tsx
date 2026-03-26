"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface GetStartedModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string | null;
}

function getDomainFromEmail(email: string | null | undefined): string {
  if (!email) return "";
  const domain = email.split("@")[1];
  if (!domain) return "";
  // Skip common personal email providers
  const personal = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "protonmail.com", "me.com", "live.com", "msn.com", "mail.com", "zoho.com", "yandex.com"];
  if (personal.includes(domain.toLowerCase())) return "";
  return `https://${domain}`;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url.startsWith("http") ? url : `https://${url}`);
    return url.trim().length > 0;
  } catch {
    return false;
  }
}

export default function GetStartedModal({ isOpen, onClose, userEmail }: GetStartedModalProps) {
  const router = useRouter();
  const [websiteUrl, setWebsiteUrl] = useState(() => getDomainFromEmail(userEmail));
  const [crawlStatus, setCrawlStatus] = useState<"idle" | "crawling" | "ready">("idle");
  const precrawlFiredRef = useRef<string | null>(null);

  // Fire precrawl as soon as a valid URL is present
  useEffect(() => {
    if (!isOpen) return;
    const url = websiteUrl.trim();
    if (!url || !isValidUrl(url) || precrawlFiredRef.current === url) return;

    precrawlFiredRef.current = url;
    setCrawlStatus("crawling");

    fetch("/api/sales-narrative/precrawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ websiteUrl: url }),
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.crawlText) {
          // Store precrawl result so the edit page can use it
          try {
            sessionStorage.setItem("precrawlResult", JSON.stringify({
              text: data.crawlText,
              urls: data.crawlUrls || [],
            }));
          } catch { /* storage full — will just recrawl */ }
          setCrawlStatus("ready");
        } else {
          setCrawlStatus("idle");
        }
      })
      .catch(() => setCrawlStatus("idle"));
  }, [isOpen, websiteUrl]);

  // Reset crawl status when URL changes to something different
  useEffect(() => {
    const url = websiteUrl.trim();
    if (precrawlFiredRef.current && precrawlFiredRef.current !== url) {
      setCrawlStatus("idle");
      precrawlFiredRef.current = null;
    }
  }, [websiteUrl]);

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
    sessionStorage.setItem("getStartedModalDismissed", "true");
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
            <div className="flex items-center gap-2 mt-2 min-h-[20px]">
              {crawlStatus === "crawling" && (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="text-xs text-purple-500 font-medium">Crawling your site...</p>
                </>
              )}
              {crawlStatus === "ready" && (
                <>
                  <svg className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-xs text-green-600 font-medium">Ready! Your site has been crawled.</p>
                </>
              )}
              {crawlStatus === "idle" && (
                <p className="text-xs text-gray-400">
                  Mikey will crawl your site and auto-fill your sales narrative questionnaire. You can also upload PDFs or answer manually.
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={handleGetStarted}
              className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl hover:from-purple-700 hover:to-blue-700 transition-all font-semibold text-lg shadow-md hover:shadow-lg flex items-center justify-center gap-2"
            >
              {crawlStatus === "crawling" ? (
                <>
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Crawling your site...
                </>
              ) : crawlStatus === "ready" ? (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Ready! Build My Sales Narrative
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {websiteUrl.trim() ? "Build My Sales Narrative" : "Get Started"}
                </>
              )}
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
