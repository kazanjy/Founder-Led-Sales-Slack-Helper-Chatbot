import { FEATURE_PAGES, getFeaturePage } from "@/lib/marketing/feature-pages";
import { SOLUTION_PAGES, getSolutionPage } from "@/lib/marketing/solution-pages";
import type { MarketingPage } from "@/lib/marketing/types";

/**
 * Shared chrome for the public SEO pages (/features/*, /solutions/*).
 * Server-rendered, no client hooks — the dropdowns are CSS-only
 * (group-hover + focus-within), so every link is in the crawlable
 * HTML and the menus still open on tap/keyboard.
 */

const FEATURE_GROUPS: Array<{ title: string; slugs: string[] }> = [
  {
    title: "Run your deals",
    slugs: ["deal-pipeline-autopilot", "slack-sales-assistant", "pre-call-planning", "call-review"],
  },
  {
    title: "Get better at selling",
    slugs: ["sales-coaching", "practice-roleplay"],
  },
  {
    title: "Build the playbook",
    slugs: ["sales-playbook", "outbound-content", "customer-proof"],
  },
];

const SOLUTION_GROUPS: Array<{ title: string; slugs: string[] }> = [
  {
    title: "Where you are",
    slugs: ["technical-founder-sales", "learn-to-sell", "first-sales-hire"],
  },
  {
    title: "What you need",
    slugs: ["founder-led-sales-playbook", "founder-crm-alternative", "win-more-deals", "sell-in-slack"],
  },
];

function NavDropdown({
  label,
  href,
  groups,
  resolve,
  base,
  allLabel,
}: {
  label: string;
  href: string;
  groups: Array<{ title: string; slugs: string[] }>;
  resolve: (slug: string) => MarketingPage | undefined;
  base: string;
  allLabel: string;
}) {
  return (
    <div className="relative group">
      <a
        href={href}
        className="inline-flex items-center gap-1 px-3 py-2 text-gray-600 hover:text-gray-900 font-medium rounded-lg hover:bg-gray-100"
      >
        {label}
        <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 transition-transform group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </a>
      {/* Bridge keeps hover alive across the gap to the panel. */}
      <div className="absolute left-0 top-full h-2 w-full" />
      <div className="invisible opacity-0 translate-y-1 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all duration-150 absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50">
        <div className="w-[min(600px,92vw)] bg-white rounded-2xl shadow-2xl border border-gray-100 p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
            {groups.map((g) => (
              <div key={g.title} className={g.slugs.length > 3 ? "sm:row-span-2" : ""}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                  {g.title}
                </div>
                <ul className="space-y-0.5">
                  {g.slugs.map((slug) => {
                    const p = resolve(slug);
                    if (!p) return null;
                    return (
                      <li key={slug}>
                        <a
                          href={`${base}/${p.slug}`}
                          className="flex items-start gap-2 px-2 py-1.5 -mx-2 rounded-lg hover:bg-purple-50"
                        >
                          <span className="text-base leading-5 mt-0.5" aria-hidden>{p.emoji}</span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-900">{p.h1}</span>
                            <span className="block text-xs text-gray-500 line-clamp-1">{p.subhead}</span>
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <a
            href={href}
            className="mt-5 inline-block text-sm font-semibold text-purple-600 hover:text-purple-800"
          >
            {allLabel} →
          </a>
        </div>
      </div>
    </div>
  );
}

/** The Features / Solutions dropdown pair — reused by the homepage nav. */
export function MarketingNavDropdowns() {
  return (
    <>
      <NavDropdown
        label="Features"
        href="/features"
        groups={FEATURE_GROUPS}
        resolve={getFeaturePage}
        base="/features"
        allLabel="View all features"
      />
      <NavDropdown
        label="Solutions"
        href="/solutions"
        groups={SOLUTION_GROUPS}
        resolve={getSolutionPage}
        base="/solutions"
        allLabel="View all solutions"
      />
    </>
  );
}

export function MarketingNav() {
  return (
    <nav className="w-full px-6 py-4 bg-white/80 backdrop-blur-sm border-b border-gray-100 relative z-40">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mikey-avatar.png" alt="Mikey" className="w-10 h-10 rounded-lg" />
          <span className="font-bold text-xl text-gray-900">Mikey</span>
        </a>
        <div className="flex items-center gap-1 sm:gap-2 text-sm">
          <MarketingNavDropdowns />
          <a href="/signin" className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium rounded-lg hover:bg-gray-100">
            Sign In
          </a>
        </div>
      </div>
    </nav>
  );
}

export function MarketingCta({ line }: { line: string }) {
  return (
    <section className="my-14 p-8 rounded-2xl text-center text-white" style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}>
      <p className="text-xl font-semibold mb-5">✨ {line}</p>
      <div className="flex items-center justify-center gap-4 flex-wrap">
        <a
          href="/signin"
          className="px-7 py-3 bg-white text-purple-700 rounded-xl font-semibold hover:shadow-lg transition-shadow"
        >
          Get started free
        </a>
        <a
          href="/signin?next=/chat?startAssessment=true"
          className="px-7 py-3 border border-white/60 text-white rounded-xl font-semibold hover:bg-white/10 transition-colors"
        >
          Take the GTM assessment
        </a>
      </div>
    </section>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-gray-200 bg-white px-6 py-12">
      <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8 text-sm">
        <div>
          <div className="flex items-center gap-2 mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mikey-avatar.png" alt="Mikey" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-gray-900">Mikey</span>
          </div>
          <p className="text-gray-500">
            The AI-powered founder-led sales platform, built on Pete Kazanjy&rsquo;s{" "}
            <em>Founding Sales</em> methodology.
          </p>
          <p className="text-gray-400 mt-3">
            <a href="/privacy" className="hover:underline">Privacy</a>
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-gray-900 mb-3">Features</h3>
          <ul className="space-y-1.5">
            {FEATURE_PAGES.map((p) => (
              <li key={p.slug}>
                <a href={`/features/${p.slug}`} className="text-gray-500 hover:text-purple-700 hover:underline">
                  {p.emoji} {p.h1}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-gray-900 mb-3">Solutions</h3>
          <ul className="space-y-1.5">
            {SOLUTION_PAGES.map((p) => (
              <li key={p.slug}>
                <a href={`/solutions/${p.slug}`} className="text-gray-500 hover:text-purple-700 hover:underline">
                  {p.emoji} {p.h1}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
