import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Helper: build a where clause that allows account-wide access
function cloneWhere(user: { id: string; accountId: string | null }, documentId: string) {
  if (user.accountId) {
    return { id: documentId, user: { accountId: user.accountId } };
  }
  return { id: documentId, userId: user.id };
}

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
          where: cloneWhere(user, documentId),
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
            description1000w: source.description1000w,
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
          where: cloneWhere(user, documentId),
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

      case "icp": {
        const source = await prisma.iCPVersion.findFirst({
          where: cloneWhere(user, documentId),
        });
        if (!source) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const clone = await prisma.iCPVersion.create({
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
          where: cloneWhere(user, documentId),
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
          where: cloneWhere(user, documentId),
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
          where: cloneWhere(user, documentId),
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
          where: cloneWhere(user, documentId),
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

      case "coldCallScript": {
        const source = await prisma.coldCallScriptVersion.findFirst({
          where: cloneWhere(user, documentId),
        });
        if (!source) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const clone = await prisma.coldCallScriptVersion.create({
          data: {
            userId: user.id,
            salesNarrativeVersionId: source.salesNarrativeVersionId,
            firstCallChecklistVersionId: source.firstCallChecklistVersionId,
            orgPersona: source.orgPersona,
            humanPersona: source.humanPersona,
            specialNotes: source.specialNotes,
            scriptType: source.scriptType,
            content: source.content,
          },
        });

        return NextResponse.json({ success: true, versionId: clone.id });
      }

      case "salesDeck": {
        const source = await prisma.salesDeckVersion.findFirst({
          where: cloneWhere(user, documentId),
        });
        if (!source) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const clone = await prisma.salesDeckVersion.create({
          data: {
            userId: user.id,
            salesNarrativeVersionId: source.salesNarrativeVersionId,
            firstCallChecklistVersionId: source.firstCallChecklistVersionId,
            orgPersona: source.orgPersona,
            humanPersona: source.humanPersona,
            specialNotes: source.specialNotes,
            deckMode: source.deckMode,
            sourcePdfName: source.sourcePdfName,
            content: source.content,
          },
        });

        return NextResponse.json({ success: true, versionId: clone.id });
      }

      case "adCreator": {
        const source = await prisma.adCreatorVersion.findFirst({
          where: cloneWhere(user, documentId),
        });
        if (!source) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const clone = await prisma.adCreatorVersion.create({
          data: {
            userId: user.id,
            salesNarrativeVersionId: source.salesNarrativeVersionId,
            firstCallChecklistVersionId: source.firstCallChecklistVersionId,
            orgPersona: source.orgPersona,
            humanPersona: source.humanPersona,
            specialNotes: source.specialNotes,
            tone: source.tone,
            platforms: source.platforms,
            content: source.content,
          },
        });

        return NextResponse.json({ success: true, versionId: clone.id });
      }

      case "objectionLibrary": {
        // Clone all objection entries for the user
        const sourceEntries = await prisma.objectionEntry.findMany({
          where: { userId: user.id },
        });
        if (sourceEntries.length === 0) {
          return NextResponse.json({ error: "No objection entries found" }, { status: 404 });
        }

        await prisma.objectionEntry.createMany({
          data: sourceEntries.map((e) => ({
            userId: user.id,
            objection: e.objection,
            category: e.category,
            orgPersona: e.orgPersona,
            humanPersona: e.humanPersona,
            handle: e.handle,
            notes: e.notes,
            source: e.source,
            sortOrder: e.sortOrder,
          })),
        });

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error cloning document:", error);
    return NextResponse.json({ error: "Failed to clone document" }, { status: 500 });
  }
}
