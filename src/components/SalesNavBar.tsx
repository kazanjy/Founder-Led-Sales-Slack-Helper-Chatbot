"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";

interface NavItem {
  href: string;
  label: string;
  statusKey: string;
}

const contentItems: NavItem[] = [
  { href: "/email-sequence", label: "📧 Email Sequences", statusKey: "emailSequence" },
  { href: "/linkedin-sequence", label: "💼 LinkedIn Outbound", statusKey: "linkedInSequence" },
  { href: "/social-content", label: "📱 Social Posts", statusKey: "socialContent" },
  { href: "/ad-creator", label: "📣 Ads", statusKey: "adCreator" },
];

const callExecutionItems: NavItem[] = [
  { href: "/pre-call-planning/research", label: "🔬 Pre-Call Research", statusKey: "preCallResearch" },
  { href: "/call-review", label: "📞 Call Review", statusKey: "callReview" },
  { href: "/call-scripts", label: "🎯 Cold Call Scripts", statusKey: "coldCallScript" },
];

const standaloneItems: NavItem[] = [
  { href: "/sales-deck", label: "📊 Sales Decks", statusKey: "salesDeck" },
  { href: "/objection-library", label: "🛡️ Objections", statusKey: "objectionLibrary" },
  { href: "/sales-metrics", label: "📈 Metrics", statusKey: "salesMetrics" },
  { href: "/coaching-history", label: "🎓 Coaching", statusKey: "coachingHistory" },
];

const allNavItems: NavItem[] = [...contentItems, ...callExecutionItems, ...standaloneItems];

const playbookItems: NavItem[] = [
  { href: "/assessment/bulk", label: "📊 GTM Assessment", statusKey: "assessment" },
  { href: "/sales-narrative", label: "📖 Sales Narrative", statusKey: "salesNarrative" },
  { href: "/icp", label: "👤 Ideal Customer Profile", statusKey: "icp" },
  { href: "/discovery-questions", label: "🔍 Discovery Questions", statusKey: "discoveryQuestions" },
  { href: "/first-call-checklist", label: "✅ First Call Checklist", statusKey: "firstCallChecklist" },
  { href: "/pre-call-planning", label: "📋 Pre-Call Checklist", statusKey: "preCallPlanning" },
];

interface CompletionStatus {
  [key: string]: boolean;
}

