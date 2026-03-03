import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseSearchInput } from "@/lib/search/input-parser";
import { generateSearchPlan } from "@/lib/search/queries";
import { executeSearchPlan } from "@/lib/search/results";
import { synthesizeResearchBrief } from "@/lib/search/synthesis";
import type { SearchInput } from "@/lib/search/types";

// Allow up to 120s for search + AI synthesis
export const maxDuration = 120;

// POST - Run pre-call research with SSE streaming progress updates
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const { companyName, contactName, contactTitle, freeformText, urls } = body;

    if (!companyName && !freeformText) {
      return new Response(
        JSON.stringify({ error: "Company name or freeform text is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const searchInput: SearchInput = {
      freeformText,
      companyName,
      contactName,
      contactTitle,
      urls: urls || [],
    };

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function sendEvent(event: string, data: unknown) {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        }

        try {
          // Stage 1: Parse input
          sendEvent("progress", {
            stage: "parsing",
            message: "Analyzing your research request...",
            progress: 10,
          });

          const parsedInput = await parseSearchInput(searchInput);

          sendEvent("progress", {
            stage: "parsing",
            message: `Researching ${parsedInput.companyName}${parsedInput.contactName ? ` and ${parsedInput.contactName}` : ""}...`,
            progress: 15,
          });

          // Stage 2: Generate search plan
          sendEvent("progress", {
            stage: "planning",
            message: "Planning search queries...",
            progress: 20,
          });

          const plan = generateSearchPlan(parsedInput);

          sendEvent("progress", {
            stage: "planning",
            message: `Running ${plan.queries.length} searches and fetching ${plan.directFetches.length} pages...`,
            progress: 25,
          });

          // Stage 3: Execute searches
          const results = await executeSearchPlan(plan, (update) => {
            sendEvent("progress", update);
          });

          sendEvent("progress", {
            stage: "searching",
            message: `Found ${results.totalResults} results. Generating brief...`,
            progress: 75,
          });

          // Stage 4: Synthesize research brief
          const brief = await synthesizeResearchBrief(results, (update) => {
            sendEvent("progress", update);
          });

          // Stage 5: Save to database
          const research = await prisma.preCallResearch.create({
            data: {
              userId: user.id,
              companyName: parsedInput.companyName,
              contactName: parsedInput.contactName,
              contactTitle: parsedInput.contactTitle,
              freeformInput: freeformText || companyName,
              content: brief.content,
              sources: brief.sources,
              source: "web",
            },
          });

          sendEvent("complete", {
            id: research.id,
            companyName: brief.companyName,
            contactName: brief.contactName,
            content: brief.content,
            sources: brief.sources,
            createdAt: research.createdAt,
          });
        } catch (error) {
          console.error("[Research] Error:", error);
          sendEvent("error", {
            message: error instanceof Error ? error.message : "Research failed. Please try again.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Research] Error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to start research" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
