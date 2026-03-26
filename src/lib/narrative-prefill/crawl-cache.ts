/**
 * In-memory cache for pre-crawl results.
 * Shared between precrawl and prefill routes.
 */

import type { CrawlResult } from "@/lib/narrative-prefill/crawl-website";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  result: CrawlResult;
  expiresAt: number;
}

const crawlCache = new Map<string, CacheEntry>();

function makeKey(userId: string, url: string): string {
  return `${userId}:${url.toLowerCase().replace(/\/+$/, "")}`;
}

export function getCachedCrawl(userId: string, url: string): CrawlResult | null {
  const key = makeKey(userId, url);
  const entry = crawlCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    crawlCache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCachedCrawl(userId: string, url: string, result: CrawlResult): void {
  const key = makeKey(userId, url);
  crawlCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });

  // Evict expired entries periodically
  if (crawlCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of crawlCache) {
      if (now > v.expiresAt) crawlCache.delete(k);
    }
  }
}
