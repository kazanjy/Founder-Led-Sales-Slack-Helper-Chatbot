import type { MarketingPage } from "@/lib/marketing/types";
import { getFeaturePage } from "@/lib/marketing/feature-pages";
import { getSolutionPage } from "@/lib/marketing/solution-pages";
import { MarketingNav, MarketingCta, MarketingFooter } from "./MarketingShell";

/**
 * Renderer shared by /features/[slug] and /solutions/[slug].
 * Emits FAQPage JSON-LD for the FAQ block (rich-result eligible).
 */
export function MarketingPageView({ page, kind }: { page: MarketingPage; kind: "feature" | "solution" }) {
  const related: Array<{ href: string; label: string; tag: string }> = [
    ...(page.relatedFeatures || [])
      .map((slug) => getFeaturePage(slug))
      .filter((p): p is MarketingPage => !!p)
      .map((p) => ({ href: `/features/${p.slug}`, label: `${p.emoji} ${p.h1}`, tag: "Feature" })),
    ...(page.relatedSolutions || [])
      .map((slug) => getSolutionPage(slug))
      .filter((p): p is MarketingPage => !!p)
      .map((p) => ({ href: `/solutions/${p.slug}`, label: `${p.emoji} ${p.h1}`, tag: "Solution" })),
  ];

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      <MarketingNav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <article className="max-w-3xl mx-auto px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-wider text-purple-600 mb-3">
          {kind === "feature" ? "Product" : "Solutions"}
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4 leading-tight">
          <span className="mr-3" aria-hidden>{page.emoji}</span>
          {page.h1}
        </h1>
        <p className="text-xl text-gray-600 mb-6">{page.subhead}</p>
        <p className="text-lg text-gray-600 leading-relaxed mb-10">{page.intro}</p>

        {page.sections.map((s) => (
          <section key={s.heading} className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{s.heading}</h2>
            <p className="text-gray-600 leading-relaxed">{s.body}</p>
            {s.bullets && (
              <ul className="mt-3 space-y-1.5">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-gray-600">
                    <span className="text-purple-500 mt-0.5">✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {page.steps && (
          <section className="mb-8 p-6 rounded-2xl bg-white border border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">⚙️ How it works</h2>
            <ol className="space-y-3">
              {page.steps.map((step, i) => (
                <li key={step} className="flex items-start gap-3 text-gray-600">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-100 text-purple-700 font-bold text-sm flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <MarketingCta line={page.ctaLine} />

        <section className="mb-10">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">🙋 Frequently asked questions</h2>
          <div className="space-y-5">
            {page.faqs.map((f) => (
              <div key={f.q}>
                <h3 className="font-semibold text-gray-900 mb-1">{f.q}</h3>
                <p className="text-gray-600 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {related.length > 0 && (
          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4">
              Related
            </h2>
            <div className="flex flex-wrap gap-2">
              {related.map((r) => (
                <a
                  key={r.href}
                  href={r.href}
                  className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:border-purple-300 hover:text-purple-700"
                >
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-1.5">{r.tag}</span>
                  {r.label}
                </a>
              ))}
            </div>
          </section>
        )}
      </article>
      <MarketingFooter />
    </main>
  );
}
