import { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Allow individual answer pages; hide /ask and /answers index until public launch
        allow: ["/answers/"],
        disallow: ["/api/", "/admin/", "/chat/", "/ask"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
