import { NextRequest, NextResponse } from "next/server";
import { sendToChatbase } from "@/lib/chatbase/client";

export async function GET(request: NextRequest) {
  const message = request.nextUrl.searchParams.get("message") || "What is founder-led sales?";

  // Check if env vars are set
  const hasApiKey = !!process.env.CHATBASE_API_KEY;
  const hasChatbotId = !!process.env.CHATBASE_CHATBOT_ID;

  if (!hasApiKey || !hasChatbotId) {
    return NextResponse.json({
      error: "Missing environment variables",
      CHATBASE_API_KEY: hasApiKey ? "set" : "MISSING",
      CHATBASE_CHATBOT_ID: hasChatbotId ? "set" : "MISSING",
    }, { status: 500 });
  }

  try {
    const result = await sendToChatbase(message);
    return NextResponse.json({
      success: true,
      message,
      response: result.response,
      conversationId: result.conversationId,
    });
  } catch (error) {
    return NextResponse.json({
      error: "Chatbase API error",
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
