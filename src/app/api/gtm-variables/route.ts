import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_GTM_VARIABLES } from "@/lib/default-gtm-variables";

/**
 * GET /api/gtm-variables - List user's GTM variables with history
 * If user has none, initialize with defaults
 */
export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user's GTM variables with history
  let variables = await prisma.gtmVariable.findMany({
    where: { userId: user.id },
    orderBy: { sortOrder: "asc" },
    include: {
      history: {
        orderBy: { changedAt: "desc" },
        take: 10, // Limit history to last 10 changes
      },
    },
  });

  // If user has no variables, initialize with defaults
  if (variables.length === 0) {
    const defaultData = DEFAULT_GTM_VARIABLES.map((v) => ({
      userId: user.id,
      name: v.name,
      mergeField: v.mergeField,
      description: v.description,
      aiAssistPrompt: v.aiAssistPrompt,
      isDefault: true,
      defaultVariableId: v.id,
      sortOrder: v.sortOrder,
    }));

    await prisma.gtmVariable.createMany({
      data: defaultData,
    });

    variables = await prisma.gtmVariable.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
      include: {
        history: {
          orderBy: { changedAt: "desc" },
          take: 10,
        },
      },
    });
  }

  // Calculate completion stats
  const totalVariables = variables.length;
  const completedVariables = variables.filter((v) => v.value && v.value.trim() !== "").length;

  return NextResponse.json({
    variables,
    stats: {
      total: totalVariables,
      completed: completedVariables,
      remaining: totalVariables - completedVariables,
    },
  });
}

/**
 * POST /api/gtm-variables - Create a new custom GTM variable
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, mergeField, description, value, aiAssistPrompt } = body;

  if (!name || !mergeField) {
    return NextResponse.json(
      { error: "Name and merge field are required" },
      { status: 400 }
    );
  }

  // Validate merge field format (uppercase letters and underscores only)
  if (!/^[A-Z][A-Z_]*$/.test(mergeField)) {
    return NextResponse.json(
      { error: "Merge field must be uppercase letters and underscores only, starting with a letter" },
      { status: 400 }
    );
  }

  // Check for duplicate merge field
  const existing = await prisma.gtmVariable.findFirst({
    where: { userId: user.id, mergeField },
  });

  if (existing) {
    return NextResponse.json(
      { error: "A variable with this merge field already exists" },
      { status: 400 }
    );
  }

  // Get the highest sort order
  const lastVariable = await prisma.gtmVariable.findFirst({
    where: { userId: user.id },
    orderBy: { sortOrder: "desc" },
  });

  const newVariable = await prisma.gtmVariable.create({
    data: {
      userId: user.id,
      name,
      mergeField,
      description: description || null,
      value: value || null,
      aiAssistPrompt: aiAssistPrompt || null,
      isDefault: false,
      sortOrder: (lastVariable?.sortOrder ?? -1) + 1,
    },
    include: {
      history: true,
    },
  });

  return NextResponse.json({ variable: newVariable });
}
