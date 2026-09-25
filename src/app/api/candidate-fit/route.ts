import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assessCandidate } from "@/lib/hiring/candidate-assessment";
import { extractTextFromPDFWithOCR, formatPDFForAIWithOCR, isPDFMimeType } from "@/lib/pdf-server";

/** An enrich + two model passes; well past the default lambda ceiling. */
export const maxDuration = 300;

/**
 * Candidate fit assessments. Reads are ACCOUNT-scoped: a candidate a
 * teammate already screened is exactly the thing you don't want to
 * re-screen (and re-pay PDL for), so the whole account shares the list.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const assessments = await prisma.candidateAssessment.findMany({
      where: user.accountId ? { user: { accountId: user.accountId } } : { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        candidateKey: true,
        candidateName: true,
        linkedinUrl: true,
        roleLabel: true,
        source: true,
        verdict: true,
        maturityStage: true,
        rubricVersion: true,
        model: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json({ assessments });
  } catch (error) {
    console.error("[candidate-fit] list failed:", error);
    return NextResponse.json({ error: "Failed to load assessments" }, { status: 500 });
  }
}

/**
 * Run an assessment. Accepts JSON, or multipart when a résumé / LinkedIn
 * PDF export is attached — the PDF is extracted here (with OCR fallback,
 * since LinkedIn's own "Save to PDF" is often image-backed) and folded in
 * as profileText.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    let linkedinUrl = "";
    let profileText = "";
    let candidateName = "";
    let roleLabel = "AE";
    let fileName: string | null = null;

    if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await req.formData();
      linkedinUrl = String(form.get("linkedinUrl") || "");
      profileText = String(form.get("profileText") || "");
      candidateName = String(form.get("candidateName") || "");
      roleLabel = String(form.get("roleLabel") || "AE");

      const file = form.get("file");
      if (file && typeof file === "object" && "arrayBuffer" in file) {
        const blob = file as File;
        fileName = blob.name;
        const buffer = Buffer.from(await blob.arrayBuffer());
        if (isPDFMimeType(blob.type) || /\.pdf$/i.test(blob.name)) {
          const { result, usedOCR } = await extractTextFromPDFWithOCR(buffer, blob.name);
          // Appended, not substituted: a pasted note plus the PDF is a
          // better read than either alone.
          profileText = [profileText, formatPDFForAIWithOCR(result, usedOCR)]
            .filter(Boolean)
            .join("\n\n");
        } else {
          profileText = [profileText, buffer.toString("utf-8")].filter(Boolean).join("\n\n");
        }
      }
    } else {
      const body = await req.json();
      linkedinUrl = String(body.linkedinUrl || "");
      profileText = String(body.profileText || "");
      candidateName = String(body.candidateName || "");
      roleLabel = String(body.roleLabel || "AE");
    }

    if (!linkedinUrl.trim() && !profileText.trim()) {
      return NextResponse.json(
        { error: "Give me a LinkedIn URL, or paste / upload a résumé — I need one or the other." },
        { status: 400 }
      );
    }

    const result = await assessCandidate({
      userId: user.id,
      linkedinUrl: linkedinUrl.trim() || undefined,
      profileText: profileText.trim() || undefined,
      candidateName: candidateName.trim() || undefined,
      roleLabel: roleLabel.trim() || "AE",
    });

    return NextResponse.json({ ...result, fileName });
  } catch (error) {
    console.error("[candidate-fit] assessment failed:", error);
    // assessCandidate's thrown messages are written for a human ("PDL
    // had no match — paste their résumé instead"), so surface them.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Assessment failed." },
      { status: 500 }
    );
  }
}
