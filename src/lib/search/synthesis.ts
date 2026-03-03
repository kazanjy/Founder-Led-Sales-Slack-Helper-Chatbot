import { openai } from "@/lib/openai";
import type { SearchResults, ResearchBrief, SearchProgressCallback } from "./types";
import { formatResultsForSynthesis } from "./results";

/**
 * Synthesize search results into a structured research brief
 * using OpenAI directly (bypasses Chatbase's 8K char limit).
 */
export async function synthesizeResearchBrief(
  results: SearchResults,
  onProgress?: SearchProgressCallback
): Promise<ResearchBrief> {
  onProgress?.({
    stage: "synthesizing",
    message: "Generating research brief...",
    progress: 80,
  });

  const formattedResults = formatResultsForSynthesis(results);
  const { parsedInput } = results;

  const contactSection = parsedInput.contactName
    ? `\n\n## CONTACT TO RESEARCH\n- Name: ${parsedInput.contactName}\n- Title: ${parsedInput.contactTitle || "Unknown"}\n- LinkedIn: ${parsedInput.contactLinkedIn || "Not provided"}`
    : "";

  const systemPrompt = `You are a sales research analyst preparing a pre-call intelligence brief for a founder's upcoming sales call.

## BRIEF STRUCTURE

Generate the brief in this exact structure:

### Company Snapshot
- What the company does (1-2 sentences)
- Industry, stage, size
- Funding history and key investors
- Key products/services
- Recent news or milestones

### Key People${parsedInput.contactName ? `\n#### ${parsedInput.contactName}` : ""}
- Role and likely responsibilities
- Professional background and career trajectory
- Published thoughts, interviews, or social media activity
- Communication style indicators (formal/casual, technical/business, etc.)
- Connection points (shared interests, mutual connections, common experiences)

### Business Context
- Current challenges or pain points (inferred from news, job postings, industry trends)
- Technology stack or current solutions (if discoverable)
- Growth trajectory and strategic direction
- Competitive pressures

### Competitive Landscape
- Known competitors
- How the company differentiates
- Market position

### Conversation Starters
- 3-5 specific talking points based on recent news, their content, or shared interests
- Questions that demonstrate you've done your homework
- Topics to avoid (controversies, sensitive areas)

### Red Flags & Risks
- Any potential dealbreakers or concerns
- Signs this might not be a good fit
- Areas where information is missing (flag for discovery on the call)

### Sources
- List all URLs used with brief descriptions

Make the brief specific and actionable. Avoid generic advice. Every point should be grounded in the actual search results provided.

If information for a section is not available from the search results, say "Not found in research — ask on the call" rather than making things up.

DO NOT wrap the output in code blocks.`;

  const userPrompt = `Synthesize the search results below into a comprehensive, actionable research brief for a sales call with ${parsedInput.companyName}${parsedInput.contactName ? ` (specifically with ${parsedInput.contactName})` : ""}.

## COMPANY TO RESEARCH
- Company: ${parsedInput.companyName}
- Domain: ${parsedInput.companyDomain || "Unknown"}
- Industry: ${parsedInput.industry || "Unknown"}${contactSection}
${parsedInput.additionalContext ? `\n## ADDITIONAL CONTEXT\n${parsedInput.additionalContext}` : ""}

## SEARCH RESULTS

${formattedResults}

---

Now generate the research brief.`;

  console.log(`[Synthesis] Prompt size: system=${systemPrompt.length}, user=${userPrompt.length}, total=${systemPrompt.length + userPrompt.length} chars`);

  let aiResponse = "";
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
    });

    aiResponse = response.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("[Synthesis] OpenAI error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to synthesize research brief: ${message}`);
  }

  // Clean up response
  let content = aiResponse.trim();
  if (content.startsWith("```markdown")) {
    content = content.slice(11);
  } else if (content.startsWith("```")) {
    content = content.slice(3);
  }
  if (content.endsWith("```")) {
    content = content.slice(0, -3);
  }
  content = content.trim();

  // Extract sources from search results
  const sources: { title: string; url: string }[] = [];
  const seenUrls = new Set<string>();

  for (const searchResponse of results.searchResults) {
    for (const result of searchResponse.results) {
      if (!seenUrls.has(result.url)) {
        seenUrls.add(result.url);
        sources.push({ title: result.title, url: result.url });
      }
    }
  }
  for (const page of results.fetchedPages) {
    if (page.success && !seenUrls.has(page.url)) {
      seenUrls.add(page.url);
      sources.push({ title: page.title || page.url, url: page.url });
    }
  }

  onProgress?.({
    stage: "complete",
    message: "Research brief complete",
    progress: 100,
  });

  return {
    companyName: parsedInput.companyName,
    contactName: parsedInput.contactName,
    content,
    sources,
    generatedAt: new Date(),
  };
}
