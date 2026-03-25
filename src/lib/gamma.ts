/**
 * Gamma API client for generating AI-powered presentations.
 * Generates branded sales decks from structured content.
 *
 * API docs: https://developers.gamma.app
 */

const GAMMA_API_BASE = "https://public-api.gamma.app/v1.0";

export interface GammaGenerateOptions {
  /** The structured slide content / outline */
  inputText: string;
  /** Presentation title */
  title: string;
  /** Output format */
  format?: "presentation" | "document" | "social";
  /** Number of cards/slides to generate */
  numCards?: number;
  /** Tone/style description (brand aesthetics go here) */
  tone?: string;
  /** Theme preference */
  theme?: "professional" | "modern" | "minimal" | "bold" | "creative";
}

export interface GammaGenerateResult {
  /** Gamma generation job ID */
  generationId: string;
  /** Status of the generation */
  status: "pending" | "processing" | "completed" | "failed";
}

export interface GammaJobResult {
  /** Job status */
  status: "pending" | "processing" | "completed" | "failed";
  /** Live Gamma URL (for viewing/editing) */
  gammaUrl?: string;
  /** Export download URL (if exportAs was specified) */
  exportUrl?: string;
  /** Error message if failed */
  error?: string;
}

function getApiKey(): string {
  const apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) {
    console.error("[Gamma] GAMMA_API_KEY is not set in environment variables");
    throw new Error("GAMMA_API_KEY is not configured");
  }
  return apiKey;
}

/**
 * Start a Gamma presentation generation job.
 * @param exportAs - Optional: request an export (pdf/pptx) alongside generation
 */
