import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SOLUTION_PAGES, getSolutionPage } from "@/lib/marketing/solution-pages";
import { MarketingPageView } from "@/components/marketing/MarketingPageView";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";

export function generateStaticParams() {
  return SOLUTION_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const page = getSolutionPage(slug);
  if (!page) return {};
  const url = `${appUrl}/solutions/${page.slug}`;
  return {
    title: page.seoTitle,
    description: page.seoDescription,
    alternates: { canonical: url },
    openGraph: {
      title: page.seoTitle,
      description: page.seoDescription,
      type: "website",
      url,
      siteName: "Mikey",
    },
    twitter: {
      card: "summary_large_image",
      title: page.seoTitle,
      description: page.seoDescription,
    },
  };
}

export default async function SolutionPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const page = getSolutionPage(slug);
  if (!page) notFound();
  return <MarketingPageView page={page} kind="solution" />;
}
