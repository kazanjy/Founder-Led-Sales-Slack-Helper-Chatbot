import { NextRequest, NextResponse } from "next/server";
import type { SearchInput } from "@/lib/search/types";

// Force dynamic — never cache this route (prevents stale 405 from Vercel CDN)
export const dynamic = "force-dynamic";

// Allow up to 120s for search + AI synthesis
export const maxDuration = 120;

// GET - Diagnostic endpoint to verify route is deployed
export async function GET() {
  return NextResponse.json({
    status: "ok",
    route: "/api/pre-call-planning/research",
    methods: ["GET", "POST"],
    timestamp: new Date().toISOString(),
    version: "2024-03-03-v3",
  });
}

// POST - Run pre-call research with SSE streaming progress updates
export async function POST(request: NextRequest) {
  console.log("[Research] POST handler called");

  // Dynamically import all dependencies to prevent module-level failures
  let prisma, getCurrentUser, parseSearchInput, generateSearchPlan, executeSearchPlan, synthesizeResearchBrief;

  try {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;
    console.log("[Research] db loaded");
  } catch (e) {
    console.error("[Research] Failed to import @/lib/db:", e);
    return NextResponse.json({ error: "Internal error: db module" }, { status: 500 });
  }

  try {
    const authModule = await import("@/lib/auth");
    getCurrentUser = authModule.getCurrentUser;
    console.log("[Research] auth loaded");
  } catch (e) {
    console.error("[Research] Failed to import @/lib/auth:", e);
    return NextResponse.json({ error: "Internal error: auth module" }, { status: 500 });
  }

  try {
    const parserModule = await import("@/lib/search/input-parser");
    parseSearchInput = parserModule.parseSearchInput;
    console.log("[Research] input-parser loaded");
  } catch (e) {
    console.error("[Research] Failed to import @/lib/search/input-parser:", e);
    return NextResponse.json({ error: "Internal error: input-parser module" }, { status: 500 });
  }

  try {
    const queriesModule = await import("@/lib/search/queries");
    generateSearchPlan = queriesModule.generateSearchPlan;
    console.log("[Research] queries loaded");
  } catch (e) {
    console.error("[Research] Failed to import @/lib/search/queries:", e);
    return NextResponse.json({ error: "Internal error: queries module" }, { status: 500 });
  }

  try {
    const resultsModule = await import("@/lib/search/results");
    executeSearchPlan = resultsModule.executeSearchPlan;
    console.log("[Research] results loaded");
  } catch (e) {
    console.error("[Research] Failed to import @/lib/search/results:", e);
    return NextResponse.json({ error: "Internal error: results module" }, { status: 500 });
  }

  try {
    const synthesisModule = await import("@/lib/search/synthesis");
    synthesizeResearchBrief = synthesisModule.synthesizeResearchBrief;
    console.log("[Research] synthesis loaded");
  } catch (e) {
    console.error("[Research] Failed to import @/lib/search/synthesis:", e);
    return NextResponse.json({ error: "Internal error: synthesis module" }, { status: 500 });
  }

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
          }, user.id);

          // Stage 5: Save to database
          const research = await prisma.preCallResearch.create({
            data: {
              userId: user.id,
              companyName: parsedInput.companyName,
              contactName: parsedInput.contactName,
              contactTitle: parsedInput.contactTitle,
              freeformInput: freeformText || companyName,
              content: brief.content,
              searchContext: brief.searchContext,
              sources: brief.sources,
              source: "web",
            },
          });

          // Create a chat conversation so the user can continue discussing
          const { createResearchConversation } = await import("@/lib/search/research-conversation");
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
          const reportUrl = `${appUrl}/pre-call-planning/research?id=${research.id}`;
          const chatConversation = await createResearchConversation({
            userId: user.id,
            researchId: research.id,
            companyName: parsedInput.companyName,
            contactName: parsedInput.contactName,
            contactTitle: parsedInput.contactTitle,
            contactLinkedIn: parsedInput.contactLinkedIn,
            companyDomain: parsedInput.companyDomain,
            urls: searchInput.urls,
            briefContent: brief.content,
            reportUrl,
          });

          sendEvent("complete", {
            id: research.id,
            companyName: brief.companyName,
            contactName: brief.contactName,
            content: brief.content,
            sources: brief.sources,
            createdAt: research.createdAt,
            conversationId: chatConversation.id,
          });
        } catch (error) {
          console.error("[Research] Stream error:", error);
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
    console.error("[Research] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to start research",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
