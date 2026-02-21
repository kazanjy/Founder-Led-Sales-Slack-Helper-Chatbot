import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

// POST - Generate sales narrative from questionnaire answers
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
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
    const productName = productQuestion ? answerMap.get(productQuestion.id) || "the product" : "the product";

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

    // Build the prompt for Chatbase
    const systemPrompt = `You are helping a founder create their sales narrative following the "Founding Sales Sales Narrative" approach by Pete Kazanjy.

The product/service name is: ${productName}

Based on the questionnaire answers below, generate a compelling sales narrative and product descriptions.

## THE FOUNDING SALES SALES NARRATIVE FORMAT

The Sales Narrative is a flowing prose document (NOT bullet points) that weaves the answers into a cohesive, persuasive story. Each section should be prefaced with the question it addresses (e.g., "What's the problem?", "Who has the problem?", etc.).

Follow this structure:
1. **What's the problem?** - Open with the problem, make it visceral and relatable
2. **Who has the problem? What's the cost of not solving the problem?** - Identify specific personas affected and quantify the costs (dollars, time, opportunity cost)
3. **How is this currently solved? Why doesn't that work?** - Describe current solutions and why they fall short
4. **What has changed?** - Explain what enables a new solution now
5. **How does it work?** - Describe how your solution works
6. **How do you know it's better?** - Provide proof with specific metrics, customer results, social proof
7. **Pricing** - End with pricing positioned as compelling value vs. alternatives

Use an engaging, conversational tone with urgency around the problem. Include specific numbers and metrics throughout.

## EXAMPLES

### The TalentBin Narrative

**What's the problem?** Technical recruiting is really hard! Finding software-engineering talent that has the skills that your organization requires, and then engaging with them to get them to consider your organization, is a tough problem.

**Who has the problem? What's the cost of not solving the problem?** It's something that makes the lives of technical sourcers, recruiters, and recruiting managers rough, particularly because if they don't solve the problem, they may have to pay large sums of money to recruiting agencies—25% of a first-year salary of $125,000 or more. Otherwise they don't hire on schedule, and that impacts the ability of their organizations to ship software on time, and make revenue!

**How is this currently solved? Why doesn't that work?** Yes, you can use things like job boards or LinkedIn, but the problem is that unemployment is so low in software engineering that very few engineers are actively looking for jobs. And because most people don't really pay attention to LinkedIn or update their profiles, software-engineering profiles have a tendency not to exist, or to be missing the skill information that indicates that the engineer in question would be a good fit. Not to mention the fact that there are hundreds of thousands of recruiters on LinkedIn messaging every engineer they can find, and that creates tons of noise to cut through.

**What has changed?** But the good news is, the Internet has undergone some amazing changes of late to help make finding and engaging with these potential hires much easier and more effective. Because people are spending so much more time online, day in and out, on social sites like Twitter, Facebook, and Meetup and professional networks like GitHub and Stack Overflow—and because of the general move toward the digitization of work materials—there are reams and reams of information available. If properly leveraged, that material can help recruiters find talented individuals based on the activity they engage in online—for instance, tweeting about iOS development, being a member of an Android Meetup, participating in email lists about Java, and so on.

**How does it work?** TalentBin scoops up all the information that individuals leave as digital fingerprints of their professional selves, analyzes it, and turns it into profiles for these individuals, with skill details and contact information. Then we let recruiters search and review the profiles and reach out to folks.

**How do you know it's better?** Because TalentBin makes use of these mountains of "implicit" professional activity, it solves the problem of finding individuals who are not searching for jobs, not present in job board resume databases, and undiscoverable on LinkedIn due to their thin profiles. For instance, for a typical search like "Ruby on Rails" in the San Francisco Bay Area, TalentBin returns 5x the number of results compared to LinkedIn Recruiter. Moreover, 60% of these profiles have personal email addresses, which are so, so much better for engaging candidates. Recruiter open, click, and response rates using TalentBin provided personal email addresses are 3x-5x better than generic InMail outreach. And while the raw statistics tell the story, the hundreds of customers TalentBin has amassed—who have hired thousands of technical staff with the solution—tell the story even better. Not to mention the awards, press, and analyst accolades TalentBin has won since entering the market.

And all of this is available to you for **$6,000 per user, per year**. That includes unlimited requisitions, searches, and profile views, and unlimited email sends. Compare this to $8,000 for a LinkedIn Recruiter account with inferior technical candidate search recall, capped at a hundred InMails a month. It's a total steal!

### The Salesforce Narrative

**What is the problem? Who has it?** Being a B2B sales rep is tough! You have to manage dozens of concurrent conversations, follow up at the right time, and not drop any balls. So too with being a sales manager. You have to make sure that your team is engaging in high activity—but also the right activity—and keep track of potential issues, while forecasting how your revenue achievement will end up for the quarter.

**What is the cost of the issue?** And this is serious business. If a rep drops a ball, forgetting to follow up with a prospect at the right time or neglecting to send a proposal as promised, it can mean tens or hundreds of thousands of dollars of lost revenue. Moreover, from an efficiency standpoint, if reps aren't sufficiently productive, they're missing out on potential deals and conversations. And for sales managers, not being able to manage the activity levels of staff, identify weaknesses, and forecast accurately could mean leaving problems unaddressed, which can turn into hundreds of thousands of dollars of short fallen targets. And that could mean missed quarters and stock impacts. It's no joke.

**How is this currently solved?** For how important customer-relationship tracking and management is, it's amazing how poorly it's generally done. You have reps either living out of their email and calendars or using ancient, clunky contact managers like Act! or GoldMine, or last-generation CRMs made by Siebel that look like something out of Tron.

**Why don't current solutions work?** The problem with these approaches is that email and calendars are not designed for tracking customer relationships, and make it more likely for very costly balls to be dropped. Last-generation CRM systems require reps to be in front of their computers, dialed into a VPN. And even if they are, those systems are extremely clunky and hard to use—creating more time and bookkeeping overhead rather than actually enabling reps to sell more, faster.

**What has changed?** However, with the rise of the Internet, now the power of modern, usable, always-accessible CRM can be available to reps wherever they are, whenever.

**How does it work?** Salesforce provides a modern, next-generation CRM that is accessed through the browser, connecting reps to their important deal information quickly and easily. And because it's software delivered as a service, the latest and greatest innovations in rep-efficiency features are available to all users, all at once, rather than requiring IT to upgrade the on-premise CRM system. And because web technologies make for easy interoperability, Salesforce has a massive partner ecosystem of amazing add-on tools that offer all manner of efficiency benefits.

**How do you know it's better?** Because the software is available to reps wherever and whenever via a browser, and is much more usable, you get reps who are logging in and updating opportunities and pipelines as much as 3x–10x as often as on traditional systems. That not only reduces the potential for dropped balls—as you can see by the 20%–50% increase in win rates for reps who adopt Salesforce—but also makes for more accurate forecasts on a rep and sales manager basis. We've seen a 30%–50% reduction in missed forecasts for managers whose teams use Salesforce. All of which has resulted in Salesforce being the most lauded CRM solution on the market, consistently in Gartner's Magic Quadrant for CRM, and gaining tens of thousands of customers.

## OUTPUT REQUIREMENTS

Generate:
1. **SALES NARRATIVE** - CRITICAL: Each section MUST start with a bold header question exactly like the examples above (e.g., "**What's the problem?**", "**Who has the problem?**", etc.). The narrative should have 6-7 distinct sections, each beginning with its header in bold. Do NOT omit the headers - they are essential to the Founding Sales format.

2. **100-WORD DESCRIPTION** - A product marketing summary suitable for a website or pitch deck. Covers problem, solution, and key differentiator. No headers needed.

3. **50-WORD DESCRIPTION** - An elevator pitch that can be spoken in ~20 seconds. Problem + solution + why it's better. No headers needed.

4. **25-WORD DESCRIPTION** - A tagline or one-liner that captures the essence. No headers needed.

## QUESTIONNAIRE ANSWERS:

${answersSummary}

---

IMPORTANT: Respond ONLY with valid JSON in this exact format (no markdown code blocks, just raw JSON):
{"narrative": "The full sales narrative with question headers...", "description100w": "The 100-word description...", "description50w": "The 50-word description...", "description25w": "The 25-word tagline..."}`;

    // Chatbase has an 8000 character limit per message
    // If the prompt is too long, we need to chunk it
    const CHATBASE_LIMIT = 7500;

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = systemPrompt;

    if (systemPrompt.length > CHATBASE_LIMIT) {
      // Split into chunks
      const chunks: string[] = [];
      const sections = answersSummary.split(/(?=## )/);

      let currentChunk = "";
      for (const section of sections) {
        if (currentChunk.length + section.length > CHATBASE_LIMIT - 1000) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = section;
        } else {
          currentChunk += section;
        }
      }
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }

      // Add chunks as conversation history
      for (let i = 0; i < chunks.length; i++) {
        chatbaseHistory.push({
          role: "user",
          content: `[Sales Narrative Questionnaire Part ${i + 1} of ${chunks.length}]\n\n${chunks[i]}`,
        });
        if (i < chunks.length - 1) {
          chatbaseHistory.push({
            role: "assistant",
            content: `I've received part ${i + 1}. Please continue with the remaining sections.`,
          });
        }
      }

      // Final message is just the generation instructions
      finalMessage = `Based on all the questionnaire answers I've shared, please generate:

1. A SALES NARRATIVE - Flowing prose (NOT bullets) that tells a compelling story about the problem, who has it, current solutions and their gaps, what changed, how the new solution works, proof it's better, and pricing as value.

2. A 100-WORD DESCRIPTION - Product marketing summary

3. A 50-WORD DESCRIPTION - Elevator pitch

4. A 25-WORD DESCRIPTION - Tagline

IMPORTANT: Respond ONLY with valid JSON (no markdown):
{"narrative": "...", "description100w": "...", "description50w": "...", "description25w": "..."}`;
    }

    console.log(`Sending to Chatbase: ${chatbaseHistory.length} history messages, final message: ${finalMessage.length} chars`);

    // Call Chatbase
    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate narrative. Please try again." },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let parsedResponse: {
      narrative: string;
      description100w: string;
      description50w: string;
      description25w: string;
    };

    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsedResponse = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!parsedResponse.narrative || !parsedResponse.description100w ||
          !parsedResponse.description50w || !parsedResponse.description25w) {
        throw new Error("Missing required fields in response");
      }
    } catch (parseError) {
      console.error("Failed to parse Chatbase response:", parseError);
      console.error("Raw response:", aiResponse);
      return NextResponse.json(
        { error: "Failed to parse generated content. Please try again." },
        { status: 500 }
      );
    }

    // Create the version record
    const version = await prisma.salesNarrativeVersion.create({
      data: {
        userId: user.id,
        narrative: parsedResponse.narrative,
        description100w: parsedResponse.description100w,
        description50w: parsedResponse.description50w,
        description25w: parsedResponse.description25w,
      },
    });

    // Create snapshot of all answers linked to this version
    const answerSnapshots = questions.map((q) => ({
      userId: user.id,
      questionId: q.id,
      versionId: version.id,
      answer: answerMap.get(q.id) || "",
    }));

    await prisma.salesNarrativeAnswer.createMany({
      data: answerSnapshots,
    });

    // Update merge variables with the latest narrative outputs
    const mergeVariables = [
      { mergeField: "SALES_NARRATIVE", name: "Sales Narrative", value: parsedResponse.narrative },
      { mergeField: "VALUE_PROP_100W", name: "Value Proposition (100 words)", value: parsedResponse.description100w },
      { mergeField: "VALUE_PROP_50W", name: "Value Proposition (50 words)", value: parsedResponse.description50w },
      { mergeField: "VALUE_PROP_25W", name: "Value Proposition (25 words)", value: parsedResponse.description25w },
    ];

    for (const mv of mergeVariables) {
      await prisma.gtmVariable.upsert({
        where: {
          userId_mergeField: {
            userId: user.id,
            mergeField: mv.mergeField,
          },
        },
        update: {
          value: mv.value,
        },
        create: {
          userId: user.id,
          mergeField: mv.mergeField,
          name: mv.name,
          value: mv.value,
          isDefault: false,
        },
      });
    }

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        narrative: version.narrative,
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
