import { MeetingRecorderProvider, MeetingCall, MeetingCallDetail } from "./interface";

const GRAPHQL_URL = "https://api.fireflies.ai/graphql";

async function firefliesQuery(apiKey: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Fireflies API error: ${res.status}`);
  }
  const data = await res.json();
  if (data.errors?.length) {
    throw new Error(data.errors[0].message || "GraphQL error");
  }
  return data.data;
}

export const firefliesProvider: MeetingRecorderProvider = {
  name: "Fireflies",
  slug: "fireflies",
  icon: "🔥",
  authType: "api_key",

  async validateKey(apiKey: string) {
    try {
      const data = await firefliesQuery(apiKey, `{ user { email name } }`);
      if (data?.user) {
        return { valid: true, accountId: data.user.email || undefined };
      }
      return { valid: false, error: "Could not verify account" };
    } catch (error) {
      if (error instanceof Error && error.message.includes("401")) {
        return { valid: false, error: "Invalid API key" };
      }
      return { valid: false, error: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  async listCalls(apiKey: string, limit = 15): Promise<MeetingCall[]> {
    const data = await firefliesQuery(apiKey, `
      query ListTranscripts($limit: Int) {
        transcripts(limit: $limit) {
          id
          title
          date
          duration
          participants
          transcript_url
          summary {
            overview
          }
        }
      }
    `, { limit });

    const transcripts = data?.transcripts || [];

    return transcripts.map((t: {
      id: string;
      title: string;
      date: string;
      duration: number;
      participants: string[];
      transcript_url: string;
      summary?: { overview?: string };
    }) => ({
      id: t.id,
      title: t.title || "Untitled Meeting",
      date: t.date ? new Date(Number(t.date)).toISOString() : new Date().toISOString(),
      duration: t.duration ? Math.round(t.duration / 1000) : undefined,
      participants: t.participants || [],
      summary: t.summary?.overview || undefined,
      providerUrl: t.transcript_url || `https://app.fireflies.ai/view/${t.id}`,
    }));
  },

  async getCallDetail(apiKey: string, callId: string): Promise<MeetingCallDetail> {
    const data = await firefliesQuery(apiKey, `
      query GetTranscript($id: String!) {
        transcript(id: $id) {
          id
          title
          date
          duration
          participants
          transcript_url
          sentences {
            speaker_name
            text
          }
          summary {
            overview
            action_items
          }
        }
      }
    `, { id: callId });

    const t = data?.transcript;
    if (!t) throw new Error("Transcript not found");

    // Build transcript from sentences with speaker attribution
    const transcript = (t.sentences || [])
      .map((s: { speaker_name: string; text: string }) => `${s.speaker_name}: ${s.text}`)
      .join("\n\n");

    return {
      id: t.id,
      title: t.title || "Untitled Meeting",
      date: t.date ? new Date(Number(t.date)).toISOString() : new Date().toISOString(),
      duration: t.duration ? Math.round(t.duration / 1000) : undefined,
      participants: t.participants || [],
      summary: t.summary?.overview || "",
      transcript,
      actionItems: t.summary?.action_items ? [t.summary.action_items].flat() : undefined,
      providerUrl: t.transcript_url || `https://app.fireflies.ai/view/${t.id}`,
    };
  },
};
