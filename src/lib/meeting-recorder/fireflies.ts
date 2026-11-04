import { MeetingRecorderProvider, MeetingCall, MeetingCallDetail, ListCallsOptions, normalizeListCallsOpts } from "./interface";

const GRAPHQL_URL = "https://api.fireflies.ai/graphql";

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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

  async listCalls(apiKey: string, opts?: number | ListCallsOptions): Promise<MeetingCall[]> {
    const { limit, since } = normalizeListCallsOpts(opts, 15);
    const sinceMs = since ? since.getTime() : null;
    const allTranscripts: Array<{
      id: string;
      title: string;
      date: string;
      duration: number;
      participants: string[];
      transcript_url: string;
      summary?: { overview?: string };
    }> = [];

    // Fireflies uses skip-based (offset) pagination, newest-first.
    // Dates are ms-since-epoch strings — convert before comparing.
    while (allTranscripts.length < limit) {
      const pageSize = Math.min(limit - allTranscripts.length, 50);
      const data = await firefliesQuery(apiKey, `
        query ListTranscripts($limit: Int, $skip: Int) {
          transcripts(limit: $limit, skip: $skip) {
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
      `, { limit: pageSize, skip: allTranscripts.length });

      const transcripts = data?.transcripts || [];
      allTranscripts.push(...transcripts);

      if (sinceMs != null && transcripts.some((t: { date: string }) => Number(t.date) < sinceMs)) break;
      // If we got fewer than requested, there are no more
      if (transcripts.length < pageSize) break;
    }

    const trimmed = sinceMs != null
      ? allTranscripts.filter((t) => Number(t.date) >= sinceMs)
      : allTranscripts;

    return trimmed.map((t) => {
      const participantStrs: string[] = t.participants || [];
      // Fireflies can pack multiple emails in a single comma-separated string — split them
      const individualParticipants = participantStrs.flatMap((p) =>
        p.includes(",") ? p.split(",").map((s) => s.trim()).filter(Boolean) : [p]
      );
      const uniqueParticipants = [...new Set(individualParticipants)];
      return {
        id: t.id,
        title: t.title || "Untitled Meeting",
        date: t.date ? new Date(Number(t.date)).toISOString() : new Date().toISOString(),
        duration: t.duration ? Math.round(t.duration / 1000) : undefined,
        participants: uniqueParticipants,
        attendees: uniqueParticipants.map((p) => ({
          name: p,
          email: p.includes("@") ? p : undefined,
        })),
        summary: t.summary?.overview || undefined,
        providerUrl: t.transcript_url || `https://app.fireflies.ai/view/${t.id}`,
      };
    });
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
            start_time
            end_time
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

    // Build transcript from sentences with speaker attribution and timestamps
    const transcript = (t.sentences || [])
      .map((s: { speaker_name: string; text: string; start_time?: number; end_time?: number }) => {
        const ts = s.start_time != null ? formatTimestamp(s.start_time) : "";
        return ts ? `[${ts}] ${s.speaker_name}: ${s.text}` : `${s.speaker_name}: ${s.text}`;
      })
      .join("\n\n");

    const participantStrs: string[] = t.participants || [];
    const individualParticipants = participantStrs.flatMap((p: string) =>
      p.includes(",") ? p.split(",").map((s: string) => s.trim()).filter(Boolean) : [p]
    );
    const uniqueParticipants = [...new Set(individualParticipants)];

    return {
      id: t.id,
      title: t.title || "Untitled Meeting",
      date: t.date ? new Date(Number(t.date)).toISOString() : new Date().toISOString(),
      duration: t.duration ? Math.round(t.duration / 1000) : undefined,
      participants: uniqueParticipants,
      attendees: uniqueParticipants.map((p: string) => ({
        name: p,
        email: p.includes("@") ? p : undefined,
      })),
      summary: t.summary?.overview || "",
      transcript,
      actionItems: t.summary?.action_items ? [t.summary.action_items].flat() : undefined,
      providerUrl: t.transcript_url || `https://app.fireflies.ai/view/${t.id}`,
    };
  },
};
