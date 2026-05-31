"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type OnboardingStep = "recorder" | "calendar" | "narrative";

interface OnboardingFlowProps {
  step: OnboardingStep;
  onDismissed: () => void;
}

interface SlideCopy {
  badge: string;
  title: string;
  subtitle: string;
  bullets: string[];
  ctaLabel: string;
  ctaHref: string;
  skipLabel: string;
}

const COPY: Record<OnboardingStep, SlideCopy> = {
  recorder: {
    badge: "Step 1 of 3",
    title: "Connect your meeting recorder",
    subtitle:
      "Mikey uses your recorder transcripts to auto-detect new deals, draft recap emails, and coach your calls.",
    bullets: [
      "Auto-create deals from new recorded meetings",
      "One-click recap emails after every call",
      "AI call coaching grounded in your own transcripts",
    ],
    ctaLabel: "Connect a recorder",
    ctaHref: "/call-review",
    skipLabel: "Maybe later",
  },
  calendar: {
    badge: "Step 2 of 3",
    title: "Connect your Google Calendar",
    subtitle:
      "Mikey reads upcoming meetings to surface pre-call research briefs and detect when a call is a follow-up.",
    bullets: [
      "Pre-call research delivered to Slack before each meeting",
      "Auto-flag follow-up calls with prior context",
      "Recurring research patterns by domain or company",
    ],
    ctaLabel: "Connect Google Calendar",
    ctaHref: "/api/auth/google?returnTo=/chat",
    skipLabel: "Maybe later",
  },
  narrative: {
    badge: "Step 3 of 3",
    title: "Generate your Sales Narrative",
    subtitle:
      "This is the foundation for nearly every other applet — sequences, discovery questions, decks, scripts, and more.",
    bullets: [
      "Powers email + LinkedIn sequence generation",
      "Drives discovery questions, FCC, and decks",
      "Takes ~10 minutes; saves dozens of hours downstream",
    ],
    ctaLabel: "Build my narrative",
    ctaHref: "/sales-narrative/edit",
    skipLabel: "Maybe later",
  },
};

export default function OnboardingFlow({ step, onDismissed }: OnboardingFlowProps) {
  const router = useRouter();
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const copy = COPY[step];

  const handleDismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    try {
      await fetch("/api/onboarding/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, kind: dontShowAgain ? "forever" : "once" }),
      });
    } catch (err) {
      console.error("Failed to dismiss onboarding step:", err);
    } finally {
      setDismissing(false);
      onDismissed();
    }
  };

  const handleConnect = () => {
    if (copy.ctaHref.startsWith("/api/")) {
      window.location.href = copy.ctaHref;
    } else {
      router.push(copy.ctaHref);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleDismiss} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-1">
          <div className="bg-white dark:bg-gray-900 px-6 py-4">
            <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">
              {copy.badge}
            </span>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">
              {copy.title}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{copy.subtitle}</p>
          </div>
        </div>

        <div className="p-6">
          <div className="space-y-3 mb-6">
            {copy.bullets.map((bullet) => (
              <div key={bullet} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg
                    className="w-3 h-3 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{bullet}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleConnect}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 font-medium text-sm transition-all"
            >
              {copy.ctaLabel}
            </button>

            <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none px-1">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
              />
              Don&rsquo;t show me this again
            </label>

            <button
              onClick={handleDismiss}
              disabled={dismissing}
              className="w-full py-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm disabled:opacity-50"
            >
              {copy.skipLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
