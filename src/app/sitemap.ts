import type { MetadataRoute } from "next";
import { FEATURE_PAGES } from "@/lib/marketing/feature-pages";
import { SOLUTION_PAGES } from "@/lib/marketing/solution-pages";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: appUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${appUrl}/features`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${appUrl}/solutions`, changeFrequency: "weekly", priority: 0.9 },
    ...FEATURE_PAGES.map((p) => ({
      url: `${appUrl}/features/${p.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...SOLUTION_PAGES.map((p) => ({
      url: `${appUrl}/solutions/${p.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    { url: `${appUrl}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
