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

Rules:
- Company Name: The prospect/customer company name (not the seller's company). Infer from attendee emails, titles, companies, or call titles. Use proper capitalization.
- Deal Name: A short, descriptive name for the sales opportunity (e.g., "Acme - Platform Migration", "TechCorp - Enterprise Pilot"). Include the company name and a brief descriptor of the opportunity.
- If you can't determine the company, return your best guess based on attendee names or call titles.

Respond with ONLY a JSON object: {"companyName": "...", "dealName": "..."}`,
        },
        {
          role: "user",
          content: callSummaries.substring(0, 3000),
        },
      ],
      max_completion_tokens: 100,
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
