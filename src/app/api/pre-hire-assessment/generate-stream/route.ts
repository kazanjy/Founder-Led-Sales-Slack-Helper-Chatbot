import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export const maxDuration = 180;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const { roleType } = await request.json();

    if (!roleType || !["ae", "sdr"].includes(roleType)) {
      return new Response(JSON.stringify({ error: "roleType must be 'ae' or 'sdr'" }), { status: 400 });
    }

    // Gather context: Sales Narrative
    const salesNarrative = await prisma.salesNarrativeVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!salesNarrative) {
      return new Response(
        JSON.stringify({ error: "No Sales Narrative found. Please generate a Sales Narrative first." }),
        { status: 400 }
      );
    }

    // Gather context: ICP
    const icpVersion = await prisma.icpVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!icpVersion) {
      return new Response(
        JSON.stringify({ error: "No ICP found. Please generate an Ideal Customer Profile first." }),
        { status: 400 }
      );
    }

    // Parse ICP content (JSON stringified)
    let icpContent = "";
    try {
      const parsed = JSON.parse(icpVersion.content);
      if (parsed.sections && Array.isArray(parsed.sections)) {
        icpContent = parsed.sections
          .map((s: { title?: string; content?: string }) => `### ${s.title}\n${s.content}`)
          .join("\n\n");
      } else {
        icpContent = icpVersion.content;
      }
    } catch {
      icpContent = icpVersion.content;
    }

    // For AE: Load latest hiring profile
    let hiringProfileContent = "";
    if (roleType === "ae") {
      const hiringProfile = await prisma.hiringProfileVersion.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      if (hiringProfile) {
        hiringProfileContent = hiringProfile.content;
      }
    }

    // Build the prompt
    const roleLabel = roleType === "ae" ? "Account Executive (AE)" : "Sales Development Representative (SDR)";

    const sectionsForAE = `
## SECTIONS TO GENERATE (4 sections):

### Section 1: Sales Motion Fit Questionnaire
Generate 8-12 qualification questions about the candidate's experience with this company's specific sales motion. Questions should probe:
- Experience with the deal size range and sales cycle length
- Familiarity with the buyer persona and decision-making process
- Experience in the industry vertical or adjacent verticals
- Track record with the selling approach (consultative, transactional, enterprise, etc.)
- Experience with the tech stack, tools, and methodologies mentioned
- Quota attainment history relevant to this motion

Base these questions directly on the hiring profile and sales narrative details.

### Section 2: Written Intake Questionnaire
Generate 12-15 personality, thinking, and culture-fit questions. Include questions like:
- Tell me about something you've built from scratch (doesn't have to be work-related)
- How do you organize your week? Walk me through a typical Monday morning
- Tell me about a deal that went really well — what made it work?
- Tell me about a deal that went terribly — what happened and what did you learn?
- What do you like about working at startups vs. larger companies?
- What's the most creative thing you've done to get a prospect's attention?
- How do you handle rejection or a string of losses?
- What does your ideal manager look like?
- What are you optimizing for in your next role?
- Describe a time you had to learn something complex quickly — how did you approach it?

Customize these for the specific company context but keep the personal/reflective tone.

### Section 3: Video Recording Prompt
Provide clear instructions for a 2-5 minute self-recorded video covering:
- Who you are and your background
- Relevant sales experience
- Your personality and what drives you
- Why you're interested in this specific role/company

Include tips on format (casual is fine, no need for production quality) and what you're evaluating.

### Section 4: Prospecting Exercise
Design a hands-on prospecting exercise with three parts:

**Part A — Account Identification:** Ask the candidate to find 5 target accounts that match the company's ICP. Provide the specific ICP criteria they should use (company size, industry, geography, technology signals, etc.) drawn from the ICP data above.

**Part B — Contact Identification:** From 3 of the 5 accounts, ask the candidate to identify 5 contacts per account that match the target buyer persona. Specify the titles, seniority levels, and departments to target based on the ICP.

**Part C — Messaging Sequence:** For 2 of the contacts, create a 3-touch outbound sequence:
1. Initial email (personalized cold outreach)
2. Follow-up phone call (leave a voicemail script)
3. Follow-up email (different angle/value prop)

Customize with the company name, product/service description, ICP criteria, target personas, and example customers from the narrative and ICP data.`;

    const sectionsForSDR = `
## SECTIONS TO GENERATE (3 sections):

### Section 1: Written Intake Questionnaire
Generate 12-15 personality, thinking, and culture-fit questions. Include questions like:
- Tell me about something you've built from scratch (doesn't have to be work-related)
- How do you organize your week? Walk me through a typical Monday morning
- Tell me about a time you had to be persistent to achieve something — what was the situation?
- What do you like about working at startups vs. larger companies?
- What's the most creative thing you've done to get someone's attention?
- How do you handle rejection or a string of "no"s?
- What does your ideal manager look like?
- What are you optimizing for in your next role?
- Describe a time you had to learn something complex quickly — how did you approach it?
- What interests you about sales as a career?
- Tell me about a time you exceeded a goal — what drove you?

Customize these for the specific company context but keep the personal/reflective tone.

### Section 2: Video Recording Prompt
Provide clear instructions for a 2-5 minute self-recorded video covering:
- Who you are and your background
- Why you're interested in sales and this specific role
- Your personality and what drives you
- What you know about the company and why it excites you

Include tips on format (casual is fine, no need for production quality) and what you're evaluating.

### Section 3: Prospecting Exercise
Design a hands-on prospecting exercise with three parts:

**Part A — Account Identification:** Ask the candidate to find 5 target accounts that match the company's ICP. Provide the specific ICP criteria they should use (company size, industry, geography, technology signals, etc.) drawn from the ICP data above.

**Part B — Contact Identification:** From 3 of the 5 accounts, ask the candidate to identify 5 contacts per account that match the target buyer persona. Specify the titles, seniority levels, and departments to target based on the ICP.

**Part C — Messaging Sequence:** For 2 of the contacts, create a 3-touch outbound sequence:
1. Initial email (personalized cold outreach)
2. Follow-up phone call (leave a voicemail script)
3. Follow-up email (different angle/value prop)

Customize with the company name, product/service description, ICP criteria, target personas, and example customers from the narrative and ICP data.`;

    const hiringProfileSection = hiringProfileContent
      ? `\n## AE HIRING PROFILE:\n\n${hiringProfileContent}\n`
      : "";

    const prompt = `You are an expert sales hiring consultant helping a founder create a take-home assessment for ${roleLabel} candidates.

## COMPANY SALES NARRATIVE:

${salesNarrative.narrative}

## IDEAL CUSTOMER PROFILE (ICP):

${icpContent}
${hiringProfileSection}
---

Generate a comprehensive pre-hire take-home assessment document in Markdown for a ${roleLabel} candidate.

Start with an introductory paragraph explaining:
- The purpose of this assessment (to understand the candidate's experience, thinking, and approach)
- Expected time commitment (approximately 60-90 minutes total)
- That there are no trick questions — you want to see how they think, communicate, and approach real work
- They should be themselves and be honest

Then generate the following sections:
${roleType === "ae" ? sectionsForAE : sectionsForSDR}

## FORMATTING GUIDELINES:
- Use ## for main section headings
- Use numbered lists for questions
- Use bold for sub-section headers within the prospecting exercise
- Be specific to this company — use the company name, product details, ICP criteria, and target personas throughout
- Make it feel professional but approachable
- Each section should have a brief intro explaining what you're looking for

Output ONLY the markdown document, no JSON wrapping.`;

    // Set up SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          const llmStream = await openai.chat.completions.create({
            model: "gpt-5.5",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            stream: true,
          });

          let fullContent = "";
          for await (const chunk of llmStream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
              fullContent += token;
              send("token", { token });
            }
          }

          // Generate a title
          const titleRes = await openai.chat.completions.create({
            model: "gpt-5.5",
            messages: [
              {
                role: "user",
                content: `Based on this pre-hire assessment, generate a short title in the format "${roleType === "ae" ? "AE" : "SDR"} Pre-Hire Assessment - [brief descriptor]". Respond with ONLY the title.\n\n${fullContent.substring(0, 2000)}`,
              },
            ],
            temperature: 0.5,
          });
          const title = (titleRes.choices[0]?.message?.content || `${roleType === "ae" ? "AE" : "SDR"} Pre-Hire Assessment`).trim();

          // Save to database
          const version = await prisma.preHireAssessmentVersion.create({
            data: {
              userId: user.id,
              title,
              roleType,
              content: fullContent,
            },
          });

          send("complete", { versionId: version.id, title });
        } catch (error) {
          console.error("[pre-hire-assessment/generate-stream] Error:", error);
          send("error", { message: error instanceof Error ? error.message : "Generation failed" });
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
    console.error("[pre-hire-assessment/generate-stream] Setup error:", error);
    return new Response(JSON.stringify({ error: "Failed to start generation" }), { status: 500 });
  }
}
