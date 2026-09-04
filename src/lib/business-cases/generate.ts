import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { loadSellerContext, formatSellerContext } from "@/lib/seller-context";
import { loadDiscoveryFramework } from "@/lib/discovery-framework";
import type { BusinessCaseType } from "./constants";
import {
  DEFAULT_DISCOVERY_SUMMARY_TEMPLATE,
  buildDiscoveryTemplatePrompt,
  buildDiscoveryInstancePrompt,
} from "./prompts";

/**
 * Business Cases generation core (Phase 1: discovery_summary).
 *
 * Two layers:
 *  - TEMPLATE generation: playbook assets (seller context + discovery
 *    questions + first-call checklist) → reusable markdown skeleton.
 *  - INSTANCE generation: template + evidence (deal timeline OR
 *    provided transcripts/pasted text) → filled artifact. Deal-
 *    triggered instances also mirror into a DealTimelineEntry
 *    (metadata.instanceId links the pair for edit-sync).
 *
 * Evidence assembly EXCLUDES artifact-type + derived entries so a new
 * Discovery Summary never reads a previous one (or a Deal Chat
 * breadcrumb) as "evidence" and compounds its own output. Primary
 * sources only.
 */

// Timeline entry types that are NOT primary evidence: our own generated
// artifacts, AI-chat breadcrumbs, automatic stage logs, and future
// calendar holds.
const EXCLUDED_EVIDENCE_TYPES = new Set([
  "discovery_summary",
  "roi_model",
  "business_case",
  "chat",
  "stage_change",
  "meeting",
]);

// Keep the evidence block bounded so a transcript-heavy deal doesn't
// blow the context. Matches the ceiling used by the PDF extractor.
const MAX_EVIDENCE_CHARS = 200_000;

export interface TranscriptInput {
  title?: string;
  date?: string;
  content: string;
}

export async function getLatestTemplate(userId: string, type: BusinessCaseType) {
  return prisma.businessCaseTemplate.findFirst({
    where: { userId, type },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Generate (and persist) a fresh template of the given type from the
 * founder's playbook assets. Phase 1: discovery_summary only.
 */
export async function generateTemplate(userId: string, type: BusinessCaseType) {
  if (type !== "discovery_summary") {
    throw new Error(`Template generation for ${type} is not available yet`);
  }

  const [seller, framework] = await Promise.all([
    loadSellerContext(userId),
    loadDiscoveryFramework(userId),
  ]);

  const prompt = buildDiscoveryTemplatePrompt({
    sellerContext: formatSellerContext(seller),
    discoveryQuestions: framework.questionsListing,
    firstCallChecklist: framework.checklist,
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    messages: [{ role: "user", content: prompt }],
  });
  const content = (completion.choices[0]?.message?.content || "").trim();
  if (!content) throw new Error("Empty template returned from model");

  return prisma.businessCaseTemplate.create({
    data: {
      userId,
      type,
      content,
      sourceInputs: {
        discoveryQuestionsVersionId: framework.questionsVersionId,
        firstCallChecklistVersionId: framework.checklistVersionId,
        hasNarrative: !!seller.narrative,
        hasValueProp: !!seller.valueProp100w,
      },
    },
  });
}

/** Save a hand-edited template as a new version row. */
export async function saveTemplate(
  userId: string,
  type: BusinessCaseType,
  content: string
) {
  return prisma.businessCaseTemplate.create({
    data: { userId, type, content },
  });
}

/**
 * Assemble the evidence block for a deal: header facts, participants,
 * then primary-source timeline entries in chronological order. Newest
 * entries win when the size cap forces truncation (the freshest
 * evidence is the most load-bearing for discovery state).
 */
export async function assembleDealEvidence(
  userId: string,
  dealId: string,
  opts?: {
    /** Override the evidence budget. Default 200K chars; the Slack
     *  pre-call deep plan passes 600K so ALL historical transcripts
     *  ride in (matching the deal analyzer's budget). */
    maxChars?: number;
  }
): Promise<{
  deal: { id: string; name: string; companyName: string };
  evidence: string;
  sourceDescription: string;
} | null> {
  const maxChars = opts?.maxChars ?? MAX_EVIDENCE_CHARS;
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, userId },
    include: {
      participants: { orderBy: { createdAt: "asc" } },
      entries: { orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }] },
    },
  });
  if (!deal) return null;

  let evidence = `## Deal: ${deal.name}\n`;
  evidence += `**Company:** ${deal.companyName}\n`;
  evidence += `**Stage:** ${deal.stage} · **Status:** ${deal.status}`;
  if (deal.dealValue) evidence += ` · **Value:** $${deal.dealValue.toLocaleString()}`;
  evidence += `\n\n`;
  if (deal.notes?.trim()) evidence += `**Deal notes:** ${deal.notes.trim()}\n\n`;

  if (deal.participants.length > 0) {
    evidence += `### Participants\n`;
    for (const p of deal.participants) {
      evidence += `- ${p.name}`;
      if (p.title) evidence += ` (${p.title})`;
      if (p.role && p.role !== "unknown") evidence += ` — ${p.role}`;
      evidence += `\n`;
    }
    evidence += `\n`;
  }

  const usable = deal.entries.filter((e) => !EXCLUDED_EVIDENCE_TYPES.has(e.type));
  // Walk newest→oldest accumulating until the cap, then restore
  // chronological order for the prompt.
  const kept: typeof usable = [];
  let used = evidence.length;
  for (const e of usable) {
    const block = `#### ${new Date(e.entryDate).toISOString().slice(0, 10)} — ${e.type}${e.title ? `: ${e.title}` : ""}\n${e.content}\n\n`;
    if (used + block.length > maxChars) break;
    used += block.length;
    kept.push(e);
  }
  kept.reverse();

  evidence += `### Timeline (chronological)\n\n`;
  for (const e of kept) {
    evidence += `#### ${new Date(e.entryDate).toISOString().slice(0, 10)} — ${e.type}${e.title ? `: ${e.title}` : ""}\n${e.content}\n\n`;
  }
  const omitted = usable.length - kept.length;
  if (omitted > 0) {
    evidence += `_(${omitted} older timeline entr${omitted === 1 ? "y" : "ies"} omitted for length.)_\n`;
  }

  const transcriptCount = usable.filter((e) => e.type === "call_transcript").length;
  const sourceDescription = `${usable.length} timeline entr${usable.length === 1 ? "y" : "ies"}${transcriptCount ? ` incl. ${transcriptCount} call transcript${transcriptCount === 1 ? "" : "s"}` : ""}`;

  return {
    deal: { id: deal.id, name: deal.name, companyName: deal.companyName },
    evidence,
    sourceDescription,
  };
}

