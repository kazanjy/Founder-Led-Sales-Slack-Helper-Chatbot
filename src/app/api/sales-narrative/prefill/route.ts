import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { crawlWebsiteForContext } from "@/lib/narrative-prefill/crawl-website";
import { getCachedCrawl } from "@/lib/narrative-prefill/crawl-cache";
import { fetchPages } from "@/lib/search/fetcher";
import { downloadFile } from "@/lib/supabase";
import { extractTextFromPDFWithOCR, formatPDFForAIWithOCR } from "@/lib/pdf-server";

// Allow up to 120s for crawling + LLM
export const maxDuration = 120;

interface PrefillRequest {
  websiteUrl?: string;
  specificUrls?: string[];
  pdfFiles?: { name: string; storagePath?: string; base64Data?: string }[];
}

// POST - Pre-fill sales narrative Q&A from website URL and/or uploaded PDFs
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body: PrefillRequest = await request.json();
    const { websiteUrl, specificUrls, pdfFiles } = body;

    const hasSpecificUrls = specificUrls && specificUrls.filter((u) => u.trim()).length > 0;

    if (!websiteUrl?.trim() && !hasSpecificUrls && (!pdfFiles || pdfFiles.length === 0)) {
      return NextResponse.json(
        { error: "Provide a website URL, specific page URLs, and/or at least one PDF file." },
        { status: 400 }
      );
    }

    console.log(`[Prefill] Starting: websiteUrl=${websiteUrl || "none"}, specificUrls=${hasSpecificUrls ? specificUrls!.length : 0}, PDFs=${pdfFiles?.length || 0}`);

    // Load the questions we need to answer
    const questions = await prisma.salesNarrativeQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
      select: { id: true, category: true, globalOrder: true, question: true, helpText: true },
    });

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "No narrative questions configured." },
        { status: 500 }
      );
    }

    // Gather context in parallel, tracking sources
    const contextParts: string[] = [];
    const sourceUrls: string[] = [];
    const sourcePdfNames: string[] = [];
    const tasks: Promise<void>[] = [];

    // Website crawling (check precrawl cache first, then fall back to full crawl)
    if (websiteUrl?.trim()) {
      const cached = getCachedCrawl(user.id, websiteUrl.trim());
      if (cached) {
        console.log("[Prefill] Using precrawl cache hit — skipping crawl");
        if (cached.text) {
          contextParts.push(`## WEBSITE CONTENT\n\n${cached.text}`);
          sourceUrls.push(...cached.urls);
        }
      } else {
        tasks.push(
          crawlWebsiteForContext(websiteUrl.trim())
            .then((result) => {
              if (result.text) {
                contextParts.push(`## WEBSITE CONTENT\n\n${result.text}`);
                sourceUrls.push(...result.urls);
              }
            })
            .catch((err) => {
              console.error("[Prefill] Website crawl failed:", err);
            })
        );
      }
    }

    // Specific page URL fetching (single-page, no crawl)
    if (hasSpecificUrls) {
      const cleanUrls = specificUrls!.filter((u) => u.trim()).map((u) => {
        const trimmed = u.trim();
        return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
      });
      tasks.push(
        fetchPages(
          cleanUrls.map((u) => ({ url: u, purpose: "specific-page" })),
          5
        )
          .then((pages) => {
            const successPages = pages.filter((p) => p.success && p.textContent);
            if (successPages.length > 0) {
              const combined = successPages
                .map((p) => `### ${p.title || p.url}\n${p.textContent}`)
                .join("\n\n---\n\n");
              contextParts.push(`## SPECIFIC PAGE CONTENT\n\n${combined}`);
              sourceUrls.push(...successPages.map((p) => p.url));
            }
            const failedPages = pages.filter((p) => !p.success);
            if (failedPages.length > 0) {
              console.warn(`[Prefill] ${failedPages.length} specific URL(s) failed to fetch`);
            }
          })
          .catch((err) => {
            console.error("[Prefill] Specific URL fetch failed:", err);
          })
      );
    }

    // PDF processing — accept base64 data directly (like chat) or download from Supabase
    if (pdfFiles) {
      for (const pdf of pdfFiles) {
        tasks.push(
          (async () => {
            try {
              let buffer: Buffer;
              if (pdf.base64Data) {
                // Base64 sent directly from client (same pattern as chat uploads)
                const raw = pdf.base64Data.includes(",")
                  ? pdf.base64Data.split(",")[1]
                  : pdf.base64Data;
                buffer = Buffer.from(raw, "base64");
              } else if (pdf.storagePath) {
                buffer = await downloadFile(pdf.storagePath);
              } else {
                console.error(`[Prefill] PDF ${pdf.name}: no data or storagePath`);
                return;
              }
              const { result, usedOCR } = await extractTextFromPDFWithOCR(buffer, pdf.name, 30);
              const formatted = formatPDFForAIWithOCR(result, usedOCR);
              if (formatted) {
                contextParts.push(`## PDF: ${pdf.name}\n\n${formatted}`);
                sourcePdfNames.push(pdf.name);
              }
            } catch (err) {
              console.error(`[Prefill] Failed to process PDF ${pdf.name}:`, err);
            }
          })()
        );
      }
    }

    await Promise.all(tasks);

    const combinedContext = contextParts.join("\n\n---\n\n");

    if (!combinedContext.trim()) {
      return NextResponse.json(
        { error: "Could not extract any content from the provided materials." },
        { status: 400 }
      );
    }

    // Cap total context to stay within reasonable token limits
    const MAX_CONTEXT_CHARS = 120000;
    let trimmedContext = combinedContext;
    if (trimmedContext.length > MAX_CONTEXT_CHARS) {
      console.warn(`[Prefill] Trimming context from ${trimmedContext.length} to ${MAX_CONTEXT_CHARS} chars`);
      trimmedContext = trimmedContext.substring(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated for length...]";
    }

    console.log(`[Prefill] Total context: ${trimmedContext.length} chars from ${contextParts.length} sources`);

    // Build the question list for the LLM
    const questionList = questions
      .map((q) => {
        const help = q.helpText ? ` (${q.helpText})` : "";
        return `- ID: "${q.id}" | Q${q.globalOrder} [${q.category}]: ${q.question}${help}`;
      })
      .join("\n");

    // Build the full prompt (GPT-5.2 has large context — no chunking needed)
    const fullPrompt = `You are helping a founder pre-fill their Sales Narrative questionnaire. Based on the company context provided, answer each question as thoroughly and completely as you can. Use ALL the relevant information from the context — do not summarize or leave out details.

## QUESTIONS TO ANSWER

${questionList}

## INSTRUCTIONS

- Write RICH, DETAILED answers — aim for 3-8 sentences per question. More detail is always better.
- Pull in EVERY relevant detail from the context: specific product names, feature names, metrics, customer names, use cases, integrations, ROI figures, quotes, and competitive differentiators
- For "Who has the problem?" — list ALL organizational personas and human personas you can identify from the context, with specifics about each
- For "How do people currently solve this problem?" — enumerate every alternative/competitor mentioned and how each falls short
- For "How do you know it's better?" — include ALL proof points: customer quotes, metrics, case study results, awards, and third-party validation found in the context
- For pricing — include specific tiers, plans, and numbers if found
- If the context contains customer stories or case studies, weave those specifics into relevant answers
- Write in first person as if the founder is answering ("We solve...", "Our customers...", "Our product...")
- If you truly can't find information for a question, provide your best inference or leave it as an empty string
- Do NOT be brief — the founder wants comprehensive draft answers they can edit down, not thin summaries they have to expand

## WHAT THESE ANSWERS ARE FOR

These answers will be used to generate a Sales Narrative — a flowing prose document with 8 bold section headers. Understanding this output format will help you provide better, more relevant answers.

### THE SALES NARRATIVE FORMAT

The Sales Narrative weaves the questionnaire answers into a cohesive, persuasive story with these 8 sections:
- **What's the problem?**
- **Who has the problem?**
- **What's the cost of not solving the problem?**
- **How is this currently solved? Why doesn't that work?**
- **What has changed?**
- **How does it work?**
- **How do you know it's better?**
- **Pricing**

### EXAMPLES

#### The TalentBin Narrative

**What's the problem?** Technical recruiting is really hard! Finding software-engineering talent that has the skills that your organization requires, and then engaging with them to get them to consider your organization, is a tough problem.

**Who has the problem?** It's something that makes the lives of technical sourcers, recruiters, and recruiting managers rough.

**What's the cost of not solving the problem?** If they don't solve the problem, they may have to pay large sums of money to recruiting agencies—25% of a first-year salary of $125,000 or more. Otherwise they don't hire on schedule, and that impacts the ability of their organizations to ship software on time, and make revenue!

**How is this currently solved? Why doesn't that work?** Yes, you can use things like job boards or LinkedIn, but the problem is that unemployment is so low in software engineering that very few engineers are actively looking for jobs. And because most people don't really pay attention to LinkedIn or update their profiles, software-engineering profiles have a tendency not to exist, or to be missing the skill information that indicates that the engineer in question would be a good fit. Not to mention the fact that there are hundreds of thousands of recruiters on LinkedIn messaging every engineer they can find, and that creates tons of noise to cut through.

**What has changed?** But the good news is, the Internet has undergone some amazing changes of late to help make finding and engaging with these potential hires much easier and more effective. Because people are spending so much more time online, day in and out, on social sites like Twitter, Facebook, and Meetup and professional networks like GitHub and Stack Overflow—and because of the general move toward the digitization of work materials—there are reams and reams of information available. If properly leveraged, that material can help recruiters find talented individuals based on the activity they engage in online—for instance, tweeting about iOS development, being a member of an Android Meetup, participating in email lists about Java, and so on.

**How does it work?** TalentBin scoops up all the information that individuals leave as digital fingerprints of their professional selves, analyzes it, and turns it into profiles for these individuals, with skill details and contact information. Then we let recruiters search and review the profiles and reach out to folks.

**How do you know it's better?** Because TalentBin makes use of these mountains of "implicit" professional activity, it solves the problem of finding individuals who are not searching for jobs, not present in job board resume databases, and undiscoverable on LinkedIn due to their thin profiles. For instance, for a typical search like "Ruby on Rails" in the San Francisco Bay Area, TalentBin returns 5x the number of results compared to LinkedIn Recruiter. Moreover, 60% of these profiles have personal email addresses, which are so, so much better for engaging candidates. Recruiter open, click, and response rates using TalentBin provided personal email addresses are 3x-5x better than generic InMail outreach. And while the raw statistics tell the story, the hundreds of customers TalentBin has amassed—who have hired thousands of technical staff with the solution—tell the story even better. Not to mention the awards, press, and analyst accolades TalentBin has won since entering the market.

And all of this is available to you for **$6,000 per user, per year**. That includes unlimited requisitions, searches, and profile views, and unlimited email sends. Compare this to $8,000 for a LinkedIn Recruiter account with inferior technical candidate search recall, capped at a hundred InMails a month. It's a total steal!

#### The Salesforce Narrative

**What is the problem? Who has it?** Being a B2B sales rep is tough! You have to manage dozens of concurrent conversations, follow up at the right time, and not drop any balls. So too with being a sales manager. You have to make sure that your team is engaging in high activity—but also the right activity—and keep track of potential issues, while forecasting how your revenue achievement will end up for the quarter.

**What is the cost of the issue?** And this is serious business. If a rep drops a ball, forgetting to follow up with a prospect at the right time or neglecting to send a proposal as promised, it can mean tens or hundreds of thousands of dollars of lost revenue. Moreover, from an efficiency standpoint, if reps aren't sufficiently productive, they're missing out on potential deals and conversations. And for sales managers, not being able to manage the activity levels of staff, identify weaknesses, and forecast accurately could mean leaving problems unaddressed, which can turn into hundreds of thousands of dollars of short fallen targets. And that could mean missed quarters and stock impacts. It's no joke.

**How is this currently solved?** For how important customer-relationship tracking and management is, it's amazing how poorly it's generally done. You have reps either living out of their email and calendars or using ancient, clunky contact managers like Act! or GoldMine, or last-generation CRMs made by Siebel that look like something out of Tron.

**Why don't current solutions work?** The problem with these approaches is that email and calendars are not designed for tracking customer relationships, and make it more likely for very costly balls to be dropped. Last-generation CRM systems require reps to be in front of their computers, dialed into a VPN. And even if they are, those systems are extremely clunky and hard to use—creating more time and bookkeeping overhead rather than actually enabling reps to sell more, faster.

**What has changed?** However, with the rise of the Internet, now the power of modern, usable, always-accessible CRM can be available to reps wherever they are, whenever.

**How does it work?** Salesforce provides a modern, next-generation CRM that is accessed through the browser, connecting reps to their important deal information quickly and easily. And because it's software delivered as a service, the latest and greatest innovations in rep-efficiency features are available to all users, all at once, rather than requiring IT to upgrade the on-premise CRM system. And because web technologies make for easy interoperability, Salesforce has a massive partner ecosystem of amazing add-on tools that offer all manner of efficiency benefits.

**How do you know it's better?** Because the software is available to reps wherever and whenever via a browser, and is much more usable, you get reps who are logging in and updating opportunities and pipelines as much as 3x–10x as often as on traditional systems. That not only reduces the potential for dropped balls—as you can see by the 20%–50% increase in win rates for reps who adopt Salesforce—but also makes for more accurate forecasts on a rep and sales manager basis. We've seen a 30%–50% reduction in missed forecasts for managers whose teams use Salesforce. All of which has resulted in Salesforce being the most lauded CRM solution on the market, consistently in Gartner's Magic Quadrant for CRM, and gaining tens of thousands of customers.

### WHY THIS MATTERS FOR YOUR ANSWERS

When answering each question, think about what details would make for a compelling narrative section. Include specifics like metrics, customer names, competitive comparisons, and cost figures — these are the building blocks of an effective sales narrative.

Respond with ONLY valid JSON mapping question IDs to answer strings:
{"questionId1": "answer text...", "questionId2": "answer text...", ...}

## COMPANY CONTEXT

${trimmedContext}`;

    console.log(`[Prefill] Sending to GPT-5.2: ${fullPrompt.length} chars`);

    // Call GPT-5.2
    let aiResponse: string;
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [{ role: "user", content: fullPrompt }],
        temperature: 0.7,
      });
      aiResponse = response.choices[0]?.message?.content || "";
    } catch (err) {
      console.error("[Prefill] GPT-5.2 error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: `AI generation failed: ${msg}` },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let answers: Record<string, string>;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      answers = JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error("[Prefill] Failed to parse AI response:", err);
      console.error("[Prefill] Raw response:", aiResponse.substring(0, 1000));
      return NextResponse.json(
        { error: "Failed to parse AI response. Please try again." },
        { status: 500 }
      );
    }

    // Validate: only include answers for known question IDs
    const validIds = new Set(questions.map((q) => q.id));
    const validAnswers: Record<string, string> = {};
    let filledCount = 0;

    for (const [id, answer] of Object.entries(answers)) {
      if (validIds.has(id) && typeof answer === "string" && answer.trim()) {
        validAnswers[id] = answer.trim();
        filledCount++;
      }
    }

    console.log(`[Prefill] Pre-filled ${filledCount} of ${questions.length} questions`);

    return NextResponse.json({
      success: true,
      answers: validAnswers,
      filledCount,
      totalQuestions: questions.length,
      sourceUrls,
      sourcePdfNames,
    });
  } catch (error) {
    console.error("[Prefill] Error:", error);
    return NextResponse.json(
      { error: "Failed to pre-fill narrative" },
      { status: 500 }
    );
  }
}
