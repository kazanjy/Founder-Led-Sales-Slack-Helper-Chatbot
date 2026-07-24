import { FEATURE_PAGES } from "@/lib/marketing/feature-pages";
import { SOLUTION_PAGES } from "@/lib/marketing/solution-pages";

/**
 * Shared chrome for the public SEO pages (/features/*, /solutions/*).
 * Server-rendered, no client hooks — plain anchors keep it crawlable.
 * The footer lists every marketing page for internal linking.
 */
export function MarketingNav() {
  return (
    <nav className="w-full px-6 py-4 bg-white/80 backdrop-blur-sm border-b border-gray-100">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mikey-avatar.png" alt="Mikey" className="w-10 h-10 rounded-lg" />
          <span className="font-bold text-xl text-gray-900">Mikey</span>
        </a>
        <div className="flex items-center gap-1 sm:gap-4 text-sm">
          <a href="/features" className="px-3 py-2 text-gray-600 hover:text-gray-900 font-medium rounded-lg hover:bg-gray-100">
            Features
          </a>
          <a href="/solutions" className="px-3 py-2 text-gray-600 hover:text-gray-900 font-medium rounded-lg hover:bg-gray-100">
            Solutions
          </a>
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
      <p className="text-xl font-semibold mb-5">{line}</p>
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
                  {p.h1}
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
                  {p.h1}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
