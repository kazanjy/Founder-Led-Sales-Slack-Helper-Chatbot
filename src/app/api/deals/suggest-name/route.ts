import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { openai } from "@/lib/openai";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { calls } = (await request.json()) as {
      calls: Array<{
        title?: string;
        date?: string;
        attendees?: Array<{ name: string; email?: string; title?: string; company?: string }>;
        summary?: string;
      }>;
    };

    if (!calls?.length) {
      return NextResponse.json({ error: "No calls provided" }, { status: 400 });
    }

    const callSummaries = calls.map((c, i) => {
      const parts = [`Call ${i + 1}: ${c.title || "Untitled"}`];
      if (c.date) parts.push(`Date: ${new Date(c.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
      if (c.attendees?.length) {
        const people = c.attendees.map((a) => {
          const info = [a.name];
          if (a.title) info.push(a.title);
          if (a.company) info.push(`@ ${a.company}`);
          if (a.email) info.push(`(${a.email})`);
          return info.join(", ");
        });
        parts.push(`Attendees: ${people.join("; ")}`);
      }
      if (c.summary) parts.push(`Summary: ${c.summary.substring(0, 300)}`);
      return parts.join("\n");
    }).join("\n\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a CRM assistant. Given metadata from one or more sales calls, suggest a company name and deal name for a sales deal tracker.

## What the deal name is
A short, durable label for the sales OPPORTUNITY — the thing the seller is working to close. It should stay stable across dozens of interactions (calls, emails, screenshots) over weeks or months.

## Naming rules
- Company Name: the PROSPECT company (not the seller's company). Infer from attendee emails, titles, and company fields. Proper capitalization.
- Deal Name format: "{Prospect Company} — {brief opportunity descriptor}". Use an em dash. Descriptor is 2-4 words.
  * Good: "Visana — Enterprise Pilot", "DoorDash — Accruals Migration", "inDrive — Mesh Expansion", "Acme — Platform Rollout"
- Good descriptors reference the product/motion/stage/outcome: "Enterprise Pilot", "Platform Rollout", "Accruals Migration", "Design Partner", "New Business", "Renewal Expansion", "POC Evaluation".

## Hard "do not"s
- DO NOT use the call title as the deal name. Call titles describe a single meeting; deal names describe the whole opportunity.
- DO NOT include meeting-shaped tokens: "Check-In", "Sync", "Kickoff Call", "Intro Call", "Weekly", "Standup", "Follow-up Call", "1:1".
- DO NOT include bracketed tags from the call title: "[HOLD]", "[INTERNAL]", "[DRAFT]", etc.
- DO NOT include "<>" / "x" / "&" seller↔buyer constructions from meeting titles (e.g. "Acme <> Mesh", "Acme x Mesh").
- DO NOT include dates, times, or sequence numbers.
- If the calls don't give you enough to infer a real opportunity descriptor, fall back to "{Prospect Company} — New Business".

## Examples of transformation
- Call title "[HOLD] inDrive <> Mesh - Check-In"  ->  Deal Name "inDrive — Mesh Expansion" (or "inDrive — New Business" if no clear product hook)
- Call title "Acme / TechCorp Weekly Sync"         ->  Deal Name "TechCorp — Platform Rollout"
- Call title "Discovery — Visana Health"           ->  Deal Name "Visana — Enterprise Pilot"

Respond with ONLY a JSON object: {"companyName": "...", "dealName": "..."}`,
        },
        {
          role: "user",
          content: callSummaries.substring(0, 3000),
        },
      ],
      max_completion_tokens: 120,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content?.trim() || "";
    try {
      const parsed = JSON.parse(content);
      return NextResponse.json({
        companyName: parsed.companyName || "",
        dealName: parsed.dealName || "",
      });
    } catch {
      return NextResponse.json({ companyName: "", dealName: "" });
    }
  } catch (error) {
    console.error("Error suggesting deal name:", error);
    return NextResponse.json({ companyName: "", dealName: "" });
  }
}
