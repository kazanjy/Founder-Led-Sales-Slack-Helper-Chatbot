import { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/answers", "/answers/", "/ask"],
        disallow: ["/api/", "/admin/", "/chat/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
