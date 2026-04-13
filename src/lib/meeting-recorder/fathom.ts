import { MeetingRecorderProvider, MeetingCall, MeetingCallDetail } from "./interface";

// Fathom REST API integration
// Docs: https://developers.fathom.ai
// API reference: https://api-docs.fathom.global/reference/rest.html

const API_BASE = "https://api.fathom.ai/external/v1";
const AUTH_URL = "https://fathom.video/external/v1/oauth2/authorize";
const TOKEN_URL = "https://api.fathom.ai/external/v1/oauth2/token";

export function getFathomAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.FATHOM_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "public_api",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeFathomCode(code: string, redirectUri: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: process.env.FATHOM_CLIENT_ID || "",
      client_secret: process.env.FATHOM_CLIENT_SECRET || "",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fathom token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function refreshFathomToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.FATHOM_CLIENT_ID || "",
      client_secret: process.env.FATHOM_CLIENT_SECRET || "",
    }),
  });

  if (!res.ok) {
    throw new Error(`Fathom token refresh failed: ${res.status}`);
  }

  return res.json();
}

async function fathomFetch(path: string, token: string): Promise<Response> {
  // Detect token type: OAuth tokens are typically longer JWT-style, API keys are shorter
  const isOAuthToken = token.length > 50 || token.includes(".");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isOAuthToken) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    headers["X-Api-Key"] = token;
  }
  console.log(`[Fathom] fetch ${path} | auth: ${isOAuthToken ? "Bearer" : "X-Api-Key"} | token prefix: ${token.substring(0, 10)}...`);
  return fetch(`${API_BASE}${path}`, { headers });
}

// ── Fathom API types ──────────────────────────────────────────

interface FathomInvitee {
  name?: string;
  email?: string;
  email_domain?: string;
  is_external?: boolean;
  matched_speaker_display_name?: string;
}

interface FathomTranscriptEntry {
  speaker: {
    display_name: string;
    matched_calendar_invitee_email?: string;
  };
  text: string;
  timestamp?: string;
}

interface FathomActionItem {
  description: string;
  completed?: boolean;
  assignee?: { name?: string; email?: string };
}

interface FathomMeeting {
  title: string;
  meeting_title?: string;
  recording_id: number;
  url?: string;
  share_url?: string;
  created_at: string;
  scheduled_start_time?: string;
  recording_start_time?: string;
  recording_end_time?: string;
  calendar_invitees?: FathomInvitee[];
  recorded_by?: { name?: string; email?: string };
  transcript?: FathomTranscriptEntry[];
  default_summary?: {
    template_name?: string;
    markdown_formatted?: string;
  };
  action_items?: FathomActionItem[];
}

// Cache list results so getCallDetail can pull from them
let cachedMeetings: Map<string, FathomMeeting> = new Map();

