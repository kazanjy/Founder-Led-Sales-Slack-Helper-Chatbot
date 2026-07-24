import type { Metadata } from "next";
import { SOLUTION_PAGES } from "@/lib/marketing/solution-pages";
import { MarketingNav, MarketingCta, MarketingFooter } from "@/components/marketing/MarketingShell";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";

export const metadata: Metadata = {
  title: "Solutions — Founder-Led Sales Use Cases | Mikey",
  description:
    "Whatever brought you here — learning to sell, replacing the CRM you never update, prepping your first sales hire, selling in Slack — there's a mapped path.",
  alternates: { canonical: `${appUrl}/solutions` },
  openGraph: {
    title: "Solutions — Founder-Led Sales Use Cases | Mikey",
    description:
      "Whatever brought you here — learning to sell, replacing the CRM you never update, prepping your first sales hire, selling in Slack — there's a mapped path.",
    type: "website",
    url: `${appUrl}/solutions`,
    siteName: "Mikey",
  },
};

export default function SolutionsIndexPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      <MarketingNav />
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-wider text-purple-600 mb-3">Solutions</p>
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">
          🎯 Start from your problem
        </h1>
        <p className="text-xl text-gray-600 mb-10 max-w-2xl">
          Founder-led sales shows up as different pains at different stages. Pick yours — each
          path maps the problem onto the parts of Mikey that solve it.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SOLUTION_PAGES.map((p) => (
            <a
              key={p.slug}
              href={`/solutions/${p.slug}`}
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
        <MarketingCta line="Not sure where you stand? The GTM assessment places you in minutes." />
      </div>
      <MarketingFooter />
    </main>
  );
}
