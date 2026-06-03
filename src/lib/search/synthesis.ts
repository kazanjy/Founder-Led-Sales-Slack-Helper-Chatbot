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
  userId?: string,
  // Optional follow-up context block (markdown) and a flag telling
  // the LLM the call should be framed as a follow-up. When present
  // we add a Follow-Up Recap section to the brief and tell the
  // model to ground its recommendations in the prior conversation
  // history.
  followUp?: { isFollowUp: boolean; contextBlock: string } | null
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
  const isFollowUp = !!followUp?.isFollowUp;

  const formattedResults = formatResultsForSynthesis(results);
  const { parsedInput } = results;

  // When follow-up mode is on, the brief leads with a Follow-Up
  // Recap section that distills the prior history into "what's the
  // state of the conversation" / "what's open" / "what to do next".
  const followUpSection = isFollowUp
    ? `
### Follow-Up Recap
This is a **follow-up call**, not a first call. Ground this section in the FOLLOW-UP CONTEXT block at the bottom of the user message (prior calendar history + recorded-call transcripts where available).

#### State of the conversation
- Where they are in the sales process based on the prior interactions.
- Topics, objections, and themes that have come up so far.
- Any value props, demos, or proof points already shown — don't repeat them, build on them.

#### Recent interactions
- 2-4 specific bullets from the most recent prior call(s): what was discussed, what they said, what changed.
- Quote sparingly; summarize crisply. Always date-stamp ("On May 14, they said …").

#### Open threads
- Anything you committed to send, follow up on, or get an answer to.
- Anything they committed to do before this call (decision, intro, sample data, etc.).
- Flag if any of those are still outstanding.

#### Recommended next steps for THIS meeting
- The single most important goal for this specific call given where the conversation is.
- 2-3 concrete agenda items tailored to the open threads above.
- One probing question that moves the deal forward (not generic discovery).
`
    : "";

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

### TL;DR — Executive Summary
A concise 3-5 sentence executive summary at the very top of the brief. It should tell the reader at a glance:
- Who the person is (name, title, what they do) and which human persona they most closely match${hasSalesContext ? " (from the seller's playbook)" : ""}
- What the company is (name, what they do, stage/size) and which organizational persona they most closely match${hasSalesContext ? " (from the seller's playbook)" : ""}
- The 1-2 most important things to know going into this call — what they likely care about, what to lead with, and any key risk or opportunity
This should be punchy, specific, and immediately useful — not generic filler. A founder should be able to read ONLY this section 5 minutes before the call and walk in prepared.${isFollowUp ? `

**IMPORTANT — Follow-up call:** lead the TL;DR with the relationship status ("This is the 3rd meeting; we last met May 14 to discuss …"). Don't pretend it's a first conversation.` : ""}
${followUpSection}
### Company Snapshot
- What the company does (1-2 sentences)
- Industry, stage, size
- Funding history and key investors
- Key products/services
- Recent news or milestones

### Key People${parsedInput.contactName ? `\n#### ${parsedInput.contactName}` : ""}
- Role and likely responsibilities
- Professional background and career trajectory
- Connection points (shared interests, mutual connections, common experiences)

### Business Context
- Current challenges or pain points (inferred from news, industry trends, and other signals)
- Technology stack or current solutions (if discoverable from skills data or other signals)
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

### Sources
- List all URLs used with brief descriptions
- Always include "People Data Labs (PDL) — person and company enrichment" as a source when PDL data was used

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
${followUp?.contextBlock ? `\n${followUp.contextBlock}\n` : ""}
---

Now generate the research brief.`;

  console.log(`[Synthesis] Prompt size: system=${systemPrompt.length}, user=${userPrompt.length}, total=${systemPrompt.length + userPrompt.length} chars`);

  let aiResponse = "";
  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      stream: true,
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) {
        aiResponse += token;
        // Stream content chunks through the progress callback
        onProgress?.({
          stage: "content_chunk",
          message: token,
          progress: 85,
        });
      }
    }
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

  // Disclose People Data Labs as a data source when PDL data was used
  if (results.pdlData) {
    sources.push({
      title: "People Data Labs (PDL) — person and company enrichment",
      url: "https://www.peopledatalabs.com",
    });
  }

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
