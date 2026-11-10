import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDefaultGtmVariable } from "@/lib/default-gtm-variables";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/gtm-variables/[id] - Get a single GTM variable with its history
 */
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const variable = await prisma.gtmVariable.findFirst({
    where: { id, userId: user.id },
    include: {
      history: {
        orderBy: { changedAt: "desc" },
      },
    },
  });

  if (!variable) {
    return NextResponse.json({ error: "Variable not found" }, { status: 404 });
  }

  return NextResponse.json({ variable });
}

/**
 * PUT /api/gtm-variables/[id] - Update a GTM variable
 * Saves the previous value to history if changed
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { name, description, value, aiAssistPrompt } = body;

  // Verify ownership
  const existing = await prisma.gtmVariable.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Variable not found" }, { status: 404 });
  }

  // If value is changing and there was a previous value, save to history
  const valueChanged = value !== undefined && value !== existing.value;
  const hadPreviousValue = existing.value && existing.value.trim() !== "";

  if (valueChanged && hadPreviousValue) {
    await prisma.gtmVariableHistory.create({
      data: {
        variableId: id,
        previousValue: existing.value!,
      },
    });
  }

  // Update the variable
  const updated = await prisma.gtmVariable.update({
    where: { id },
    data: {
      name: name ?? existing.name,
      description: description !== undefined ? description : existing.description,
      value: value !== undefined ? value : existing.value,
      aiAssistPrompt: aiAssistPrompt !== undefined ? aiAssistPrompt : existing.aiAssistPrompt,
    },
    include: {
      history: {
        orderBy: { changedAt: "desc" },
      },
    },
  });

  return NextResponse.json({ variable: updated });
}

/**
 * DELETE /api/gtm-variables/[id] - Delete a GTM variable
 * Only allows deleting custom variables, not defaults
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const existing = await prisma.gtmVariable.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Variable not found" }, { status: 404 });
  }

  // Don't allow deleting default variables
  if (existing.isDefault) {
    return NextResponse.json(
      { error: "Cannot delete a default variable. You can clear its value instead." },
      { status: 400 }
    );
  }

  // Delete the variable (history will cascade delete)
  await prisma.gtmVariable.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
}

/**
 * POST /api/gtm-variables/[id] - Special actions (reset to default)
 * Body: { action: "reset" }
 */
export async function POST(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { action } = body;

  if (action === "reset") {
    // Verify ownership and that it's a default variable
    const existing = await prisma.gtmVariable.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Variable not found" }, { status: 404 });
    }

    if (!existing.defaultVariableId) {
      return NextResponse.json({ error: "Cannot reset a custom variable" }, { status: 400 });
    }

    const defaultVariable = getDefaultGtmVariable(existing.defaultVariableId);
    if (!defaultVariable) {
      return NextResponse.json({ error: "Default variable not found" }, { status: 404 });
    }

    // Save current value to history if it exists
    if (existing.value && existing.value.trim() !== "") {
      await prisma.gtmVariableHistory.create({
        data: {
          variableId: id,
          previousValue: existing.value,
        },
      });
    }

    // Reset to defaults (except value - that stays empty or user can fill in)
    const updated = await prisma.gtmVariable.update({
      where: { id },
      data: {
        name: defaultVariable.name,
        description: defaultVariable.description,
        aiAssistPrompt: defaultVariable.aiAssistPrompt,
        // Note: We don't reset the value - that's user data
      },
      include: {
        history: {
          orderBy: { changedAt: "desc" },
        },
      },
    });

    return NextResponse.json({ variable: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
