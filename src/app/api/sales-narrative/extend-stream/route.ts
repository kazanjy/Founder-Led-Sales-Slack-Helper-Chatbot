import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { crawlWebsiteForContext } from "@/lib/narrative-prefill/crawl-website";
import { fetchPages } from "@/lib/search/fetcher";
import { downloadFile } from "@/lib/supabase";
import { extractTextFromPDFWithOCR, formatPDFForAIWithOCR } from "@/lib/pdf-server";
import { extractTextFromImage } from "@/lib/narrative-prefill/extract-image";
import { loadNarrativeSources, type ExtractedSource } from "@/lib/narrative-prefill/sources";

export const maxDuration = 180;

/**
 * POST /api/sales-narrative/extend-stream
 *
 * Extend an existing narrative by adding new source documents. Reads
 * the cached extracted text from the parent version's NarrativeSource
 * rows, extracts text from the newly-supplied URLs / PDFs, combines
 * them into one corpus, and asks the LLM to re-prefill the Q&A.
 *
 * Output mirrors /prefill-stream — one SSE 'answer' event per
 * question + a final 'sources' event carrying the combined source
 * inventory (so the client can pass extractedSources +
 * parentVersionId to /generate-stream and the new version gets the
 * full union of cached sources).
 */

interface ExtendRequest {
  parentVersionId: string;
  newWebsiteUrl?: string;
  newSpecificUrls?: string[];
  newPdfFiles?: { name: string; storagePath?: string }[];
  newImageFiles?: { name: string; storagePath?: string; mimeType?: string }[];
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const body: ExtendRequest = await request.json();
    const { parentVersionId, newWebsiteUrl, newSpecificUrls, newPdfFiles, newImageFiles } = body;
    if (!parentVersionId) {
      return new Response(JSON.stringify({ error: "parentVersionId required" }), { status: 400 });
    }

    // Load parent version — also accept teammate versions (mirrors the
    // account-scope behavior of /latest and /iterate).
    const parentVersion = await prisma.salesNarrativeVersion.findFirst({
      where: {
        id: parentVersionId,
        OR: [
          { userId: user.id },
          ...(user.accountId ? [{ user: { accountId: user.accountId } }] : []),
        ],
      },
      select: { id: true, userId: true },
    });
    if (!parentVersion) {
      return new Response(JSON.stringify({ error: "Parent version not found" }), { status: 404 });
    }

    const cachedPriorSources = await loadNarrativeSources({
      userId: parentVersion.userId,
      versionId: parentVersion.id,
    });

