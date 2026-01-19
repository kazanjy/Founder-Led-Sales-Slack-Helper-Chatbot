import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { handleSlackEvent } from "@/lib/slack/events";

export async function POST(request: NextRequest) {
  const body = await request.text();

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    console.error("Failed to parse JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log("Slack event received:", {
    type: payload.type,
    eventType: payload.event?.type,
    teamId: payload.team_id,
  });

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
  } else {
    console.warn("SLACK_SIGNING_SECRET not set - skipping signature verification");
  }

  // Handle events
  if (payload.type === "event_callback") {
    console.log("Processing event_callback:", {
      eventType: payload.event?.type,
      user: payload.event?.user,
      channel: payload.event?.channel,
      text: payload.event?.text?.substring(0, 50),
    });

    // Respond immediately to Slack (3 second timeout requirement)
    // Process the event asynchronously
    handleSlackEvent(payload).catch((error) => {
      console.error("Error handling Slack event:", error);
    });

    return NextResponse.json({ ok: true });
  }

  console.log("Unhandled payload type:", payload.type);
  return NextResponse.json({ ok: true });
}
