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

  console.log(`[Gamma] Starting generation: "${title}" (${format}, ${numCards || "auto"} cards)`);

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
    throw new Error(`Gamma API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log(`[Gamma] Job created: ${data.job_id || data.id}`);

  return {
    jobId: data.job_id || data.id,
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

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(`${GAMMA_API_BASE}/generate/${jobId}`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Gamma poll error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const status = data.status;

    console.log(`[Gamma] Job ${jobId} status: ${status}`);

    if (status === "completed") {
      return {
        status: "completed",
        gammaUrl: data.url || data.gamma_url,
      };
    }

    if (status === "failed") {
      return {
        status: "failed",
        error: data.error || "Generation failed",
      };
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

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

  console.log(`[Gamma] Exporting ${docId} as ${format}`);

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
    throw new Error(`Gamma export error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  return {
    downloadUrl: data.download_url || data.url,
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
  // 1. Start generation
  const { jobId } = await generatePresentation(options);

  // 2. Poll until complete
  const result = await pollGenerationJob(jobId);
  if (result.status === "failed" || !result.gammaUrl) {
    throw new Error(`Gamma generation failed: ${result.error || "No URL returned"}`);
  }

  // 3. Export to both formats in parallel
  const [pdfExport, pptxExport] = await Promise.all([
    exportPresentation(result.gammaUrl, "pdf"),
    exportPresentation(result.gammaUrl, "pptx"),
  ]);

  console.log(`[Gamma] Generation + export complete: ${result.gammaUrl}`);

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