export default function SalesNavBar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<CompletionStatus>({});
  const [playbookOpen, setPlaybookOpen] = useState(false);
  const [contentOpen, setContentOpen] = useState(false);
  const [callExecOpen, setCallExecOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const contentDropdownRef = useRef<HTMLDivElement>(null);
  const callExecDropdownRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const [impersonating, setImpersonating] = useState<{ active: boolean; userName: string | null }>({ active: false, userName: null });

  // Close mobile menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    if (mobileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [mobileMenuOpen]);

  // Close mobile menu on route change
  const closeMenus = useCallback(() => {
    setMobileMenuOpen(false);
    setPlaybookOpen(false);
    setContentOpen(false);
    setCallExecOpen(false);
  }, []);

  useEffect(() => {
    async function fetchStatus() {
      try {
        // Check impersonation status
        fetch("/api/auth/me")
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.user?.isImpersonating) {
              setImpersonating({ active: true, userName: data.user.name || data.user.email || null });
            }
          })
          .catch(() => {});

        const [narrativeRes, discoveryRes, checklistRes, planningRes, researchRes, assessmentRes, emailSeqRes, linkedInSeqRes, callReviewRes, coldCallRes, salesDeckRes, salesMetricsRes, objectionLibraryRes, socialContentRes, icpRes] = await Promise.all([
          fetch("/api/sales-narrative/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/discovery-questions/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/first-call-checklist/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/pre-call-planning/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/pre-call-planning/research/history").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/maturity/progress").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/email-sequence/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/linkedin-sequence/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/call-review/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/cold-call-script/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/sales-deck/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/sales-metrics/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/objection-library/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/social-content/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/icp/latest").then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        setStatus({
          salesNarrative: !!narrativeRes?.hasNarrative,
          icp: !!icpRes?.hasIcp,
          discoveryQuestions: !!discoveryRes?.hasDiscoveryQuestions,
          firstCallChecklist: !!checklistRes?.hasFirstCallChecklist,
          preCallPlanning: !!planningRes?.hasPreCallPlanning,
          preCallResearch: !!(researchRes?.researches?.length > 0),
          assessment: assessmentRes?.status === "completed",
          emailSequence: !!emailSeqRes?.hasEmailSequence,
          linkedInSequence: !!linkedInSeqRes?.hasLinkedInSequence,
          callReview: !!callReviewRes?.hasCallReview,
          coldCallScript: !!coldCallRes?.hasColdCallScript,
          salesDeck: !!salesDeckRes?.hasSalesDeck,
          salesMetrics: !!salesMetricsRes?.hasSalesMetrics,
          objectionLibrary: !!objectionLibraryRes?.hasObjectionLibrary,
          socialContent: !!socialContentRes?.hasSocialContent,
        });
      } catch {
        // silently fail - indicators just won't show
      }
    }
    fetchStatus();
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setPlaybookOpen(false);
      }
      if (contentDropdownRef.current && !contentDropdownRef.current.contains(e.target as Node)) {
        setContentOpen(false);
      }
      if (callExecDropdownRef.current && !callExecDropdownRef.current.contains(e.target as Node)) {
        setCallExecOpen(false);
      }
    }
    if (playbookOpen || contentOpen || callExecOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [playbookOpen, contentOpen, callExecOpen]);

  const isActive = (href: string) => {
    if (href === "/chat") return pathname === "/chat" || pathname.startsWith("/chat/");
    if (href === "/assessment/bulk") return pathname.startsWith("/assessment") || pathname.startsWith("/maturity-history");
    if (href === "/pre-call-planning/research") return pathname.startsWith("/pre-call-planning/research");
    if (href === "/pre-call-planning") return pathname === "/pre-call-planning" || pathname === "/pre-call-planning/history";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const isPlaybookActive = playbookItems.some((item) => isActive(item.href));
  const playbookCompletedCount = playbookItems.filter((item) => status[item.statusKey]).length;
  const isContentActive = contentItems.some((item) => isActive(item.href));
  const isCallExecActive = callExecutionItems.some((item) => isActive(item.href));

  return (
    <>
    {impersonating.active && (
      <ImpersonationBanner userName={impersonating.userName} />
    )}
    <nav className={`bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 ${impersonating.active ? "mt-10" : ""}`}>
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        {/* Mobile: hamburger + current page indicator */}
        <div className="flex items-center md:hidden py-2 gap-2">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
          <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
            {(() => {
              const activeItem = [...allNavItems, ...playbookItems, { href: "/chat", label: "💬 Chat", statusKey: "chat" }].find(item => isActive(item.href));
              return activeItem?.label || "💬 Chat";
            })()}
          </span>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div ref={mobileMenuRef} className="md:hidden absolute left-0 right-0 top-auto bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-lg z-50 max-h-[70vh] overflow-y-auto">
            <div className="py-2">
              <Link
                href="/chat"
                onClick={closeMenus}
                className={`block px-4 py-3 text-sm font-medium transition-colors ${
                  isActive("/chat") ? "bg-purple-50 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                💬 Chat
              </Link>
              {/* Playbook section */}
              <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  📒 Playbook
                  {playbookCompletedCount > 0 && (
                    <span className="text-green-600 font-medium">{playbookCompletedCount}/{playbookItems.length}</span>
                  )}
                </div>
                {playbookItems.map((item) => {
                  const href = item.statusKey === "assessment" && status[item.statusKey]
                    ? "/maturity-history"
                    : item.href;
                  return (
                    <Link
                      key={item.href}
                      href={href}
                      onClick={closeMenus}
                      className={`flex items-center gap-2 px-6 py-2.5 text-sm transition-colors ${
                        isActive(item.href) ? "bg-purple-50 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                      }`}
                    >
                      <span className="flex-1">{item.label}</span>
                      {status[item.statusKey] && <span className="text-green-500 text-xs">✔️</span>}
                    </Link>
                  );
                })}
              </div>
              {/* Content section */}
              <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">✏️ Content</div>
                {contentItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMenus}
                    className={`flex items-center gap-2 px-6 py-2.5 text-sm transition-colors ${
                      isActive(item.href) ? "bg-purple-50 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}
                  >
                    <span className="flex-1">{item.label}</span>
                    {status[item.statusKey] && <span className="text-green-500 text-xs">✔️</span>}
                  </Link>
                ))}
              </div>
              {/* Call Execution section */}
              <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">📞 Call Execution</div>
                {callExecutionItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMenus}
                    className={`flex items-center gap-2 px-6 py-2.5 text-sm transition-colors ${
                      isActive(item.href) ? "bg-purple-50 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}
                  >
                    <span className="flex-1">{item.label}</span>
                    {status[item.statusKey] && <span className="text-green-500 text-xs">✔️</span>}
                  </Link>
                ))}
              </div>
              {/* Other tools */}
              <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tools</div>
                {standaloneItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMenus}
                    className={`flex items-center gap-2 px-6 py-2.5 text-sm transition-colors ${
                      isActive(item.href) ? "bg-purple-50 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}
                  >
                    <span className="flex-1">{item.label}</span>
                    {status[item.statusKey] && <span className="text-green-500 text-xs">✔️</span>}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Desktop: horizontal tabs (hidden on mobile) */}
        <div className="hidden md:flex items-center gap-1 -mb-px flex-wrap">
          {/* Chat */}
          <Link
            href="/chat"
            className={`px-2 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1 ${
              isActive("/chat")
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300"
            }`}
          >
            💬 Chat
          </Link>

          {/* Playbook dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => { setPlaybookOpen(!playbookOpen); setContentOpen(false); setCallExecOpen(false); }}
              className={`px-2 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1 ${
                isPlaybookActive
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300"
              }`}
            >
              📒 Playbook
              {playbookCompletedCount > 0 && (
                <span className="text-xs text-green-600 font-medium">{playbookCompletedCount}/{playbookItems.length}</span>
              )}
              <svg className={`w-3.5 h-3.5 transition-transform ${playbookOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {playbookOpen && (
              <div className="absolute top-full left-0 mt-px bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[220px]">
                {playbookItems.map((item) => {
                  // When assessment is completed, link to history page instead of the form
                  const href = item.statusKey === "assessment" && status[item.statusKey]
                    ? "/maturity-history"
                    : item.href;
                  return (
                    <Link
                      key={item.href}
                      href={href}
                      onClick={() => setPlaybookOpen(false)}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                        isActive(item.href)
                          ? "bg-purple-50 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400"
                          : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                      }`}
                    >
                      <span className="flex-1">{item.label}</span>
                      {status[item.statusKey] && (
                        <span className="text-green-500 text-xs">✔️</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Content dropdown */}
          <div className="relative" ref={contentDropdownRef}>
            <button
              onClick={() => { setContentOpen(!contentOpen); setCallExecOpen(false); setPlaybookOpen(false); }}
              className={`px-2 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1 ${
                isContentActive
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300"
              }`}
            >
              ✏️ Content
              <svg className={`w-3.5 h-3.5 transition-transform ${contentOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {contentOpen && (
              <div className="absolute top-full left-0 mt-px bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[220px]">
                {contentItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setContentOpen(false)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                      isActive(item.href)
                        ? "bg-purple-50 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400"
                        : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}
                  >
                    <span className="flex-1">{item.label}</span>
                    {status[item.statusKey] && (
                      <span className="text-green-500 text-xs">✔️</span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Call Execution dropdown */}
          <div className="relative" ref={callExecDropdownRef}>
            <button
              onClick={() => { setCallExecOpen(!callExecOpen); setContentOpen(false); setPlaybookOpen(false); }}
              className={`px-2 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1 ${
                isCallExecActive
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300"
              }`}
            >
              📞 Call Execution
              <svg className={`w-3.5 h-3.5 transition-transform ${callExecOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {callExecOpen && (
              <div className="absolute top-full left-0 mt-px bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[220px]">
                {callExecutionItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setCallExecOpen(false)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                      isActive(item.href)
                        ? "bg-purple-50 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400"
                        : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}
                  >
                    <span className="flex-1">{item.label}</span>
                    {status[item.statusKey] && (
                      <span className="text-green-500 text-xs">✔️</span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Standalone items */}
          {standaloneItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-2 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1 ${
                isActive(item.href)
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300"
              }`}
            >
              {item.label}
              {status[item.statusKey] && (
                <span className="text-green-500 text-xs" title="Completed">✔️</span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </nav>
    </>
  );
}
