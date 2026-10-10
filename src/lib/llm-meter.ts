/**
 * Per-call LLM metering.
 *
 * Every OpenAI call in the app goes through the single client in
 * lib/openai.ts, so wrapping that one instance meters all 112 call
 * sites without touching any of them.
 *
 * Three things this is careful about:
 *
 *  - STREAMING. 18 call sites pass stream: true, and the API sends no
 *    usage block for a stream unless you ask for one. Without
 *    stream_options.include_usage those calls would log zero tokens and
 *    read as free, which is the opposite of the truth — narrative
 *    generation and the iterate endpoints are not cheap.
 *  - FAILURES. A timeout still bills for input while returning nothing.
 *    Failed calls are recorded with ok=false so that spend is visible
 *    rather than silently missing.
 *  - NEVER BREAKING A CALL. Metering is wrapped so that a logging or
 *    database fault can never surface as an OpenAI failure to a user.
 */

import { prisma } from "@/lib/db";

/**
 * Model prices, USD per 1M tokens.
 *
 * SEED VALUES — VERIFY BEFORE TRUSTING ANY DOLLAR FIGURE. The gpt-5.5
 * input rate is reverse-engineered from a comment in lib/deals/analyze
 * ("600K chars ≈ 150K tokens ≈ $0.75 of input"), which implies $5/1M.
 * The others are placeholders of the right order of magnitude.
 *
 * This is exactly why raw token counts are stored alongside costUsd:
 * when these numbers are corrected, bump PRICE_VERSION and recompute
 * history from tokens. The token counts are never wrong; the prices
 * might be.
 */
export const PRICE_VERSION = "v1";

interface Price {
  /** Per 1M input tokens. */
  input: number;
  /** Per 1M input tokens served from cache — typically a fraction. */
  cachedInput: number;
  /** Per 1M output tokens. */
  output: number;
}

const PRICES: Record<string, Price> = {
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 15 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
};

const FALLBACK_PRICE: Price = PRICES["gpt-5.5"];

function priceFor(model: string): Price {
  if (PRICES[model]) return PRICES[model];
  // Dated snapshots ("gpt-4o-2024-11-20") price as their base model.
  const base = Object.keys(PRICES).find((k) => model.startsWith(k));
  return base ? PRICES[base] : FALLBACK_PRICE;
}

export function computeCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number
): number {
  const p = priceFor(model);
  // Cached tokens are counted inside promptTokens, so bill the
  // uncached remainder at full rate and the cached part at the
  // discount — charging both would double-count the cache.
  const uncached = Math.max(0, promptTokens - cachedTokens);
  return (
    (uncached * p.input + cachedTokens * p.cachedInput + completionTokens * p.output) / 1_000_000
  );
}

/**
 * Work out which feature made the call, from the stack.
 *
 * Chosen over threading a label through 112 call sites. It is a guess,
 * and it says so: an unrecognisable frame yields "unknown" rather than
 * something plausible-looking. Call sites that matter can pass an
 * explicit label, which always wins.
 *
 * Next.js emits per-route server chunks under .next/server/app/<route>,
 * so the route path usually survives into production stack traces. The
 * patterns below are ordered most-specific first.
 */
export function labelFromStack(stack: string | undefined): string {
  if (!stack) return "unknown";
  const lines = stack.split("\n").slice(1);
  for (const line of lines) {
    // Skip the wrapper's own frame and the SDK's.
    //
    // meteredCreate is matched BY FUNCTION NAME, not by file: the
    // wrapper lives in lib/openai.ts, and so do genuine callers like
    // generateChatTitle. Skipping the whole file would mislabel those;
    // skipping the frame only means a caller in lib/openai.ts still
    // attributes to lib/openai, which is correct.
    if (
      line.includes("meteredCreate") ||
      line.includes("llm-meter") ||
      line.includes("node_modules")
    ) {
      continue;
    }

    // Production: .next/server/app/api/deals/[id]/analyze/route.js
    const built = line.match(/\.next\/server\/app\/(.+?)\/route\.(?:js|ts)/);
    if (built) return built[1];

    // Dev / source maps: src/app/api/deals/[id]/analyze/route.ts
    const route = line.match(/src\/app\/(.+?)\/route\.tsx?/);
    if (route) return route[1];

    // Shared helpers: src/lib/coaching/synthesize.ts -> lib/coaching/synthesize
    const lib = line.match(/src\/(lib\/.+?)\.tsx?/);
    if (lib) return lib[1];
  }
  return "unknown";
}

export interface MeterRecord {
  label: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  durationMs: number;
  streamed: boolean;
  ok: boolean;
  errorKind?: string | null;
  userId?: string | null;
}

/**
 * Persist one metered call.
 *
 * Awaited by the wrapper rather than fired and forgotten: a serverless
 * function can freeze before a floating promise resolves, which would
 * drop exactly the long-running calls worth measuring. One INSERT after
 * a multi-second model call is noise.
 *
 * Swallows everything. Metering that breaks a user's request is worse
 * than metering that misses a row.
 */
export async function recordLlmCall(rec: MeterRecord): Promise<void> {
  try {
    const totalTokens = rec.promptTokens + rec.completionTokens;
    await prisma.llmCall.create({
      data: {
        label: rec.label,
        model: rec.model,
        promptTokens: rec.promptTokens,
        completionTokens: rec.completionTokens,
        cachedTokens: rec.cachedTokens,
        totalTokens,
        costUsd: computeCostUsd(
          rec.model,
          rec.promptTokens,
          rec.completionTokens,
          rec.cachedTokens
        ),
        priceVersion: PRICE_VERSION,
        durationMs: rec.durationMs,
        streamed: rec.streamed,
        ok: rec.ok,
        errorKind: rec.errorKind ?? null,
        userId: rec.userId ?? null,
      },
    });
  } catch (err) {
    // A structured line so the data is still recoverable from logs when
    // the write fails.
    console.error(
      "[llm-meter] failed to persist:",
      JSON.stringify({ ...rec, error: err instanceof Error ? err.message : String(err) })
    );
  }
}

/** Narrow an unknown thrown value to something worth grouping by. */
export function errorKindOf(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { status?: number; name?: string; code?: string };
    if (e.status) return `http_${e.status}`;
    if (e.code) return String(e.code);
    if (e.name) return String(e.name);
  }
  return "unknown";
}