    const questions = await prisma.salesNarrativeQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
      select: { id: true, category: true, globalOrder: true, question: true, helpText: true },
    });

    // Extract text from newly-added sources only (parent's text is
    // already cached). Skip dedupe-by-key against priors.
    const priorKeys = new Set(cachedPriorSources.map((s) => `${s.type}:${s.key.toLowerCase()}`));
    const newSources: ExtractedSource[] = [];
    const tasks: Promise<void>[] = [];

    if (newWebsiteUrl?.trim()) {
      tasks.push(
        crawlWebsiteForContext(newWebsiteUrl.trim())
          .then((result) => {
            if (result.text && result.urls[0]) {
              const k = `url:${result.urls[0].toLowerCase()}`;
              if (!priorKeys.has(k)) {
                newSources.push({ type: "url", key: result.urls[0], content: result.text });
              }
            }
          })
          .catch((err) => console.error("[ExtendStream] Crawl failed:", err))
      );
    }

    if (newSpecificUrls && newSpecificUrls.length > 0) {
      const cleanUrls = newSpecificUrls.filter((u) => u.trim()).map((u) => {
        const t = u.trim();
        return t.startsWith("http") ? t : `https://${t}`;
      });
      tasks.push(
        fetchPages(cleanUrls.map((u) => ({ url: u, purpose: "extend-page" })), 10)
          .then((pages) => {
            for (const p of pages) {
              if (!p.success || !p.textContent) continue;
              const k = `url:${p.url.toLowerCase()}`;
              if (priorKeys.has(k)) continue;
              newSources.push({ type: "url", key: p.url, content: p.textContent });
            }
          })
          .catch((err) => console.error("[ExtendStream] URL fetch failed:", err))
      );
    }

    if (newPdfFiles && newPdfFiles.length > 0) {
      for (const pdf of newPdfFiles) {
        tasks.push(
          (async () => {
            try {
              if (!pdf.storagePath) return;
              const buffer = await downloadFile(pdf.storagePath);
              if (!buffer) return;
              const { result, usedOCR } = await extractTextFromPDFWithOCR(buffer, pdf.name, 30);
              const formatted = formatPDFForAIWithOCR(result, usedOCR);
              if (!formatted) return;
              const k = `pdf:${pdf.name.toLowerCase()}`;
              if (priorKeys.has(k)) return;
              newSources.push({ type: "pdf", key: pdf.name, content: formatted });
            } catch (err) {
              console.error(`[ExtendStream] PDF ${pdf.name} failed:`, err);
            }
          })()
        );
      }
    }

    if (newImageFiles && newImageFiles.length > 0) {
      for (const img of newImageFiles) {
        tasks.push(
          (async () => {
            try {
              if (!img.storagePath) return;
              const buffer = await downloadFile(img.storagePath);
              if (!buffer) return;
              const extracted = await extractTextFromImage(buffer, img.name, img.mimeType || "image/png");
              if (!extracted) return;
              const k = `image:${img.name.toLowerCase()}`;
              if (priorKeys.has(k)) return;
              newSources.push({ type: "image", key: img.name, content: extracted });
            } catch (err) {
              console.error(`[ExtendStream] Image ${img.name} failed:`, err);
            }
          })()
        );
      }
    }

    await Promise.all(tasks);

    if (newSources.length === 0) {
      return new Response(
        JSON.stringify({ error: "No new content could be extracted from the supplied sources" }),
        { status: 400 }
      );
    }

    // Build the combined corpus — priors first (anchors the existing
    // narrative shape), new sources called out so the LLM knows what
    // to weave in.
    const corpus: string[] = [];
    if (cachedPriorSources.length > 0) {
      corpus.push("## EXISTING SOURCES (original narrative was built from these)\n");
      for (const s of cachedPriorSources) {
        corpus.push(`### ${s.type === "pdf" ? "PDF" : s.type === "image" ? "IMAGE" : "URL"}: ${s.key}\n${s.content}`);
      }
    }
    corpus.push("\n## NEW SOURCES (added now — weave these in)\n");
    for (const s of newSources) {
      corpus.push(`### ${s.type === "pdf" ? "PDF" : "URL"}: ${s.key}\n${s.content}`);
    }
    const combined = corpus.join("\n\n---\n\n");

    const MAX_CONTEXT_CHARS = 120_000;
    const trimmedContext = combined.length > MAX_CONTEXT_CHARS
      ? combined.substring(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated...]"
      : combined;

    const allSourceUrls = [
      ...cachedPriorSources.filter((s) => s.type === "url").map((s) => s.key),
      ...newSources.filter((s) => s.type === "url").map((s) => s.key),
    ];
    const allPdfNames = [
      ...cachedPriorSources.filter((s) => s.type === "pdf").map((s) => s.key),
      ...newSources.filter((s) => s.type === "pdf").map((s) => s.key),
    ];
    const allImageNames = [
      ...cachedPriorSources.filter((s) => s.type === "image").map((s) => s.key),
      ...newSources.filter((s) => s.type === "image").map((s) => s.key),
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

        try {
          // Carries: parentVersionId for the eventual generate call,
          // plus combined source inventory + the freshly-extracted
          // text for new sources. The client merges this with what
          // came from the original prefill (it already has those).
          send("sources", {
            parentVersionId,
            sourceUrls: allSourceUrls,
            sourcePdfNames: allPdfNames,
            sourceImageNames: allImageNames,
            extractedSources: newSources,
          });

          const promises = questions.map(async (q) => {
            const help = q.helpText ? `\nHint: ${q.helpText}` : "";
            const prompt = `You are helping a founder evolve their sales narrative based on new source material. The existing context (older sources) is followed by NEW sources just added. Answer the question by leaning on the NEW sources where they add detail, but stay consistent with what the existing sources already established.\n\n## Question\n${q.question}${help}\n\n## Context\n${trimmedContext}\n\nRespond with a JSON object: {"answer": "..."}. Keep the answer concise and grounded in the sources. If neither old nor new sources address the question, respond with {"answer": ""}.`;
            try {
              const completion = await openai.chat.completions.create({
                model: "gpt-5.5",
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" },
              });
              const raw = completion.choices[0]?.message?.content?.trim() || "";
              try {
                const parsed = JSON.parse(raw);
                const answer = typeof parsed.answer === "string" ? parsed.answer : "";
                send("answer", { questionId: q.id, answer });
              } catch {
                send("answer", { questionId: q.id, answer: "" });
              }
            } catch (err) {
              console.error(`[ExtendStream] question ${q.id} failed:`, err);
              send("answer", { questionId: q.id, answer: "" });
            }
          });
          await Promise.all(promises);
          send("done", { ok: true });
        } catch (err) {
          console.error("[ExtendStream] stream error:", err);
          send("error", { error: err instanceof Error ? err.message : "extend failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[ExtendStream] setup failed:", err);
    return new Response(JSON.stringify({ error: "extend failed" }), { status: 500 });
  }
}
