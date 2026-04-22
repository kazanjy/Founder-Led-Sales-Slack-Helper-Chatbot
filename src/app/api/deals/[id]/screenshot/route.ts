import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

interface MatchedParticipant {
  id: string;
  name: string;
}

interface SuggestedPerson {
  name: string;
  title?: string;
  email?: string;
  reason?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const deal = await prisma.deal.findUnique({
      where: { id },
      include: {
        participants: {
          select: { id: true, name: true, title: true, email: true, company: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!deal || deal.userId !== user.id) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const { imageBase64, mimeType } = (await request.json()) as {
      imageBase64: string;
      mimeType: string;
    };

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    // Build a compact participant roster the model can use to resolve speakers.
    const userLabel = user.name || user.email || "Deal Owner";
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10); // YYYY-MM-DD
    const participantRoster = deal.participants.length
      ? deal.participants
          .map((p) => {
            const bits: string[] = [`- id=${p.id} name="${p.name}"`];
            if (p.title) bits.push(`title="${p.title}"`);
            if (p.email) bits.push(`email="${p.email}"`);
            if (p.company) bits.push(`company="${p.company}"`);
            return bits.join(" ");
          })
          .join("\n")
      : "(no participants on this deal yet)";

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are extracting text content from a screenshot related to a B2B sales deal — typically an iMessage, WhatsApp, Slack, LinkedIn, or email conversation, or a CRM/doc excerpt. Your job is BOTH to extract the text AND to attribute each message to the correct person.

Today's date is ${todayIso}. If a timestamp shows only a month and day (e.g. "April 20", "Apr 20 at 3:14pm") with no visible year, assume the CURRENT year (${today.getFullYear()}). Only use a different year if the screenshot clearly shows one (e.g. "Apr 20, 2024"). Never default to a year before ${today.getFullYear() - 1} unless the screenshot explicitly says so.

## Deal context

The person who captured this screenshot (the deal owner, referred to below as "OWNER") is:
${userLabel}${user.email ? ` <${user.email}>` : ""}

Known participants already on this deal — match conversation speakers to these when possible:
${participantRoster}

## Attribution rules

- In iMessage/WhatsApp/Slack screenshots: the blue/right-aligned bubbles belong to OWNER (the person whose phone this is). The gray/left-aligned bubbles belong to the other party, whose name is usually in the header of the thread.
- If you can tell who the other party is (thread header, email "From:" line, Slack name prefix, etc.), try to match them to one of the known participants above by name or email. Use fuzzy matching — first-name-only is fine if unambiguous.
- In emails: attribute based on "From:", "To:", and signature blocks.
- Use canonical names in the output: "You" for OWNER's messages, and the full participant name (from the roster) for messages from known people. For unknown speakers, use the name as shown in the screenshot.

## Response format

Your response MUST start with one line of JSON and nothing else on that line, then a blank line, then the extracted text:

Line 1: {"title": "...", "date": "YYYY-MM-DD" or null, "matchedParticipantIds": ["..."], "newPeople": [{"name": "...", "email": "..." or null, "reason": "..."}]}

- title: a concise one-line label (e.g. "iMessage thread with Deepa — procurement sync"). Under 80 chars.
- date: the date of the interaction if visible, in YYYY-MM-DD. null if no date is visible.
- matchedParticipantIds: array of ids (from the roster above) that appear as speakers/recipients in the screenshot. Empty array if none match.
- newPeople: array of people who are NOT in the roster but clearly appear as speakers, recipients, or named participants in the conversation. Do NOT include OWNER. Each entry: {name, email (if visible), reason (short phrase explaining where they appeared, e.g. "recipient of iMessage thread", "cc'd on email")}. Empty array if none.

Then a blank line, then the full attributed transcript. Format each message as "Speaker: message" on its own line or paragraph. Preserve timestamps where visible.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract and attribute all text from this screenshot:" },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType || "image/png"};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_completion_tokens: 2500,
      temperature: 0.2,
    });

    const extractedText = response.choices[0]?.message?.content?.trim() || "";
    if (!extractedText) {
      return NextResponse.json({ error: "Could not extract text from image" }, { status: 422 });
    }

    // Parse the JSON metadata line
    const lines = extractedText.split("\n");
    let title = "Screenshot";
    let date: string | null = null;
    let matchedParticipantIds: string[] = [];
    let newPeople: SuggestedPerson[] = [];
    let contentStartIndex = 0;

    try {
      const firstLine = lines[0]?.trim();
      if (firstLine?.startsWith("{")) {
        const meta = JSON.parse(firstLine);
        title = typeof meta.title === "string" ? meta.title : "Screenshot";
        date = meta.date || null;
        if (Array.isArray(meta.matchedParticipantIds)) {
          matchedParticipantIds = meta.matchedParticipantIds.filter(
            (pid: unknown): pid is string =>
              typeof pid === "string" && deal.participants.some((p) => p.id === pid),
          );
        }
        if (Array.isArray(meta.newPeople)) {
          newPeople = (meta.newPeople as unknown[])
            .filter(
              (p): p is Record<string, unknown> =>
                !!p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string",
            )
            .map((p: Record<string, unknown>) => ({
              name: String(p.name).trim(),
              email: typeof p.email === "string" ? p.email : undefined,
              reason: typeof p.reason === "string" ? p.reason : undefined,
            }))
            .filter((p) => p.name.length > 0);
        }
        contentStartIndex = 1;
        if (lines[contentStartIndex]?.trim() === "") contentStartIndex++;
      } else {
        title = firstLine?.replace(/^#+\s*/, "").trim() || "Screenshot";
        contentStartIndex = 1;
      }
    } catch {
      title = lines[0]?.replace(/^#+\s*/, "").trim() || "Screenshot";
      contentStartIndex = 1;
    }

    // Drop any suggested person whose name matches an existing participant
    // (case-insensitive), in case the model missed the match.
    const existingNames = new Set(
      deal.participants.map((p) => p.name.trim().toLowerCase()),
    );
    newPeople = newPeople.filter((p) => !existingNames.has(p.name.toLowerCase()));

    const matched: MatchedParticipant[] = deal.participants
      .filter((p) => matchedParticipantIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name }));

    const content = lines.slice(contentStartIndex).join("\n").trim() || extractedText;

    return NextResponse.json({
      title,
      content,
      date,
      matchedParticipants: matched,
      suggestedParticipants: newPeople,
    });
  } catch (error) {
    console.error("Error processing screenshot:", error);
    return NextResponse.json({ error: "Failed to process screenshot" }, { status: 500 });
  }
}
