import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { extractProductName } from "@/lib/extract-product-name";

// Allow up to 120s for GPT-5.2 generation
export const maxDuration = 120;

// POST - Generate sales narrative from questionnaire answers
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Parse optional sources from request body
    let sourceUrls: string[] = [];
    let sourcePdfNames: string[] = [];
    try {
      const body = await request.json();
      sourceUrls = body.sourceUrls || [];
      sourcePdfNames = body.sourcePdfNames || [];
    } catch {
      // No body or invalid JSON — that's fine, sources are optional
    }

    // Get all enabled questions
    const questions = await prisma.salesNarrativeQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

    // Get user's latest answer for each question
    const latestAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "createdAt"
      FROM "sales_narrative_answers"
      WHERE "userId" = ${user.id}
      ORDER BY "questionId", "createdAt" DESC
    `;

    const answerMap = new Map<string, string>(
      latestAnswers.map((a) => [a.questionId, a.answer])
    );

    // Check if at least some questions are answered
    const answeredCount = latestAnswers.length;
    if (answeredCount === 0) {
      return NextResponse.json(
        { error: "No answers found. Please answer at least some questions before generating." },
        { status: 400 }
      );
    }

    // Build the answers summary for the AI
    const categoryOrder = ["Product", "Problem", "Solution", "Proof", "Business"];
    let answersSummary = "";

    // Extract product name for use in prompt
    const productQuestion = questions.find((q) => q.category === "Product");
    const productName = productQuestion ? extractProductName(answerMap.get(productQuestion.id) || "", "the product") : "the product";

    for (const category of categoryOrder) {
      const categoryQuestions = questions.filter((q) => q.category === category);
      if (categoryQuestions.length === 0) continue;

      answersSummary += `## ${category}\n\n`;

      for (const q of categoryQuestions) {
        const answer = answerMap.get(q.id);
        answersSummary += `**Q${q.globalOrder}: ${q.question}**\n`;
        if (answer) {
          answersSummary += `${answer}\n\n`;
        } else {
          answersSummary += `_Not answered_\n\n`;
        }
      }
    }

    console.log("Sales narrative answers summary length:", answersSummary.length, "characters");

    // Shared context for prompts
    const sharedPreamble = `You are helping a founder create their sales narrative.
The product/service name is: ${productName}
IMPORTANT: Do NOT mention "Pete Kazanjy" or "Founding Sales" anywhere in the generated text.

## QUESTIONNAIRE ANSWERS:

${answersSummary}`;

    // --- PARALLEL LLM CALLS ---
    // Split generation into two parallel calls to cut wall-clock time roughly in half:
    //  Call A: Full ~2000-word narrative + 1000-word condensed version + title
    //  Call B: Short descriptions (100w, 50w, 25w) — much faster

    const narrativePrompt = `${sharedPreamble}

---

## THE SALES NARRATIVE FORMAT

The Sales Narrative is a flowing prose document (NOT bullet points) that weaves the answers into a cohesive, persuasive story.

### CRITICAL REQUIREMENT: SECTION HEADERS ARE MANDATORY

Each section MUST begin with its header in bold, exactly like this:
- **What's the problem?**
- **Who has the problem?**
- **What's the cost of not solving the problem?**
- **How is this currently solved? Why doesn't that work?**
- **What has changed?**
- **How does it work?**
- **How do you know it's better?**
- **Pricing**

Use an engaging, conversational tone with urgency around the problem. Include specific numbers and metrics throughout.

## EXAMPLES

### The TalentBin Narrative

**What's the problem?** Technical recruiting is really hard! Finding software-engineering talent that has the skills that your organization requires, and then engaging with them to get them to consider your organization, is a tough problem.

**Who has the problem?** It's something that makes the lives of technical sourcers, recruiters, and recruiting managers rough.

**What's the cost of not solving the problem?** If they don't solve the problem, they may have to pay large sums of money to recruiting agencies—25% of a first-year salary of $125,000 or more. Otherwise they don't hire on schedule, and that impacts the ability of their organizations to ship software on time, and make revenue!

**How is this currently solved? Why doesn't that work?** Yes, you can use things like job boards or LinkedIn, but the problem is that unemployment is so low in software engineering that very few engineers are actively looking for jobs. And because most people don't really pay attention to LinkedIn or update their profiles, software-engineering profiles have a tendency not to exist, or to be missing the skill information that indicates that the engineer in question would be a good fit.

**What has changed?** But the good news is, the Internet has undergone some amazing changes of late to help make finding and engaging with these potential hires much easier and more effective. Because people are spending so much more time online on social sites like Twitter, Facebook, Meetup and professional networks like GitHub and Stack Overflow, there are reams and reams of information available.

**How does it work?** TalentBin scoops up all the information that individuals leave as digital fingerprints of their professional selves, analyzes it, and turns it into profiles for these individuals, with skill details and contact information.

**How do you know it's better?** Because TalentBin makes use of these mountains of "implicit" professional activity, it returns 5x the number of results compared to LinkedIn Recruiter. Moreover, 60% of these profiles have personal email addresses. Recruiter open, click, and response rates are 3x-5x better than generic InMail outreach.

And all of this is available to you for **$6,000 per user, per year**.

## OUTPUT REQUIREMENTS

Generate TWO items:

1. **SALES NARRATIVE (~2000 WORDS)** - 8 sections, each starting with a bold header. 2-4 substantial paragraphs per section. Go deep on specifics.

2. **1000-WORD CONDENSED NARRATIVE** - Same 8-section structure with bold headers, but 1-2 paragraphs per section.

Also generate a **NARRATIVE TITLE** in the format: "[Product Name] - [Category/Market] - Sales Narrative".

Respond ONLY with valid JSON (no markdown code blocks):
{"narrativeTitle": "...", "narrative": "The full ~2000-word narrative...", "description1000w": "The ~1000-word condensed narrative..."}`;

    const descriptionsPrompt = `${sharedPreamble}

---

Based on the answers above, generate three product descriptions of decreasing length. Be specific about the problem, solution, and differentiation. Do NOT use generic language.

Respond ONLY with valid JSON (no markdown code blocks):
{"description100w": "A ~100-word product marketing summary...", "description50w": "A ~50-word elevator pitch...", "description25w": "A ~25-word tagline..."}`;

    console.log(`Sending parallel GPT-5.2 calls: narrative=${narrativePrompt.length} chars, descriptions=${descriptionsPrompt.length} chars`);

    // Fire both LLM calls in parallel
    let narrativeRaw = "";
    let descriptionsRaw = "";
    try {
      const [narrativeRes, descriptionsRes] = await Promise.all([
        openai.chat.completions.create({
          model: "gpt-5.5",
          messages: [{ role: "user", content: narrativePrompt }],
          temperature: 0.7,
        }),
        openai.chat.completions.create({
          model: "gpt-5.5",
          messages: [{ role: "user", content: descriptionsPrompt }],
          temperature: 0.7,
        }),
      ]);
      narrativeRaw = narrativeRes.choices[0]?.message?.content || "";
      descriptionsRaw = descriptionsRes.choices[0]?.message?.content || "";
    } catch (gptError) {
      console.error("GPT-5.2 API error:", gptError);
      const errorMessage = gptError instanceof Error ? gptError.message : "Unknown error";
      return NextResponse.json(
        { error: `Failed to generate narrative: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Parse both JSON responses
    let parsedResponse: {
      narrativeTitle?: string;
      narrative: string;
      description1000w?: string;
      description100w: string;
      description50w: string;
      description25w: string;
    };

    try {
      const narrativeJson = narrativeRaw.match(/\{[\s\S]*\}/);
      const descriptionsJson = descriptionsRaw.match(/\{[\s\S]*\}/);
      if (!narrativeJson || !descriptionsJson) {
        throw new Error("No JSON found in one or both responses");
      }
      const narrativeParsed = JSON.parse(narrativeJson[0]);
      const descriptionsParsed = JSON.parse(descriptionsJson[0]);

      parsedResponse = {
        narrativeTitle: narrativeParsed.narrativeTitle,
        narrative: narrativeParsed.narrative,
        description1000w: narrativeParsed.description1000w,
        description100w: descriptionsParsed.description100w,
        description50w: descriptionsParsed.description50w,
        description25w: descriptionsParsed.description25w,
      };

      if (!parsedResponse.narrative || !parsedResponse.description100w ||
          !parsedResponse.description50w || !parsedResponse.description25w) {
        throw new Error("Missing required fields in response");
      }
    } catch (parseError) {
      console.error("Failed to parse GPT-5.2 response:", parseError);
      console.error("Narrative raw:", narrativeRaw.substring(0, 500));
      console.error("Descriptions raw:", descriptionsRaw.substring(0, 500));
      return NextResponse.json(
        { error: "Failed to parse generated content. Please try again." },
        { status: 500 }
      );
    }

    // Build a descriptive title
    const narrativeTitle = parsedResponse.narrativeTitle || `${productName} - Sales Narrative`;

    // Create the version record
    const version = await prisma.salesNarrativeVersion.create({
      data: {
        userId: user.id,
        title: narrativeTitle,
        narrative: parsedResponse.narrative,
        description1000w: parsedResponse.description1000w || null,
        description100w: parsedResponse.description100w,
        description50w: parsedResponse.description50w,
        description25w: parsedResponse.description25w,
        sourceUrls,
        sourcePdfNames,
      },
    });

    // Create answer snapshots and update merge variables in parallel
    const answerSnapshots = questions.map((q) => ({
      userId: user.id,
      questionId: q.id,
      versionId: version.id,
      answer: answerMap.get(q.id) || "",
    }));

    const mergeVariables = [
      { mergeField: "SALES_NARRATIVE", name: "Sales Narrative", value: parsedResponse.narrative },
      { mergeField: "VALUE_PROP_1000W", name: "Value Proposition (1000 words)", value: parsedResponse.description1000w || "" },
      { mergeField: "VALUE_PROP_100W", name: "Value Proposition (100 words)", value: parsedResponse.description100w },
      { mergeField: "VALUE_PROP_50W", name: "Value Proposition (50 words)", value: parsedResponse.description50w },
      { mergeField: "VALUE_PROP_25W", name: "Value Proposition (25 words)", value: parsedResponse.description25w },
    ];

    await Promise.all([
      prisma.salesNarrativeAnswer.createMany({ data: answerSnapshots }),
      ...mergeVariables.map((mv) =>
        prisma.gtmVariable.upsert({
          where: {
            userId_mergeField: {
              userId: user.id,
              mergeField: mv.mergeField,
            },
          },
          update: { value: mv.value },
          create: {
            userId: user.id,
            mergeField: mv.mergeField,
            name: mv.name,
            value: mv.value,
            isDefault: false,
          },
        })
      ),
    ]);

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        title: version.title,
        narrative: version.narrative,
        description1000w: version.description1000w,
        description100w: version.description100w,
        description50w: version.description50w,
        description25w: version.description25w,
        createdAt: version.createdAt,
      },
      summary: {
        totalQuestions: questions.length,
        answeredCount,
      },
    });
  } catch (error) {
    console.error("Error generating sales narrative:", error);
    return NextResponse.json(
      { error: "Failed to generate narrative" },
      { status: 500 }
    );
  }
}
