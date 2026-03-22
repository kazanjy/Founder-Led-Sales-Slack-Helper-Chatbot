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

  // NOTE: /ask and /answers index are excluded from sitemap until public launch.
  // Only individual answer pages are indexed for now.
  return answerEntries;
}
