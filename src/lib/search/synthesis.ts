import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import type { SearchResults, ResearchBrief, SearchProgressCallback } from "./types";
import { formatResultsForSynthesis } from "./results";

/**
 * Fetch the user's sales playbook context (Sales Narrative, First Call Checklist,
 * Pre-Call Planning) from the database. Returns null for any that don't exist yet.
 */
async function fetchSalesContext(userId: string) {
  const [narrativeVar, checklistVar, planningVar] = await Promise.all([
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "SALES_NARRATIVE" },
      select: { value: true },
    }),
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "FIRST_CALL_CHECKLIST" },
      select: { value: true },
    }),
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "PRE_CALL_PLANNING" },
      select: { value: true },
    }),
  ]);

  return {
    salesNarrative: narrativeVar?.value || null,
    firstCallChecklist: checklistVar?.value || null,
    preCallPlanning: planningVar?.value || null,
  };
}

/**
 * Synthesize search results into a structured research brief
 * using OpenAI directly (bypasses Chatbase's 8K char limit).
 */
export async function synthesizeResearchBrief(
  results: SearchResults,
  onProgress?: SearchProgressCallback,
  userId?: string
): Promise<ResearchBrief> {
  onProgress?.({
    stage: "synthesizing",
    message: "Generating research brief...",
    progress: 80,
  });

  // Fetch user's sales playbook context if userId is available
  let salesContext: { salesNarrative: string | null; firstCallChecklist: string | null; preCallPlanning: string | null } = {
    salesNarrative: null,
    firstCallChecklist: null,
    preCallPlanning: null,
  };

  if (userId) {
    try {
      salesContext = await fetchSalesContext(userId);
      const available = [
        salesContext.salesNarrative ? "Sales Narrative" : null,
        salesContext.firstCallChecklist ? "First Call Checklist" : null,
        salesContext.preCallPlanning ? "Pre-Call Planning" : null,
      ].filter(Boolean);
      console.log(`[Synthesis] Sales context loaded for user ${userId}: ${available.length > 0 ? available.join(", ") : "none available"}`);
    } catch (error) {
      console.warn("[Synthesis] Failed to fetch sales context, proceeding without it:", error);
    }
  }

  const hasSalesContext = salesContext.salesNarrative || salesContext.firstCallChecklist || salesContext.preCallPlanning;

  const formattedResults = formatResultsForSynthesis(results);
  const { parsedInput } = results;

  const contactSection = parsedInput.contactName
    ? `\n\n## CONTACT TO RESEARCH\n- Name: ${parsedInput.contactName}\n- Title: ${parsedInput.contactTitle || "Unknown"}\n- LinkedIn: ${parsedInput.contactLinkedIn || "Not provided"}`
    : "";

  // Build the persona matching and POV sections only if sales context is available
  const personaAndPovSections = hasSalesContext
    ? `
### Persona Match
#### Individual Persona
- Based on the contact's role, title, seniority, and responsibilities, match them to the closest **individual/human persona** defined in the seller's First Call Checklist (see YOUR SALES PLAYBOOK CONTEXT below).
- State which persona they match and explain WHY (what signals from the research led to this match).
- Note any ways they differ from the standard persona.

#### Organizational Persona
- Based on the company's size, stage, industry, and business model, match the organization to the closest **organizational persona** defined in the seller's First Call Checklist.
- State which persona they match and explain WHY.
- Note any ways they differ from the standard persona.

### Point of View — What They Likely Care About
- Based on the persona matches above AND the research findings, form a specific point of view about what this person and organization will most care about regarding our offering.
- Reference specific elements from the Sales Narrative that are most relevant to their situation.
- Identify which pain points from our narrative likely resonate most given their role, industry, and current challenges.
- Suggest 2-3 specific value propositions or proof points from our narrative to lead with.
- Flag any areas where our offering may NOT be a fit or where you need to discover more on the call.

### Recommended Call Focus
- Based on the persona match and point of view above, recommend what to focus on during the call.
- Suggest which discovery questions from the Pre-Call Planning process are most important to ask THIS specific prospect.
- Recommend an opening angle that connects their world to our solution.
- Note any objections to prepare for based on their likely perspective.
`
    : "";

  const systemPrompt = `You are a sales research analyst preparing a pre-call intelligence brief for a founder's upcoming sales call.
${hasSalesContext ? `
IMPORTANT: You have access to the seller's own Sales Narrative, First Call Checklist (which includes their defined personas), and Pre-Call Planning process. Use these to make the brief deeply personalized — not just about the prospect, but about how the prospect connects to what the seller offers. Your job is to bridge the gap between "who they are" and "why they should care about us."
` : ""}
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
${personaAndPovSections}
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
${hasSalesContext ? `
For the Persona Match, Point of View, and Recommended Call Focus sections: ground your analysis in BOTH the search results AND the seller's sales playbook context. Be specific — name the exact persona, reference specific narrative elements, and tie recommendations to concrete research findings.
` : ""}
If information for a section is not available from the search results, say "Not found in research — ask on the call" rather than making things up.

DO NOT wrap the output in code blocks.`;

  // Build the sales playbook context block for the user prompt
  let salesPlaybookBlock = "";
  if (hasSalesContext) {
    salesPlaybookBlock = "\n\n## YOUR SALES PLAYBOOK CONTEXT\nUse the following to match personas and form your point of view:\n";

    if (salesContext.salesNarrative) {
      salesPlaybookBlock += `\n### Sales Narrative\n${salesContext.salesNarrative}\n`;
    }
    if (salesContext.firstCallChecklist) {
      salesPlaybookBlock += `\n### First Call Checklist (includes persona definitions)\n${salesContext.firstCallChecklist}\n`;
    }
    if (salesContext.preCallPlanning) {
      salesPlaybookBlock += `\n### Pre-Call Planning Process\n${salesContext.preCallPlanning}\n`;
    }
  }

  const userPrompt = `Synthesize the search results below into a comprehensive, actionable research brief for a sales call with ${parsedInput.companyName}${parsedInput.contactName ? ` (specifically with ${parsedInput.contactName})` : ""}.

## COMPANY TO RESEARCH
- Company: ${parsedInput.companyName}
- Domain: ${parsedInput.companyDomain || "Unknown"}
- Industry: ${parsedInput.industry || "Unknown"}${contactSection}
${parsedInput.additionalContext ? `\n## ADDITIONAL CONTEXT\n${parsedInput.additionalContext}` : ""}

## SEARCH RESULTS

${formattedResults}
${salesPlaybookBlock}
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

  // Combine system + user prompt as the full search context
  const searchContext = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  return {
    companyName: parsedInput.companyName,
    contactName: parsedInput.contactName,
    content,
    searchContext,
    sources,
    generatedAt: new Date(),
  };
}
