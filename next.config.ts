import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel handles this automatically, but explicit for clarity
  serverExternalPackages: ["@slack/bolt"],
};

export default nextConfig;
