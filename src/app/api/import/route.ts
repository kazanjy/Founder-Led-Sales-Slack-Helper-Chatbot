import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { extractTextFromPDFWithOCR } from "@/lib/pdf-server";

// Allow up to 120s for AI synthesis
export const maxDuration = 120;

type AppletType = "discoveryQuestions" | "firstCallChecklist" | "preCallPlanning";

const APPLET_CONFIGS: Record<
  AppletType,
  {
    label: string;
    mergeField: string;
    mergeLabel: string;
  }
> = {
  discoveryQuestions: {
    label: "Discovery Questions",
    mergeField: "DISCOVERY_QUESTIONS",
    mergeLabel: "Discovery Questions",
  },
  firstCallChecklist: {
    label: "First Call Checklist",
    mergeField: "FIRST_CALL_CHECKLIST",
    mergeLabel: "First Call Checklist",
  },
  preCallPlanning: {
    label: "Pre-Call Checklist",
    mergeField: "PRE_CALL_PLANNING",
    mergeLabel: "Pre-Call Planning",
  },
};

function getDiscoveryQuestionsPrompt(inputText: string): string {
  return `You are an expert B2B sales coach. The user has provided their own discovery questions document. Your job is to parse and restructure it into a specific JSON format, preserving the user's original questions as faithfully as possible.

## INPUT (user's existing discovery questions):

${inputText}

## INSTRUCTIONS:

1. Read through the user's content carefully
2. Organize the questions into these 5 categories (map the user's questions to the best-fit category):
   - **Problem Discovery** - Questions about uncovering the prospect's problem, severity, business impact
   - **Current State** - Questions about how they handle things today, solutions tried, why those fail
   - **Impact & Urgency** - Questions about costs (time, money, opportunity), timeline, urgency
   - **Decision Process** - Questions about who's involved, budget, evaluation criteria
   - **Fit Qualification** - Questions about whether the prospect is a good fit
3. For each question, identify the primary question and any follow-ups
4. If the user's content doesn't clearly map to all 5 categories, do your best to distribute appropriately
5. Preserve the user's original wording as much as possible — do NOT rewrite their questions

## OUTPUT FORMAT (respond with ONLY valid JSON, no markdown):

{
  "categories": [
    {
      "name": "Category Name",
      "description": "Brief description of this category's purpose",
      "questions": [
        {
          "primary": "The main question",
          "followUps": ["Follow-up 1", "Follow-up 2"]
        }
      ]
    }
  ]
}`;
}

function getFirstCallChecklistPrompt(inputText: string): string {
  return `You are an expert B2B sales coach. The user has provided their own first call checklist / playbook document. Your job is to restructure it into a well-organized markdown document, preserving their content as faithfully as possible.

## INPUT (user's existing first call checklist / playbook):

${inputText}

## INSTRUCTIONS:

1. Read through the user's content carefully
2. Restructure it into these sections (include what the user provided, mapping to the best-fit section):
   - **Persona Reference Library** - Any persona profiles, org-level and individual-level
   - **Pre-Call Planning Process** - Research steps, preparation checklist
   - **Rapport & Introduction** - Icebreakers, intro script, agenda setting
   - **Discovery Section** - Must-ask questions, question flow, probing techniques
   - **Opportunity Evaluation** - Qualification criteria, closing language, next steps
3. If the user's content has sections that don't map cleanly, use your best judgment
4. Preserve the user's original wording and specific examples as much as possible
5. Use proper markdown formatting (headers, bullet points, tables where appropriate)

## OUTPUT:

Return ONLY the markdown content (no code blocks wrapping it). Start with a level-1 heading.`;
}

function getPreCallPlanningPrompt(inputText: string): string {
  return `You are an expert B2B sales coach. The user has provided their own pre-call planning / preparation document. Your job is to restructure it into a well-organized markdown document, preserving their content as faithfully as possible.

## INPUT (user's existing pre-call planning document):

${inputText}

## INSTRUCTIONS:

1. Read through the user's content carefully
2. Restructure it into these sections (include what the user provided, mapping to the best-fit section):
   - **Research Framework** - How to research prospects before calls
   - **Prospect Intelligence Template** - Fill-in template for capturing prospect info
   - **Persona Matching Process** - How to identify and match personas
   - **Call Objective Setting** - How to set call goals
   - **Opening Strategy Preparation** - How to prepare the opening
   - **Question Sequencing Plan** - Order and flow of questions
   - **Objection Preparation** - Common objections and responses
   - **Logistics & Environment Checklist** - Technical/logistical prep
   - **Post-Call Protocol** - Follow-up process
3. If the user's content doesn't cover all sections, only include what they provided
4. Preserve the user's original wording and specific examples as much as possible
5. Use proper markdown formatting (headers, bullet points, tables where appropriate)

## OUTPUT:

Return ONLY the markdown content (no code blocks wrapping it). Start with a level-1 heading.`;
}