/** Format ad-hoc evidence (pasted text and/or picked calls). */
function formatAdHocEvidence(
  transcripts: TranscriptInput[] | undefined,
  extraText: string | undefined
): { evidence: string; sourceDescription: string } {
  let evidence = "";
  let count = 0;
  for (const t of transcripts || []) {
    if (!t.content?.trim()) continue;
    count++;
    evidence += `#### Call${t.title ? `: ${t.title}` : ` ${count}`}${t.date ? ` (${t.date.slice(0, 10)})` : ""}\n${t.content.trim()}\n\n`;
  }
  if (extraText?.trim()) {
    evidence += `#### Additional context (pasted)\n${extraText.trim()}\n\n`;
  }
  if (evidence.length > MAX_EVIDENCE_CHARS) {
    evidence = evidence.slice(0, MAX_EVIDENCE_CHARS) + "\n\n_(truncated for length)_\n";
  }
  const bits: string[] = [];
  if (count) bits.push(`${count} call transcript${count === 1 ? "" : "s"}`);
  if (extraText?.trim()) bits.push("pasted context");
  return { evidence, sourceDescription: bits.join(" + ") || "provided content" };
}

/**
 * Generate a filled instance. When dealId is provided, evidence comes
 * from the deal timeline AND the result mirrors into a timeline entry.
 * Provided transcripts/extraText are appended in either mode (so
 * "deal + these two new calls" works).
 */
