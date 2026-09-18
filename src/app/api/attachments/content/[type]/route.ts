import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// GET - Fetch content for a specific attachment type
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { type } = await params;

    let content: string | null = null;
    let title: string = "";

    switch (type) {
      case "salesNarrative":
        content = await getSalesNarrativeContent(user.id);
        title = "Sales Narrative";
        break;

      case "gtmAssessment":
        content = await getGtmAssessmentContent(user.id);
        title = "GTM Assessment (Q&A)";
        break;

      case "icp":
        content = await getIcpContent(user.id);
        title = "Ideal Customer Profile";
        break;

      case "discoveryQuestions":
        content = await getDiscoveryQuestionsContent(user.id);
        title = "Discovery Questions";
        break;

      case "firstCallChecklist":
        content = await getFirstCallChecklistContent(user.id);
        title = "First Call Checklist";
        break;

      case "salesDeck":
        content = await getSalesDeckContent(user.id);
        title = "Sales Deck";
        break;

      default:
        return NextResponse.json(
          { error: "Invalid attachment type" },
          { status: 400 }
        );
    }

    if (!content) {
      return NextResponse.json(
        { error: "Content not available. Please complete the relevant app first." },
        { status: 404 }
      );
    }

    return NextResponse.json({ content, title });
  } catch (error) {
    console.error("Error fetching attachment content:", error);
    return NextResponse.json(
      { error: "Failed to fetch attachment content" },
      { status: 500 }
    );
  }
}

// Fetch Sales Narrative content (narrative + all descriptions + Q&A inputs)
async function getSalesNarrativeContent(userId: string): Promise<string | null> {
  const [narrativeVar, desc100, desc50, desc25, latestVersion] = await Promise.all([
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "SALES_NARRATIVE" },
      select: { value: true },
    }),
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "VALUE_PROP_100W" },
      select: { value: true },
    }),
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "VALUE_PROP_50W" },
      select: { value: true },
    }),
    prisma.gtmVariable.findFirst({
      where: { userId, mergeField: "VALUE_PROP_25W" },
      select: { value: true },
    }),
    // Get the latest sales narrative version with its Q&A answers
    prisma.salesNarrativeVersion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        answers: {
          include: {
            question: {
              select: {
                category: true,
                globalOrder: true,
                question: true,
              },
            },
          },
          orderBy: {
            question: {
              globalOrder: "asc",
            },
          },
        },
      },
    }),
  ]);

  if (!narrativeVar?.value) return null;

  let content = `### Full Sales Narrative\n\n${narrativeVar.value}`;

  if (desc100?.value) {
    content += `\n\n### 100-Word Description\n\n${desc100.value}`;
  }
  if (desc50?.value) {
    content += `\n\n### 50-Word Description\n\n${desc50.value}`;
  }
  if (desc25?.value) {
    content += `\n\n### 25-Word Tagline\n\n${desc25.value}`;
  }

  // Add Q&A inputs from the latest sales narrative version
  if (latestVersion && latestVersion.answers.length > 0) {
    content += `\n\n### Sales Narrative Q&A Inputs\n\n`;

    // Group by category
    const categories: Record<string, Array<{ question: string; answer: string; order: number }>> = {};

    for (const answer of latestVersion.answers) {
      const category = answer.question.category;
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push({
        question: answer.question.question,
        answer: answer.answer,
        order: answer.question.globalOrder,
      });
    }

    // Sort categories by first question's order
    const sortedCategories = Object.entries(categories).sort(
      (a, b) => (a[1][0]?.order || 0) - (b[1][0]?.order || 0)
    );

    for (const [categoryName, questions] of sortedCategories) {
      content += `**${categoryName}**\n\n`;
      for (const q of questions) {
        content += `**Q${q.order}: ${q.question}**\n`;
        content += `${q.answer || "_Not answered_"}\n\n`;
      }
    }
  }

  return content;
}

// Fetch GTM Assessment content (all Q&A pairings from latest assessment)
async function getGtmAssessmentContent(userId: string): Promise<string | null> {
  // Get the latest completed assessment with answers
  const assessment = await prisma.maturityAssessment.findFirst({
    where: { userId },
    orderBy: { completedAt: "desc" },
    include: {
      answers: {
        include: {
          question: {
            select: {
              category: true,
              globalOrder: true,
              question: true,
            },
          },
        },
        orderBy: {
          question: {
            globalOrder: "asc",
          },
        },
      },
    },
  });

  if (!assessment || assessment.answers.length === 0) return null;

  // Group answers by category
  const categories: Record<string, Array<{ question: string; answer: string; order: number }>> = {};

  for (const answer of assessment.answers) {
    const category = answer.question.category;
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push({
      question: answer.question.question,
      answer: answer.answer,
      order: answer.question.globalOrder,
    });
  }

  // Sort categories by first question's order
  const sortedCategories = Object.entries(categories).sort(
    (a, b) => (a[1][0]?.order || 0) - (b[1][0]?.order || 0)
  );

  // Build markdown content
  let content = "";
  for (const [categoryName, questions] of sortedCategories) {
    content += `### ${categoryName}\n\n`;
    for (const q of questions) {
      content += `**Q${q.order}: ${q.question}**\n`;
      content += `${q.answer || "_Not answered_"}\n\n`;
    }
  }

  return content.trim();
}

// Fetch Discovery Questions content
async function getDiscoveryQuestionsContent(userId: string): Promise<string | null> {
  const variable = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField: "DISCOVERY_QUESTIONS" },
    select: { value: true },
  });

  if (!variable?.value) return null;

  // The value is stored as JSON, parse and format as markdown
  try {
    const data = JSON.parse(variable.value);
    let content = "";

    if (data.categories && Array.isArray(data.categories)) {
      for (const category of data.categories) {
        content += `### ${category.name}\n`;
        if (category.description) {
          content += `${category.description}\n\n`;
        }
        for (let i = 0; i < category.questions.length; i++) {
          const q = category.questions[i];
          content += `${i + 1}. ${q.primary}\n`;
          if (q.followUps && q.followUps.length > 0) {
            for (const followUp of q.followUps) {
              content += `   - ${followUp}\n`;
            }
          }
        }
        content += "\n";
      }
    }

    return content.trim() || variable.value;
  } catch {
    // If parsing fails, return raw value
    return variable.value;
  }
}

// Fetch First Call Checklist content
async function getFirstCallChecklistContent(userId: string): Promise<string | null> {
  const variable = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField: "FIRST_CALL_CHECKLIST" },
    select: { value: true },
  });

  return variable?.value || null;
}

// Fetch ICP content
async function getIcpContent(userId: string): Promise<string | null> {
  const variable = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField: "ICP" },
    select: { value: true },
  });

  return variable?.value || null;
}

// Fetch Sales Deck content
async function getSalesDeckContent(userId: string): Promise<string | null> {
  const variable = await prisma.gtmVariable.findFirst({
    where: { userId, mergeField: "SALES_DECK" },
    select: { value: true },
  });

  return variable?.value || null;
}
