import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { extractTextFromPDFWithOCR } from "@/lib/pdf-server";
import Papa from "papaparse";

// Allow up to 120s for AI synthesis
export const maxDuration = 120;

type AppletType = "discoveryQuestions" | "firstCallChecklist" | "preCallPlanning" | "salesNarrative" | "emailSequence" | "linkedInSequence";

const VALID_APPLET_TYPES = new Set<string>([
  "discoveryQuestions", "firstCallChecklist", "preCallPlanning",
  "salesNarrative", "emailSequence", "linkedInSequence",
]);

const MERGE_CONFIGS: Partial<Record<AppletType, { mergeField: string; mergeLabel: string }>> = {
  discoveryQuestions: { mergeField: "DISCOVERY_QUESTIONS", mergeLabel: "Discovery Questions" },
  firstCallChecklist: { mergeField: "FIRST_CALL_CHECKLIST", mergeLabel: "First Call Checklist" },
  preCallPlanning: { mergeField: "PRE_CALL_PLANNING", mergeLabel: "Pre-Call Planning" },
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

function getSalesNarrativePrompt(inputText: string): string {
  return `You are an expert B2B sales coach. The user has provided their own sales narrative / value proposition document. Your job is to parse it into a structured format with multiple output lengths.

## INPUT (user's existing sales narrative / value proposition):

${inputText}

## INSTRUCTIONS:

1. Read through the user's content carefully
2. Create a full sales narrative that preserves the user's messaging and value propositions
3. Create progressively shorter versions that capture the essence
4. Preserve the user's original wording, brand voice, and specific claims as much as possible

## OUTPUT FORMAT (respond with ONLY valid JSON, no markdown):

{
  "narrative": "The full sales narrative in markdown format. Preserve the user's content, organize with headers and bullet points.",
  "description100w": "A ~100-word product marketing summary capturing the key value proposition.",
  "description50w": "A ~50-word elevator pitch.",
  "description25w": "A ~25-word tagline/one-liner."
}`;
}

function getEmailSequencePrompt(inputText: string): string {
  return `You are an expert B2B sales coach. The user has provided their own email sequence / outreach document. Your job is to restructure it into a well-organized markdown document, preserving their content as faithfully as possible.

## INPUT (user's existing email sequence):

${inputText}

## INSTRUCTIONS:

1. Read through the user's content carefully
2. Organize the emails into a clear sequence format with proper markdown
3. Each email should have a clear subject line, body, and any notes
4. Preserve the user's original wording, tone, and specific messaging as much as possible
5. Use proper markdown formatting (headers, bullet points where appropriate)

## OUTPUT:

Return ONLY the markdown content (no code blocks wrapping it). Start with a level-1 heading.`;
}

function getLinkedInSequencePrompt(inputText: string): string {
  return `You are an expert B2B sales coach. The user has provided their own LinkedIn outreach sequence. Your job is to restructure it into a well-organized markdown document, preserving their content as faithfully as possible.

## INPUT (user's existing LinkedIn sequence):

${inputText}

## INSTRUCTIONS:

1. Read through the user's content carefully
2. Organize the messages into a clear sequence format with proper markdown
3. Each message should be clearly labeled (connection request, follow-up 1, etc.)
4. Preserve the user's original wording, tone, and specific messaging as much as possible
5. Use proper markdown formatting (headers, bullet points where appropriate)

## OUTPUT:

Return ONLY the markdown content (no code blocks wrapping it). Start with a level-1 heading.`;
}

// POST - Import user's own content
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";

    let appletType: AppletType;
    let inputText: string;
    let uploadedFileName: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      // File upload (PDF or CSV)
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const type = formData.get("appletType") as string;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      if (!type || !VALID_APPLET_TYPES.has(type)) {
        return NextResponse.json({ error: "Invalid applet type" }, { status: 400 });
      }

      appletType = type as AppletType;

      uploadedFileName = file.name;

      const isCSV = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";

      if (isCSV) {
        // Parse CSV and convert to readable text
        const csvText = await file.text();
        const parsed = Papa.parse<Record<string, string>>(csvText, {
          header: true,
          skipEmptyLines: true,
        });

        if (parsed.errors.length > 0 && parsed.data.length === 0) {
          return NextResponse.json(
            { error: "Could not parse the CSV file. Please check the format and try again." },
            { status: 400 },
          );
        }

        // Convert rows to readable text: "Column: Value" format separated by dividers
        inputText = parsed.data
          .map((row) =>
            Object.entries(row)
              .filter(([, val]) => val && val.trim())
              .map(([key, val]) => `${key}: ${val}`)
              .join("\n"),
          )
          .filter((block) => block.trim())
          .join("\n---\n");
      } else {
        // Extract text from PDF
        const buffer = Buffer.from(await file.arrayBuffer());
        const { result } = await extractTextFromPDFWithOCR(buffer, file.name, 30);
        inputText = result.fullText;
      }

      if (!inputText || inputText.trim().length < 50) {
        return NextResponse.json(
          { error: `Could not extract enough text from the ${isCSV ? "CSV" : "PDF"}. Please try pasting the content instead.` },
          { status: 400 },
        );
      }
    } else {
      // JSON body with pasted text
      const body = await request.json();
      appletType = body.appletType;
      inputText = body.content;

      if (!appletType || !VALID_APPLET_TYPES.has(appletType)) {
        return NextResponse.json({ error: "Invalid applet type" }, { status: 400 });
      }

      if (!inputText || inputText.trim().length < 50) {
        return NextResponse.json(
          { error: "Please provide more content (at least 50 characters)." },
          { status: 400 },
        );
      }
    }

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
      case "salesNarrative":
        prompt = getSalesNarrativePrompt(truncatedInput);
        isJsonOutput = true;
        break;
      case "emailSequence":
        prompt = getEmailSequencePrompt(truncatedInput);
        break;
      case "linkedInSequence":
        prompt = getLinkedInSequencePrompt(truncatedInput);
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
        const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Failed to parse AI response as JSON");
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.categories || !Array.isArray(parsed.categories)) throw new Error("Invalid response structure");

        const dqImportTitle = uploadedFileName ? `${uploadedFileName.replace(/\.(pdf|csv)$/i, "")} - Discovery Questions` : "Imported Discovery Questions";
        const version = await prisma.discoveryQuestionsVersion.create({
          data: { userId: user.id, title: dqImportTitle, content: JSON.stringify(parsed) },
        });

        const mergeContent = formatDiscoveryQuestionsForMerge(parsed);
        const mc = MERGE_CONFIGS[appletType]!;
        await upsertMergeVariable(user.id, mc.mergeField, mc.mergeLabel, mergeContent);

        savedVersion = version;
        returnContent = parsed;
        break;
      }

      case "firstCallChecklist": {
        const cleanContent = cleanMarkdownResponse(aiContent);
        const fccImportTitle = uploadedFileName ? `${uploadedFileName.replace(/\.(pdf|csv)$/i, "")} - First Call Checklist` : "Imported First Call Checklist";
        const version = await prisma.firstCallChecklistVersion.create({
          data: { userId: user.id, title: fccImportTitle, content: cleanContent },
        });
        const mc = MERGE_CONFIGS[appletType]!;
        await upsertMergeVariable(user.id, mc.mergeField, mc.mergeLabel, cleanContent);
        savedVersion = version;
        returnContent = cleanContent;
        break;
      }

      case "preCallPlanning": {
        const cleanContent = cleanMarkdownResponse(aiContent);
        const pcpImportTitle = uploadedFileName ? `${uploadedFileName.replace(/\.(pdf|csv)$/i, "")} - Pre-Call Planning` : "Imported Pre-Call Planning";
        const version = await prisma.preCallPlanningVersion.create({
          data: { userId: user.id, title: pcpImportTitle, content: cleanContent },
        });
        const mc = MERGE_CONFIGS[appletType]!;
        await upsertMergeVariable(user.id, mc.mergeField, mc.mergeLabel, cleanContent);
        savedVersion = version;
        returnContent = cleanContent;
        break;
      }

      case "salesNarrative": {
        const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Failed to parse AI response as JSON");
        const parsed = JSON.parse(jsonMatch[0]);

        const pdfNames = uploadedFileName ? [uploadedFileName] : [];
        const importTitle = uploadedFileName ? `${uploadedFileName.replace(/\.(pdf|csv)$/i, "")} - Sales Narrative` : "Imported Sales Narrative";
        const version = await prisma.salesNarrativeVersion.create({
          data: {
            userId: user.id,
            title: importTitle,
            narrative: parsed.narrative || "",
            description1000w: parsed.description1000w || null,
            description100w: parsed.description100w || "",
            description50w: parsed.description50w || "",
            description25w: parsed.description25w || "",
            sourcePdfNames: pdfNames,
          },
        });

        savedVersion = version;
        returnContent = {
          id: version.id,
          title: version.title,
          narrative: parsed.narrative || "",
          description1000w: parsed.description1000w || null,
          description100w: parsed.description100w || "",
          description50w: parsed.description50w || "",
          description25w: parsed.description25w || "",
          sourceUrls: [],
          sourcePdfNames: pdfNames,
          createdAt: version.createdAt,
        };
        break;
      }

      case "emailSequence": {
        const cleanContent = cleanMarkdownResponse(aiContent);

        // Email sequences require a salesNarrativeVersionId — use latest if available
        const latestNarrative = await prisma.salesNarrativeVersion.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        if (!latestNarrative) {
          return NextResponse.json(
            { error: "A sales narrative is required before importing an email sequence. Please create a sales narrative first." },
            { status: 400 },
          );
        }

        const version = await prisma.emailSequenceVersion.create({
          data: {
            userId: user.id,
            content: cleanContent,
            salesNarrativeVersionId: latestNarrative.id,
            orgPersona: "Imported via file upload",
            humanPersona: "Imported via file upload",
          },
          include: {
            salesNarrativeVersion: { select: { id: true, createdAt: true } },
          },
        });

        savedVersion = version;
        returnContent = version;
        break;
      }

      case "linkedInSequence": {
        const cleanContent = cleanMarkdownResponse(aiContent);

        const latestNarrative = await prisma.salesNarrativeVersion.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        if (!latestNarrative) {
          return NextResponse.json(
            { error: "A sales narrative is required before importing a LinkedIn sequence. Please create a sales narrative first." },
            { status: 400 },
          );
        }

        const version = await prisma.linkedInSequenceVersion.create({
          data: {
            userId: user.id,
            content: cleanContent,
            salesNarrativeVersionId: latestNarrative.id,
            orgPersona: "Imported via file upload",
            humanPersona: "Imported via file upload",
          },
          include: {
            salesNarrativeVersion: { select: { id: true, createdAt: true } },
          },
        });

        savedVersion = version;
        returnContent = version;
        break;
      }
    }

    // For complex types, returnContent is already the full version object
    // For simple types, wrap it
    const isFullObject = ["salesNarrative", "emailSequence", "linkedInSequence"].includes(appletType);
    const responseVersion = isFullObject
      ? returnContent
      : { id: savedVersion.id, content: returnContent, createdAt: savedVersion.createdAt };

    return NextResponse.json({
      success: true,
      version: responseVersion,
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