export const fathomProvider: MeetingRecorderProvider = {
  name: "Fathom",
  slug: "fathom",
  icon: "🎥",
  authType: "oauth2",

  async validateKey(apiKey: string) {
    try {
      const res = await fathomFetch("/meetings?limit=1", apiKey);
      if (res.ok) {
        return { valid: true };
      }
      if (res.status === 401 || res.status === 403) {
        return { valid: false, error: "Invalid or expired API key" };
      }
      return { valid: false, error: `API error: ${res.status}` };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  async listCalls(apiKey: string, limit = 15): Promise<MeetingCall[]> {
    const allMeetings: FathomMeeting[] = [];
    let cursor: string | undefined;

    // Fathom uses cursor pagination
    while (allMeetings.length < limit) {
      const pageSize = Math.min(limit - allMeetings.length, 25);
      let url = `/meetings?limit=${pageSize}&include_transcript=true`;
      if (cursor) url += `&cursor=${cursor}`;

      const res = await fathomFetch(url, apiKey);
      if (!res.ok) {
        const text = await res.text();
        console.error(`[Fathom] listCalls failed: ${res.status} ${text}`);
        throw new Error(`Failed to fetch meetings: ${res.status}`);
      }

      const data = await res.json();
      const meetings: FathomMeeting[] = data.items || [];
      allMeetings.push(...meetings);

      if (!data.next_cursor || meetings.length === 0) break;
      cursor = data.next_cursor;
    }

    // Cache for getCallDetail
    cachedMeetings = new Map();
    for (const m of allMeetings) {
      cachedMeetings.set(String(m.recording_id), m);
    }

    console.log(`[Fathom] Found ${allMeetings.length} meetings`);

    return allMeetings.map((m) => {
      const recId = String(m.recording_id);
      const invitees = m.calendar_invitees || [];
      return {
        id: recId,
        title: m.meeting_title || m.title || "Untitled Meeting",
        date: m.created_at,
        participants: invitees.map((a) => a.name || a.email || "Unknown"),
        attendees: invitees.map((a) => ({ name: a.name || a.email || "Unknown", email: a.email })),
        summary: m.default_summary?.markdown_formatted || undefined,
        providerUrl: m.share_url || m.url || `https://fathom.video/calls/${recId}`,
      };
    });
  },

  async getCallDetail(apiKey: string, callId: string): Promise<MeetingCallDetail> {
    // Check cache first — the list endpoint returns full data including transcript
    const cached = cachedMeetings.get(callId);
    if (cached?.transcript && cached.transcript.length > 0) {
      return buildCallDetail(cached, callId);
    }

    // Fetch transcript and summary from dedicated endpoints
    const [transcriptRes, summaryRes] = await Promise.all([
      fathomFetch(`/recordings/${callId}/transcript`, apiKey),
      fathomFetch(`/recordings/${callId}/summary`, apiKey),
    ]);

    let transcriptEntries: FathomTranscriptEntry[] = [];
    if (transcriptRes.ok) {
      const tData = await transcriptRes.json();
      transcriptEntries = tData.transcript || [];
    }

    let summaryText = "";
    let actionItems: string[] | undefined;
    if (summaryRes.ok) {
      const sData = await summaryRes.json();
      summaryText = sData.summary?.markdown_formatted || "";
    }

    // Use cached metadata if available, otherwise minimal
    const meta = cached || null;
    const invitees = meta?.calendar_invitees || [];

    // Extract action items from cache if available
    if (meta?.action_items) {
      actionItems = meta.action_items
        .filter((a) => a.description)
        .map((a) => a.description);
    }

    const transcript = transcriptEntries
      .map((entry) => `${entry.speaker.display_name}: ${entry.text}`)
      .join("\n\n");

    return {
      id: callId,
      title: meta?.meeting_title || meta?.title || "Fathom Recording",
      date: meta?.created_at || new Date().toISOString(),
      participants: invitees.map((a) => a.name || a.email || "Unknown"),
      attendees: invitees.map((a) => ({ name: a.name || a.email || "Unknown", email: a.email })),
      transcript,
      summary: summaryText,
      actionItems,
      providerUrl: meta?.share_url || meta?.url || `https://fathom.video/calls/${callId}`,
    };
  },
};

function buildCallDetail(m: FathomMeeting, callId: string): MeetingCallDetail {
  const transcript = (m.transcript || [])
    .map((entry) => `${entry.speaker.display_name}: ${entry.text}`)
    .join("\n\n");

  const invitees = m.calendar_invitees || [];
  const actionItems = m.action_items
    ?.filter((a) => a.description)
    .map((a) => a.description) || undefined;

  return {
    id: callId,
    title: m.meeting_title || m.title || "Fathom Recording",
    date: m.created_at,
    participants: invitees.map((a) => a.name || a.email || "Unknown"),
    attendees: invitees.map((a) => ({ name: a.name || a.email || "Unknown", email: a.email })),
    transcript,
    summary: m.default_summary?.markdown_formatted || "",
    actionItems,
    providerUrl: m.share_url || m.url || `https://fathom.video/calls/${callId}`,
  };
}
