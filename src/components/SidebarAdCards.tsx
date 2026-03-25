"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";

interface ContentStatus {
  salesDeck: boolean;
  emailSequence: boolean;
  linkedinSequence: boolean;
  socialContent: boolean;
  coldCallScript: boolean;
}

type ContentType = keyof ContentStatus;

interface AdCard {
  key: ContentType;
  title: string;
  description: string;
  href: string;
  cta: string;
  gradient: string;
  descColor: string;
  ctaColor: string;
  ctaHover: string;
  icon: ReactNode;
}

const AD_CARDS: AdCard[] = [
  {
    key: "salesDeck",
    title: "Sales Deck",
    description: "Create a compelling pitch deck tailored to your narrative and ICP.",
    href: "/sales-deck",
    cta: "Create Sales Deck",
    gradient: "from-orange-500 to-pink-500",
    descColor: "text-orange-100",
    ctaColor: "text-orange-600",
    ctaHover: "hover:bg-orange-50",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
      </svg>
    ),
  },
  {
    key: "emailSequence",
    title: "Outbound Email Sequence",
    description: "Generate a multi-touch email sequence to engage your ideal prospects.",
    href: "/email-sequence",
    cta: "Create Email Sequence",
    gradient: "from-emerald-500 to-teal-600",
    descColor: "text-emerald-100",
    ctaColor: "text-emerald-600",
    ctaHover: "hover:bg-emerald-50",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    key: "linkedinSequence",
    title: "Outbound LinkedIn Sequence",
    description: "Build a LinkedIn outreach sequence to connect with decision makers.",
    href: "/linkedin-sequence",
    cta: "Create LinkedIn Sequence",
    gradient: "from-blue-600 to-indigo-700",
    descColor: "text-blue-100",
    ctaColor: "text-blue-600",
    ctaHover: "hover:bg-blue-50",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    key: "socialContent",
    title: "Social Posts",
    description: "Generate engaging social media content to build your brand presence.",
    href: "/social-content",
    cta: "Create Social Posts",
    gradient: "from-pink-500 to-rose-600",
    descColor: "text-pink-100",
    ctaColor: "text-pink-600",
    ctaHover: "hover:bg-pink-50",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
    ),
  },
  {
    key: "coldCallScript",
    title: "Cold Call Scripts",
    description: "Create structured cold call scripts to confidently open conversations.",
    href: "/cold-call-script",
    cta: "Create Cold Call Script",
    gradient: "from-amber-500 to-orange-600",
    descColor: "text-amber-100",
    ctaColor: "text-amber-600",
    ctaHover: "hover:bg-amber-50",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
  },
];

/** How many ad cards to show at once */
const MAX_VISIBLE = 3;

interface SidebarAdCardsProps {
  /** The content type key for the current page (will be excluded from ads) */
  currentPage?: ContentType;
}

export function SidebarAdCards({ currentPage }: SidebarAdCardsProps) {
  const [status, setStatus] = useState<ContentStatus | null>(null);

  useEffect(() => {
    fetch("/api/content-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setStatus(data);
      })
      .catch(() => {});
  }, []);

  // Filter: exclude current page + already-completed items
  const visibleCards = AD_CARDS.filter((card) => {
    if (card.key === currentPage) return false;
    if (status && status[card.key]) return false;
    return true;
  }).slice(0, MAX_VISIBLE);

  if (visibleCards.length === 0) return null;

  return (
    <>
      {visibleCards.map((card) => (
        <div
          key={card.key}
          className={`mt-4 bg-gradient-to-br ${card.gradient} rounded-xl p-5 text-white shadow-lg hover:shadow-xl transition-shadow`}
        >
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center mb-4">
            {card.icon}
          </div>
          <h3 className="font-bold text-lg mb-1">{card.title}</h3>
          <p className={`${card.descColor} text-sm mb-4`}>{card.description}</p>
          <Link
            href={card.href}
            target="_blank"
            className={`block w-full text-center px-4 py-2.5 bg-white ${card.ctaColor} rounded-lg ${card.ctaHover} transition-colors font-semibold text-sm`}
          >
            {card.cta}
          </Link>
        </div>
      ))}
    </>
  );
}
