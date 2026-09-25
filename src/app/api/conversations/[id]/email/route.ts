import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

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
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    // Get the conversation with messages
    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Format messages as HTML
    const messagesHtml = conversation.messages
      .map((msg) => {
        const isUser = msg.role === "USER";
        const bgColor = isUser ? "#f3f4f6" : "#eff6ff";
        const label = isUser ? "You" : "Mikey";
        const labelColor = isUser ? "#374151" : "#2563eb";

        // Convert markdown-style formatting to HTML
        const formattedContent = msg.content
          .replace(/\n/g, "<br>")
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.*?)\*/g, "<em>$1</em>")
          .replace(/`(.*?)`/g, "<code style=\"background:#e5e7eb;padding:2px 4px;border-radius:3px;\">$1</code>");

        return `
          <div style="margin-bottom: 16px; padding: 16px; background-color: ${bgColor}; border-radius: 8px;">
            <div style="font-weight: 600; color: ${labelColor}; margin-bottom: 8px;">${label}</div>
            <div style="color: #374151; line-height: 1.6;">${formattedContent}</div>
          </div>
        `;
      })
      .join("");

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://askmikey.ai";
    const conversationTitle = conversation.title || "Mikey Conversation";
    const conversationDate = new Date(conversation.createdAt).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <img src="${appUrl}/mikey-avatar.png" alt="Mikey" style="width: 64px; height: 64px; border-radius: 12px;">
          </div>

          <h1 style="color: #111827; font-size: 24px; margin-bottom: 8px; text-align: center;">
            ${conversationTitle}
          </h1>

          <p style="color: #6b7280; text-align: center; margin-bottom: 24px;">
            ${conversationDate}
          </p>

          <div style="border-top: 1px solid #e5e7eb; padding-top: 24px;">
            ${messagesHtml}
          </div>

          <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
            <a href="${appUrl}/chat/${conversation.id}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Continue this conversation
            </a>
          </div>

          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 32px;">
            Sent from <a href="${appUrl}" style="color: #2563eb;">Mikey</a> - Your AI Founder-Led Sales Assistant
          </p>
        </body>
      </html>
    `;

    // Send the email
    const { error } = await resend.emails.send({
      from: "Mikey <onboarding@resend.dev>",
      to: email,
      subject: `${conversationTitle} - Mikey Conversation`,
      html: emailHtml,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error emailing conversation:", error);
    return NextResponse.json({ error: "Failed to email conversation" }, { status: 500 });
  }
}
