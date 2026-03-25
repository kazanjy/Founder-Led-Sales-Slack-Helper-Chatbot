/**
 * Gamma API client for generating AI-powered presentations.
 * Generates branded sales decks from structured content.
 *
 * API docs: https://gamma.app/docs/api
 */

const GAMMA_API_BASE = "https://api.gamma.app/v1";

export interface GammaGenerateOptions {
  /** The structured slide content / outline */
  inputText: string;
  /** Presentation title */
  title: string;
  /** Output format */
  format?: "presentation" | "document" | "webpage";
  /** Number of cards/slides to generate */
  numCards?: number;
  /** Tone/style description (brand aesthetics go here) */
  tone?: string;
  /** Theme preference */
  theme?: "professional" | "modern" | "minimal" | "bold" | "creative";
}

export interface GammaGenerateResult {
  /** Gamma generation job ID */
  jobId: string;
  /** Status of the generation */
  status: "pending" | "processing" | "completed" | "failed";
}

export interface GammaJobResult {
  /** Job status */
  status: "pending" | "processing" | "completed" | "failed";
  /** Live Gamma URL (for viewing/editing) */
  gammaUrl?: string;
  /** Error message if failed */
  error?: string;
}

export interface GammaExportResult {
  /** Download URL for the exported file */
  downloadUrl: string;
  /** Format of the export */
  format: "pdf" | "pptx";
}

/**
 * Start a Gamma presentation generation job.
 */
