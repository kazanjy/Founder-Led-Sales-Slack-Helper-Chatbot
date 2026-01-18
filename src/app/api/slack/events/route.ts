import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { handleSlackEvent } from "@/lib/slack/events";

export async function POST(request: NextRequest) {
  const body = await request.text();

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Handle URL verification challenge FIRST (before signature verification)
  // This is needed for initial Slack app setup
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Now verify the request is from Slack for all other requests
  const timestamp = request.headers.get("x-slack-request-timestamp") || "";
  const signature = request.headers.get("x-slack-signature") || "";

  if (process.env.SLACK_SIGNING_SECRET) {
    const isValid = verifySlackRequest(body, timestamp, signature);
    if (!isValid) {
      console.error("Invalid Slack signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
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
