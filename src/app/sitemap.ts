import { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const answers = await prisma.publicAnswer.findMany({
    where: { status: "published" },
    select: { slug: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });

  const answerEntries: MetadataRoute.Sitemap = answers.map((a) => ({
    url: `${BASE_URL}/answers/${a.slug}`,
    lastModified: a.updatedAt,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [
    {
      url: `${BASE_URL}/ask`,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/answers`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    ...answerEntries,
  ];
}