// POST - Import user's own content for any of the 3 applets
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";

    let appletType: AppletType;
    let inputText: string;

    if (contentType.includes("multipart/form-data")) {
      // PDF upload
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const type = formData.get("appletType") as string;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      if (!type || !(type in APPLET_CONFIGS)) {
        return NextResponse.json({ error: "Invalid applet type" }, { status: 400 });
      }

      appletType = type as AppletType;

      // Extract text from PDF
      const buffer = Buffer.from(await file.arrayBuffer());
      const { result } = await extractTextFromPDFWithOCR(buffer, file.name, 30);
      inputText = result.fullText;

      if (!inputText || inputText.trim().length < 50) {
        return NextResponse.json(
          { error: "Could not extract enough text from the PDF. Please try pasting the content instead." },
          { status: 400 },
        );
      }
    } else {
      // JSON body with pasted text
      const body = await request.json();
      appletType = body.appletType;
      inputText = body.content;

      if (!appletType || !(appletType in APPLET_CONFIGS)) {
        return NextResponse.json({ error: "Invalid applet type" }, { status: 400 });
      }

      if (!inputText || inputText.trim().length < 50) {
        return NextResponse.json(
          { error: "Please provide more content (at least 50 characters)." },
          { status: 400 },
        );
      }
    }

    const config = APPLET_CONFIGS[appletType];

    // Truncate input to avoid token limits
    const truncatedInput = inputText.substring(0, 30000);

    // Build the appropriate prompt
    let prompt: string;
    let isJsonOutput = false;

    switch (appletType) {
      case "discoveryQuestions":
        prompt = getDiscoveryQuestionsPrompt(truncatedInput);
        isJsonOutput = true;
        break;
      case "firstCallChecklist":
        prompt = getFirstCallChecklistPrompt(truncatedInput);
        break;
      case "preCallPlanning":
        prompt = getPreCallPlanningPrompt(truncatedInput);
        break;
    }

    // Call GPT 5.2 for synthesis
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      ...(isJsonOutput ? { response_format: { type: "json_object" } } : {}),
    });

    const aiContent = response.choices[0]?.message?.content;
    if (!aiContent) {
      throw new Error("No response from AI");
    }

    // Save based on applet type
    let savedVersion: { id: string; createdAt: Date };
    let returnContent: unknown;

    switch (appletType) {
      case "discoveryQuestions": {
        // Parse JSON response
        const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error("Failed to parse AI response as JSON");
        }
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.categories || !Array.isArray(parsed.categories)) {
          throw new Error("Invalid response structure");
        }

        const version = await prisma.discoveryQuestionsVersion.create({
          data: {
            userId: user.id,
            content: JSON.stringify(parsed),
          },
        });

        // Update merge variable
        const mergeContent = formatDiscoveryQuestionsForMerge(parsed);
        await upsertMergeVariable(user.id, config.mergeField, config.mergeLabel, mergeContent);

        savedVersion = version;
        returnContent = parsed;
        break;
      }

      case "firstCallChecklist": {
        // Clean markdown
        const cleanContent = cleanMarkdownResponse(aiContent);

        const version = await prisma.firstCallChecklistVersion.create({
          data: {
            userId: user.id,
            content: cleanContent,
          },
        });

        await upsertMergeVariable(user.id, config.mergeField, config.mergeLabel, cleanContent);

        savedVersion = version;
        returnContent = cleanContent;
        break;
      }

      case "preCallPlanning": {
        const cleanContent = cleanMarkdownResponse(aiContent);

        const version = await prisma.preCallPlanningVersion.create({
          data: {
            userId: user.id,
            content: cleanContent,
          },
        });

        await upsertMergeVariable(user.id, config.mergeField, config.mergeLabel, cleanContent);

        savedVersion = version;
        returnContent = cleanContent;
        break;
      }
    }

    return NextResponse.json({
      success: true,
      version: {
        id: savedVersion.id,
        content: returnContent,
        createdAt: savedVersion.createdAt,
      },
    });
  } catch (error) {
    console.error("Error importing content:", error);
    return NextResponse.json(
      { error: "Failed to import and process your content. Please try again." },
      { status: 500 },
    );
  }
}

function cleanMarkdownResponse(content: string): string {
  let cleaned = content;
  // Remove wrapping code blocks if present
  cleaned = cleaned.replace(/^```(?:markdown|md)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/i, "");
  return cleaned.trim();
}

function formatDiscoveryQuestionsForMerge(data: {
  categories: Array<{
    name: string;
    description: string;
    questions: Array<{
      primary: string;
      followUps: string[];
    }>;
  }>;
}): string {
  let output = "";
  for (const category of data.categories) {
    output += `## ${category.name}\n\n`;
    for (let i = 0; i < category.questions.length; i++) {
      const q = category.questions[i];
      output += `${i + 1}. ${q.primary}\n`;
      if (q.followUps && q.followUps.length > 0) {
        for (const followUp of q.followUps) {
          output += `   - ${followUp}\n`;
        }
      }
      output += "\n";
    }
  }
  return output.trim();
}

async function upsertMergeVariable(userId: string, mergeField: string, name: string, value: string) {
  await prisma.gtmVariable.upsert({
    where: {
      userId_mergeField: {
        userId,
        mergeField,
      },
    },
    update: { value },
    create: {
      userId,
      mergeField,
      name,
      value,
      isDefault: false,
    },
  });
}
