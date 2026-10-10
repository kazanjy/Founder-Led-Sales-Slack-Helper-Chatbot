import type { Metadata } from "next";
import { FEATURE_PAGES } from "@/lib/marketing/feature-pages";
import { MarketingNav, MarketingCta, MarketingFooter } from "@/components/marketing/MarketingShell";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";

export const metadata: Metadata = {
  title: "Features — AI Founder-Led Sales Platform | Mikey",
  description:
    "Everything Mikey does: self-building pipeline, AI coaching, practice drills, pre-call briefs, call review, Slack-native selling, playbook generation, and customer proof.",
  alternates: { canonical: `${appUrl}/features` },
  openGraph: {
    title: "Features — AI Founder-Led Sales Platform | Mikey",
    description:
      "Everything Mikey does: self-building pipeline, AI coaching, practice drills, pre-call briefs, call review, Slack-native selling, playbook generation, and customer proof.",
    type: "website",
    url: `${appUrl}/features`,
    siteName: "Mikey",
  },
};

export default function FeaturesIndexPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      <MarketingNav />
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-wider text-purple-600 mb-3">Product</p>
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">
          🧰 Everything a founder needs to sell
        </h1>
        <p className="text-xl text-gray-600 mb-10 max-w-2xl">
          One platform for the whole founder-led sales motion — the playbook, the calls, the
          pipeline, and the proof. Each capability feeds the next.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURE_PAGES.map((p) => (
            <a
              key={p.slug}
              href={`/features/${p.slug}`}
              className="block p-5 rounded-2xl bg-white border border-gray-200 hover:border-purple-300 hover:shadow-md transition-all"
            >
              <h2 className="text-lg font-bold text-gray-900 mb-1">
                <span className="mr-2" aria-hidden>{p.emoji}</span>
                {p.h1}
              </h2>
              <p className="text-sm text-gray-500 leading-relaxed">{p.subhead}</p>
            </a>
          ))}
        </div>
        <MarketingCta line="See it on your own pipeline — setup takes minutes." />
      </div>
      <MarketingFooter />
    </main>
  );
}