export async function generateInstance(opts: {
  userId: string;
  type: BusinessCaseType;
  dealId?: string | null;
  transcripts?: TranscriptInput[];
  extraText?: string;
  title?: string;
}) {
  const { userId, type } = opts;
  if (type !== "discovery_summary") {
    throw new Error(`Generation for ${type} is not available yet`);
  }

  // Template: latest authored/generated version. First run with no
  // template AUTO-BOOTSTRAPS one from the founder's playbook (one
  // extra model call, ~20s) so even the very first summary is shaped
  // by their discovery framework rather than a generic skeleton — the
  // bootstrapped template lands in the applet for review/edit like
  // any other version. The built-in default skeleton remains only as
  // the last-resort fallback if bootstrap itself fails (e.g. OpenAI
  // hiccup) — evidence-filling should never die on the template step.
  let template = await getLatestTemplate(userId, type);
  if (!template) {
    try {
      template = await generateTemplate(userId, type);
      console.log(
        `[business-cases] auto-bootstrapped ${type} template for user ${userId}`
      );
    } catch (err) {
      console.error(
        `[business-cases] template bootstrap failed, using default skeleton:`,
        err
      );
    }
  }
  const templateContent = template?.content || DEFAULT_DISCOVERY_SUMMARY_TEMPLATE;

  const seller = await loadSellerContext(userId);

  let evidence = "";
  const sourceBits: string[] = [];
  let dealInfo: { id: string; name: string; companyName: string } | null = null;

  if (opts.dealId) {
    const assembled = await assembleDealEvidence(userId, opts.dealId);
    if (!assembled) throw new Error("Deal not found");
    dealInfo = assembled.deal;
    evidence += assembled.evidence;
    sourceBits.push(assembled.sourceDescription);
  }
  const adHoc = formatAdHocEvidence(opts.transcripts, opts.extraText);
  if (adHoc.evidence) {
    evidence += (evidence ? "\n---\n\n### Additional provided evidence\n\n" : "") + adHoc.evidence;
    sourceBits.push(adHoc.sourceDescription);
  }
  if (!evidence.trim()) {
    throw new Error("No evidence provided — attach a deal, pick calls, or paste transcripts");
  }

  const today = new Date().toISOString().slice(0, 10);
  const prompt = buildDiscoveryInstancePrompt({
    template: templateContent,
    sellerContext: formatSellerContext(seller),
    evidence: `_Generated ${today}. Sources: ${sourceBits.join("; ")}._\n\n${evidence}`,
    companyName: dealInfo?.companyName,
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-5.5",
    messages: [{ role: "user", content: prompt }],
  });
  const content = (completion.choices[0]?.message?.content || "").trim();
  if (!content) throw new Error("Empty document returned from model");

  const title =
    opts.title?.trim() ||
    (dealInfo ? `${dealInfo.companyName} — Discovery Summary` : `Discovery Summary — ${today}`);

  const instance = await prisma.businessCaseInstance.create({
    data: {
      userId,
      type,
      templateId: template?.id ?? null,
      dealId: dealInfo?.id ?? null,
      title,
      content,
      sourceContext: sourceBits.join("; "),
    },
  });

  // Mirror deal-triggered artifacts onto the timeline so they join
  // Deal Chat context + analysis. metadata.instanceId is the edit-sync
  // link; regeneration creates a NEW pair (old one stays as history).
  let timelineEntryId: string | null = null;
  if (dealInfo) {
    const entry = await prisma.dealTimelineEntry.create({
      data: {
        dealId: dealInfo.id,
        type,
        title,
        content,
        sourceUrl: `/business-cases?instance=${instance.id}`,
        metadata: JSON.stringify({
          instanceId: instance.id,
          templateId: template?.id ?? null,
        }),
        entryDate: new Date(),
      },
    });
    timelineEntryId = entry.id;
  }

  return { instance, timelineEntryId };
}

/**
 * Update an instance's content/title and sync the mirrored timeline
 * entry (matched via metadata.instanceId) so the deal timeline never
 * shows a stale artifact.
 */
export async function updateInstance(
  userId: string,
  instanceId: string,
  patch: { title?: string; content?: string }
) {
  const existing = await prisma.businessCaseInstance.findFirst({
    where: { id: instanceId, userId },
  });
  if (!existing) return null;

  const data: { title?: string; content?: string } = {};
  if (patch.title !== undefined && patch.title.trim()) data.title = patch.title.trim();
  if (patch.content !== undefined) data.content = patch.content;
  const instance = await prisma.businessCaseInstance.update({
    where: { id: instanceId },
    data,
  });

  if (existing.dealId) {
    // Find the mirrored entry by scanning this deal's artifact entries
    // for our instanceId (metadata is a JSON string column).
    const entries = await prisma.dealTimelineEntry.findMany({
      where: { dealId: existing.dealId, type: existing.type },
      select: { id: true, metadata: true },
    });
    for (const e of entries) {
      try {
        const m = JSON.parse(e.metadata || "{}");
        if (m.instanceId === instanceId) {
          await prisma.dealTimelineEntry.update({
            where: { id: e.id },
            data: { title: instance.title, content: instance.content },
          });
          break;
        }
      } catch {
        /* unparseable metadata — skip */
      }
    }
  }

  return instance;
}
