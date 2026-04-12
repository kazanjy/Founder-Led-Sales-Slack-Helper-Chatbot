import { MeetingRecorderProvider, MeetingCall, MeetingCallDetail } from "./interface";

// Fathom OAuth2 + REST API integration
// Docs: https://developers.fathom.ai
// OAuth: https://developers.fathom.ai/oauth

const API_BASE = "https://api.fathom.video/v1";
const AUTH_URL = "https://fathom.video/external/v1/oauth2/authorize";
const TOKEN_URL = "https://fathom.video/external/v1/oauth2/token";

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

async function fathomFetch(path: string, accessToken: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
}

interface FathomMeeting {
  id: string;
  title: string;
  created_at: string;
  duration?: number;
  attendees?: Array<{ name: string; email?: string }>;
  recording_id?: string;
}

export const fathomProvider: MeetingRecorderProvider = {
  name: "Fathom",
  slug: "fathom",
  icon: "🎥",
  authType: "oauth2",

  async validateKey(accessToken: string) {
    try {
      const res = await fathomFetch("/meetings?limit=1", accessToken);
      if (res.ok) {
        return { valid: true };
      }
      if (res.status === 401 || res.status === 403) {
        return { valid: false, error: "Invalid or expired token" };
      }
      return { valid: false, error: `API error: ${res.status}` };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  async listCalls(accessToken: string, limit = 15): Promise<MeetingCall[]> {
    const res = await fathomFetch(`/meetings?limit=${limit}`, accessToken);
    if (!res.ok) {
      throw new Error(`Failed to fetch meetings: ${res.status}`);
    }

    const data = await res.json();
    const meetings: FathomMeeting[] = data.meetings || data.data || data || [];

    return (Array.isArray(meetings) ? meetings : []).map((m) => ({
      id: m.recording_id || m.id,
      title: m.title || "Untitled Meeting",
      date: m.created_at,
      duration: m.duration,
      participants: m.attendees?.map((a: { name: string }) => a.name) || [],
      attendees: m.attendees?.map((a: { name: string; email?: string }) => ({ name: a.name, email: a.email })) || [],
      providerUrl: `https://fathom.video/share/${m.recording_id || m.id}`,
    }));
  },

  async getCallDetail(accessToken: string, callId: string): Promise<MeetingCallDetail> {
    // Fetch transcript and summary in parallel
    const [transcriptRes, summaryRes] = await Promise.all([
      fathomFetch(`/recordings/${callId}/transcript`, accessToken),
      fathomFetch(`/recordings/${callId}/summary`, accessToken),
    ]);

    let transcript = "";
    if (transcriptRes.ok) {
      const tData = await transcriptRes.json();
      // Handle various transcript formats
      if (typeof tData === "string") {
        transcript = tData;
      } else if (tData.transcript) {
        transcript = typeof tData.transcript === "string"
          ? tData.transcript
          : (tData.transcript.segments || [])
              .map((s: { speaker: string; text: string }) => `${s.speaker}: ${s.text}`)
              .join("\n\n");
      } else if (Array.isArray(tData)) {
        transcript = tData
          .map((s: { speaker?: string; text: string }) => s.speaker ? `${s.speaker}: ${s.text}` : s.text)
          .join("\n\n");
      }
    }

    let summary = "";
    let actionItems: string[] | undefined;
    if (summaryRes.ok) {
      const sData = await summaryRes.json();
      summary = sData.summary || sData.overview || "";
      if (sData.action_items) {
        actionItems = Array.isArray(sData.action_items) ? sData.action_items : [sData.action_items];
      }
    }

    return {
      id: callId,
      title: "Fathom Recording",
      date: new Date().toISOString(),
      participants: [],
      transcript,
      summary,
      actionItems,
      providerUrl: `https://fathom.video/share/${callId}`,
    };
  },
};
