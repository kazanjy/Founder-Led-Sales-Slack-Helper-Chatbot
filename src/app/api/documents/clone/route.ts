import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// POST - Clone (duplicate) the latest version of a sales document
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { documentType, documentId } = await request.json();

    if (!documentType || !documentId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    switch (documentType) {
      case "salesNarrative": {
        const source = await prisma.salesNarrativeVersion.findFirst({
          where: { id: documentId, userId: user.id },
          include: { answers: true },
        });
        if (!source) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const clone = await prisma.salesNarrativeVersion.create({
          data: {
            userId: user.id,
            title: source.title,
            narrative: source.narrative,
            description100w: source.description100w,
            description50w: source.description50w,
            description25w: source.description25w,
            sourceUrls: source.sourceUrls,
            sourcePdfNames: source.sourcePdfNames,
          },
        });

        // Clone answer snapshots
        if (source.answers.length > 0) {
          await prisma.salesNarrativeAnswer.createMany({
            data: source.answers.map((a) => ({
              userId: user.id,
              questionId: a.questionId,
              versionId: clone.id,
              answer: a.answer,
            })),
          });
        }

        return NextResponse.json({ success: true, versionId: clone.id });
      }

      case "discoveryQuestions": {
        const source = await prisma.discoveryQuestionsVersion.findFirst({
          where: { id: documentId, userId: user.id },
        });
        if (!source) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const clone = await prisma.discoveryQuestionsVersion.create({
          data: {
            userId: user.id,
            salesNarrativeVersionId: source.salesNarrativeVersionId,
            title: source.title,
            content: source.content,
          },
        });

        return NextResponse.json({ success: true, versionId: clone.id });
      }

      case "firstCallChecklist": {
        const source = await prisma.firstCallChecklistVersion.findFirst({
          where: { id: documentId, userId: user.id },
        });
        if (!source) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const clone = await prisma.firstCallChecklistVersion.create({
          data: {
            userId: user.id,
            discoveryQuestionsVersionId: source.discoveryQuestionsVersionId,
            title: source.title,
            content: source.content,
          },
        });

        return NextResponse.json({ success: true, versionId: clone.id });
      }

      case "preCallPlanning": {
        const source = await prisma.preCallPlanningVersion.findFirst({
          where: { id: documentId, userId: user.id },
        });
        if (!source) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const clone = await prisma.preCallPlanningVersion.create({
          data: {
            userId: user.id,
            firstCallChecklistVersionId: source.firstCallChecklistVersionId,
            title: source.title,
            content: source.content,
          },
        });

        return NextResponse.json({ success: true, versionId: clone.id });
      }

      case "emailSequence": {
        const source = await prisma.emailSequenceVersion.findFirst({
          where: { id: documentId, userId: user.id },
        });
        if (!source) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const clone = await prisma.emailSequenceVersion.create({
          data: {
            userId: user.id,
            salesNarrativeVersionId: source.salesNarrativeVersionId,
            firstCallChecklistVersionId: source.firstCallChecklistVersionId,
            orgPersona: source.orgPersona,
            humanPersona: source.humanPersona,
            specialNotes: source.specialNotes,
            content: source.content,
          },
        });

        return NextResponse.json({ success: true, versionId: clone.id });
      }

      case "linkedInSequence": {
        const source = await prisma.linkedInSequenceVersion.findFirst({
          where: { id: documentId, userId: user.id },
        });
        if (!source) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const clone = await prisma.linkedInSequenceVersion.create({
          data: {
            userId: user.id,
            salesNarrativeVersionId: source.salesNarrativeVersionId,
            firstCallChecklistVersionId: source.firstCallChecklistVersionId,
            orgPersona: source.orgPersona,
            humanPersona: source.humanPersona,
            specialNotes: source.specialNotes,
            content: source.content,
          },
        });

        return NextResponse.json({ success: true, versionId: clone.id });
      }

      default:
        return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error cloning document:", error);
    return NextResponse.json({ error: "Failed to clone document" }, { status: 500 });
  }
}