export async function generatePresentation(
  options: GammaGenerateOptions,
  exportAs?: "pdf" | "pptx"
): Promise<GammaGenerateResult> {
  const apiKey = getApiKey();

  const {
    inputText,
    title,
    format = "presentation",
    numCards,
    tone,
  } = options;

  console.log(`[Gamma] Starting generation: "${title}" (format=${format}, numCards=${numCards || "auto"}, exportAs=${exportAs || "none"}, inputLength=${inputText.length} chars, toneLength=${tone?.length || 0} chars)`);

  const requestBody: Record<string, unknown> = {
    inputText,
    format,
    textMode: "generate",
    cardOptions: {
      dimensions: "16x9",
    },
    sharingOptions: {
      externalAccess: "view",
    },
  };

  if (numCards) requestBody.numCards = numCards;
  if (tone) requestBody.textOptions = { tone };
  if (exportAs) requestBody.exportAs = exportAs;

  const startTime = Date.now();
  const response = await fetch(`${GAMMA_API_BASE}/generations`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    console.error(`[Gamma] Generate API failed: status=${response.status}, elapsed=${Date.now() - startTime}ms, body=${errorText.substring(0, 500)}`);
    throw new Error(`Gamma API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const generationId = data.generationId || data.id;
  console.log(`[Gamma] Job created: ${generationId} (status=${data.status || "pending"}, elapsed=${Date.now() - startTime}ms)`);

  return {
    generationId,
    status: data.status || "pending",
  };
}

/**
 * Poll a Gamma generation job until it completes or fails.
 * @param generationId - The generation ID from generatePresentation
 * @param maxWaitMs - Maximum time to wait (default 120s)
 * @param pollIntervalMs - Time between polls (default 3s)
 */
export async function pollGenerationJob(
  generationId: string,
  maxWaitMs: number = 120000,
  pollIntervalMs: number = 3000
): Promise<GammaJobResult> {
  const apiKey = getApiKey();

  const startTime = Date.now();
  let pollCount = 0;

  console.log(`[Gamma] Polling job ${generationId} (maxWait=${maxWaitMs / 1000}s, interval=${pollIntervalMs / 1000}s)`);

  while (Date.now() - startTime < maxWaitMs) {
    pollCount++;
    const response = await fetch(`${GAMMA_API_BASE}/generations/${generationId}`, {
      headers: {
        "X-API-KEY": apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[Gamma] Poll #${pollCount} for job ${generationId} failed: status=${response.status}, elapsed=${Date.now() - startTime}ms, body=${errorText.substring(0, 500)}`);
      throw new Error(`Gamma poll error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const status = data.status;

    console.log(`[Gamma] Poll #${pollCount} job ${generationId}: status=${status}, elapsed=${Date.now() - startTime}ms`);

    if (status === "completed") {
      const gammaUrl = data.gammaUrl || data.url;
      const exportUrl = data.exportUrl;
      console.log(`[Gamma] Job ${generationId} completed after ${pollCount} polls (${Date.now() - startTime}ms). gammaUrl=${gammaUrl}, exportUrl=${exportUrl || "none"}`);
      return {
        status: "completed",
        gammaUrl,
        exportUrl,
      };
    }

    if (status === "failed") {
      const error = data.error || "Generation failed";
      console.error(`[Gamma] Job ${generationId} FAILED after ${pollCount} polls (${Date.now() - startTime}ms). Error: ${error}`);
      return {
        status: "failed",
        error,
      };
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.error(`[Gamma] Job ${generationId} TIMED OUT after ${pollCount} polls (${Date.now() - startTime}ms)`);
  throw new Error(`Gamma generation timed out after ${maxWaitMs / 1000}s`);
}

/**
 * Run a single generation+poll cycle, optionally requesting an export format.
 */
async function generateAndPoll(
  options: GammaGenerateOptions,
  exportAs?: "pdf" | "pptx"
): Promise<GammaJobResult> {
  const { generationId } = await generatePresentation(options, exportAs);
  return pollGenerationJob(generationId);
}

/**
 * Full pipeline: generate a presentation and export to both PDF and PPTX.
 *
 * The Gamma API bundles export into the generation request (via exportAs),
 * so we run two parallel generation calls — one for each export format.
 * Both produce the same presentation content; we use the gammaUrl from
 * whichever finishes first.
 */
export async function generateAndExport(options: GammaGenerateOptions): Promise<{
  gammaUrl: string;
  pdfUrl: string;
  pptxUrl: string;
}> {
  const pipelineStart = Date.now();
  console.log(`[Gamma] === Pipeline start: "${options.title}" ===`);

  // Run both export formats in parallel
  const [pdfResult, pptxResult] = await Promise.all([
    generateAndPoll(options, "pdf"),
    generateAndPoll(options, "pptx"),
  ]);

  // Check for failures
  if (pdfResult.status === "failed") {
    console.error(`[Gamma] === Pipeline FAILED (PDF generation): ${pdfResult.error} (elapsed=${Date.now() - pipelineStart}ms) ===`);
    throw new Error(`Gamma PDF generation failed: ${pdfResult.error}`);
  }
  if (pptxResult.status === "failed") {
    console.error(`[Gamma] === Pipeline FAILED (PPTX generation): ${pptxResult.error} (elapsed=${Date.now() - pipelineStart}ms) ===`);
    throw new Error(`Gamma PPTX generation failed: ${pptxResult.error}`);
  }

  const gammaUrl = pdfResult.gammaUrl || pptxResult.gammaUrl;
  if (!gammaUrl) {
    console.error(`[Gamma] === Pipeline FAILED: no gammaUrl returned (elapsed=${Date.now() - pipelineStart}ms) ===`);
    throw new Error("Gamma generation failed: No presentation URL returned");
  }

  const pdfUrl = pdfResult.exportUrl || "";
  const pptxUrl = pptxResult.exportUrl || "";

  if (!pdfUrl) {
    console.warn(`[Gamma] PDF exportUrl missing from completed generation`);
  }
  if (!pptxUrl) {
    console.warn(`[Gamma] PPTX exportUrl missing from completed generation`);
  }

  console.log(`[Gamma] === Pipeline COMPLETE: gammaUrl=${gammaUrl}, pdfUrl=${pdfUrl}, pptxUrl=${pptxUrl}, totalElapsed=${Date.now() - pipelineStart}ms ===`);

  return {
    gammaUrl,
    pdfUrl,
    pptxUrl,
  };
}
