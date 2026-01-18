import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { handleSlackEvent } from "@/lib/slack/events";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp") || "";
  const signature = request.headers.get("x-slack-signature") || "";

  // Verify the request is from Slack
  if (process.env.NODE_ENV === "production") {
    const isValid = verifySlackRequest(body, timestamp, signature);
    if (!isValid) {
      console.error("Invalid Slack signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const payload = JSON.parse(body);

  // Handle URL verification challenge (for initial setup)
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Handle events
  if (payload.type === "event_callback") {
    // Respond immediately to Slack (3 second timeout requirement)
    // Process the event asynchronously
    handleSlackEvent(payload).catch((error) => {
      console.error("Error handling Slack event:", error);
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
