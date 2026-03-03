import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Externalize packages that have native dependencies or worker issues
  serverExternalPackages: [
    "@slack/bolt",
    "canvas",           // Native canvas package for server-side PDF rendering
    "jsdom",            // HTML parsing for pre-call research — has native deps that break webpack
    "pdfjs-dist",       // Prevent bundling issues with workers
  ],
};

export default nextConfig;
