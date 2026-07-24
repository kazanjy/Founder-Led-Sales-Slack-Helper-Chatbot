/**
 * SEO marketing pages — shared shape for feature pages (product-
 * centric: what a capability is and how it works) and solutions
 * pages (problem-centric: a founder's pain mapped onto several
 * features). Content lives in feature-pages.ts / solution-pages.ts;
 * the /features/[slug] and /solutions/[slug] templates render it.
 */

export interface MarketingSection {
  heading: string;
  body: string; // 1-3 sentences of prose
  bullets?: string[];
}

export interface MarketingFaq {
  q: string;
  a: string;
}

export interface MarketingPage {
  slug: string;
  /** <title> — keep under ~60 chars, keyword-forward. */
  seoTitle: string;
  /** meta description — under ~155 chars. */
  seoDescription: string;
  /** On-page H1 (can differ from seoTitle). */
  h1: string;
  subhead: string;
  /** Opening prose — the searcher's problem in their words. */
  intro: string;
  sections: MarketingSection[];
  /** "How it works" numbered steps. */
  steps?: string[];
  faqs: MarketingFaq[];
  /** Slugs of related feature pages to cross-link. */
  relatedFeatures?: string[];
  /** Slugs of related solutions pages to cross-link. */
  relatedSolutions?: string[];
  /** CTA line above the signup buttons. */
  ctaLine: string;
}
