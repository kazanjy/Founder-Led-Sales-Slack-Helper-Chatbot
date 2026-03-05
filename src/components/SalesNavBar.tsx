"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  statusKey: string;
}

const navItems: NavItem[] = [
  { href: "/chat", label: "💬 Chat", statusKey: "chat" },
  { href: "/assessment/bulk", label: "📊 GTM Assessment", statusKey: "assessment" },
  { href: "/sales-narrative", label: "📖 Sales Narrative", statusKey: "salesNarrative" },
  { href: "/discovery-questions", label: "🔍 Discovery Questions", statusKey: "discoveryQuestions" },
  { href: "/first-call-checklist", label: "✅ First Call Checklist", statusKey: "firstCallChecklist" },
  { href: "/pre-call-planning", label: "📋 Pre-Call Checklist", statusKey: "preCallPlanning" },
  { href: "/pre-call-planning/research", label: "🔬 Pre-Call Research", statusKey: "preCallResearch" },
  { href: "/email-sequence", label: "📧 Email Sequence", statusKey: "emailSequence" },
  { href: "/linkedin-sequence", label: "💼 LinkedIn Sequence", statusKey: "linkedInSequence" },
];

interface CompletionStatus {
  [key: string]: boolean;
}

export default function SalesNavBar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<CompletionStatus>({});

  useEffect(() => {
    async function fetchStatus() {
      try {
        const [narrativeRes, discoveryRes, checklistRes, planningRes, researchRes, assessmentRes, emailSeqRes, linkedInSeqRes] = await Promise.all([
          fetch("/api/sales-narrative/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/discovery-questions/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/first-call-checklist/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/pre-call-planning/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/pre-call-planning/research/history").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/maturity/progress").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/email-sequence/latest").then(r => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/linkedin-sequence/latest").then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        setStatus({
          salesNarrative: !!narrativeRes?.hasNarrative,
          discoveryQuestions: !!discoveryRes?.hasDiscoveryQuestions,
          firstCallChecklist: !!checklistRes?.hasFirstCallChecklist,
          preCallPlanning: !!planningRes?.hasPreCallPlanning,
          preCallResearch: !!(researchRes?.researches?.length > 0),
          assessment: assessmentRes?.status === "completed",
          emailSequence: !!emailSeqRes?.hasEmailSequence,
          linkedInSequence: !!linkedInSeqRes?.hasLinkedInSequence,
        });
      } catch {
        // silently fail - indicators just won't show
      }
    }
    fetchStatus();
  }, []);

  const isActive = (href: string) => {
    if (href === "/chat") return pathname === "/chat" || pathname.startsWith("/chat/");
    if (href === "/assessment/bulk") return pathname.startsWith("/assessment");
    if (href === "/pre-call-planning/research") return pathname.startsWith("/pre-call-planning/research");
    if (href === "/pre-call-planning") return pathname === "/pre-call-planning" || pathname === "/pre-call-planning/history";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide -mb-px">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
                isActive(item.href)
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
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
  );
}