export async function generatePresentation(options: GammaGenerateOptions): Promise<GammaGenerateResult> {
  const apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) {
    console.error("[Gamma] GAMMA_API_KEY is not set in environment variables");
    throw new Error("GAMMA_API_KEY is not configured");
  }

  const {
    inputText,
    title,
    format = "presentation",
    numCards,
    tone,
    theme = "professional",
  } = options;

  console.log(`[Gamma] Starting generation: "${title}" (format=${format}, numCards=${numCards || "auto"}, theme=${theme}, inputLength=${inputText.length} chars, toneLength=${tone?.length || 0} chars)`);

  const startTime = Date.now();
  const response = await fetch(`${GAMMA_API_BASE}/generate`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_text: inputText,
      title,
      format,
      num_cards: numCards,
      tone,
      theme,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    console.error(`[Gamma] Generate API failed: status=${response.status}, elapsed=${Date.now() - startTime}ms, body=${errorText.substring(0, 500)}`);
    throw new Error(`Gamma API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const jobId = data.job_id || data.id;
  console.log(`[Gamma] Job created: ${jobId} (status=${data.status || "pending"}, elapsed=${Date.now() - startTime}ms)`);

  return {
    jobId,
    status: data.status || "pending",
  };
}

/**
 * Poll a Gamma generation job until it completes or fails.
 * @param jobId - The job ID from generatePresentation
 * @param maxWaitMs - Maximum time to wait (default 120s)
 * @param pollIntervalMs - Time between polls (default 3s)
 */
export async function pollGenerationJob(
  jobId: string,
  maxWaitMs: number = 120000,
  pollIntervalMs: number = 3000
): Promise<GammaJobResult> {
  const apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) {
    throw new Error("GAMMA_API_KEY is not configured");
  }

  const startTime = Date.now();
  let pollCount = 0;

  console.log(`[Gamma] Polling job ${jobId} (maxWait=${maxWaitMs / 1000}s, interval=${pollIntervalMs / 1000}s)`);

  while (Date.now() - startTime < maxWaitMs) {
    pollCount++;
    const response = await fetch(`${GAMMA_API_BASE}/generate/${jobId}`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[Gamma] Poll #${pollCount} for job ${jobId} failed: status=${response.status}, elapsed=${Date.now() - startTime}ms, body=${errorText.substring(0, 500)}`);
      throw new Error(`Gamma poll error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const status = data.status;

    console.log(`[Gamma] Poll #${pollCount} job ${jobId}: status=${status}, elapsed=${Date.now() - startTime}ms`);

    if (status === "completed") {
      const gammaUrl = data.url || data.gamma_url;
      console.log(`[Gamma] Job ${jobId} completed after ${pollCount} polls (${Date.now() - startTime}ms). URL: ${gammaUrl}`);
      return {
        status: "completed",
        gammaUrl,
      };
    }

    if (status === "failed") {
      const error = data.error || "Generation failed";
      console.error(`[Gamma] Job ${jobId} FAILED after ${pollCount} polls (${Date.now() - startTime}ms). Error: ${error}`);
      return {
        status: "failed",
        error,
      };
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.error(`[Gamma] Job ${jobId} TIMED OUT after ${pollCount} polls (${Date.now() - startTime}ms)`);
  throw new Error(`Gamma generation timed out after ${maxWaitMs / 1000}s`);
}

/**
 * Export a Gamma presentation to PDF or PPTX.
 */
export async function exportPresentation(
  gammaUrl: string,
  format: "pdf" | "pptx"
): Promise<GammaExportResult> {
  const apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) {
    throw new Error("GAMMA_API_KEY is not configured");
  }

  // Extract the Gamma document ID from the URL
  const docId = extractGammaDocId(gammaUrl);

  console.log(`[Gamma] Exporting doc ${docId} as ${format} (from URL: ${gammaUrl})`);

  const startTime = Date.now();
  const response = await fetch(`${GAMMA_API_BASE}/export`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      document_id: docId,
      format,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    console.error(`[Gamma] Export ${format} failed for doc ${docId}: status=${response.status}, elapsed=${Date.now() - startTime}ms, body=${errorText.substring(0, 500)}`);
    throw new Error(`Gamma export error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const downloadUrl = data.download_url || data.url;

  console.log(`[Gamma] Export ${format} complete for doc ${docId}: elapsed=${Date.now() - startTime}ms, downloadUrl=${downloadUrl}`);

  return {
    downloadUrl,
    format,
  };
}

/**
 * Full pipeline: generate a presentation and export to both PDF and PPTX.
 */
export async function generateAndExport(options: GammaGenerateOptions): Promise<{
  gammaUrl: string;
  pdfUrl: string;
  pptxUrl: string;
}> {
  const pipelineStart = Date.now();
  console.log(`[Gamma] === Pipeline start: "${options.title}" ===`);

  // 1. Start generation
  const { jobId } = await generatePresentation(options);

  // 2. Poll until complete
  const result = await pollGenerationJob(jobId);
  if (result.status === "failed" || !result.gammaUrl) {
    console.error(`[Gamma] === Pipeline FAILED at generation step: ${result.error || "No URL returned"} (elapsed=${Date.now() - pipelineStart}ms) ===`);
    throw new Error(`Gamma generation failed: ${result.error || "No URL returned"}`);
  }

  console.log(`[Gamma] Generation succeeded, starting PDF + PPTX export (elapsed=${Date.now() - pipelineStart}ms)`);

  // 3. Export to both formats in parallel
  const [pdfExport, pptxExport] = await Promise.all([
    exportPresentation(result.gammaUrl, "pdf"),
    exportPresentation(result.gammaUrl, "pptx"),
  ]);

  console.log(`[Gamma] === Pipeline COMPLETE: gammaUrl=${result.gammaUrl}, pdfUrl=${pdfExport.downloadUrl}, pptxUrl=${pptxExport.downloadUrl}, totalElapsed=${Date.now() - pipelineStart}ms ===`);

  return {
    gammaUrl: result.gammaUrl,
    pdfUrl: pdfExport.downloadUrl,
    pptxUrl: pptxExport.downloadUrl,
  };
}

/**
 * Extract a Gamma document ID from a Gamma URL.
 * e.g., "https://gamma.app/docs/abc123" -> "abc123"
 */
function extractGammaDocId(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    // Gamma URLs are typically /docs/{id} or /embed/{id}
    return parts[parts.length - 1] || url;
  } catch {
    // If not a valid URL, assume it's already a doc ID
    return url;
  }
}
