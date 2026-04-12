import { MeetingRecorderProvider, MeetingCall, MeetingCallDetail } from "./interface";

const BASE_URL = "https://public-api.granola.ai/v1";

interface GranolaNoteListItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  owner?: { name: string; email: string };
  attendees?: Array<{ name: string; email?: string }>;
  summary?: string;
}

interface GranolaNoteDetail extends GranolaNoteListItem {
  transcript?: Array<{
    speaker: { source: string; diarization_label?: string };
    text: string;
  }> | null;
  content?: string;
  notes_plain?: string;
  notes_markdown?: string;
}

async function granolaFetch(path: string, apiKey: string): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  return res;
}

export const granolaProvider: MeetingRecorderProvider = {
  name: "Granola",
  slug: "granola",
  icon: "🟤",
  authType: "api_key",

  async validateKey(apiKey: string) {
    try {
      const res = await granolaFetch("/notes?limit=1", apiKey);
      if (res.ok) {
        return { valid: true };
      }
      if (res.status === 401 || res.status === 403) {
        return { valid: false, error: "Invalid API key" };
      }
      return { valid: false, error: `API error: ${res.status}` };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  async listCalls(apiKey: string, limit = 15): Promise<MeetingCall[]> {
    const res = await granolaFetch(`/notes?limit=${limit}`, apiKey);
    if (!res.ok) {
      throw new Error(`Failed to fetch notes: ${res.status}`);
    }

    const data = await res.json();
    const notes: GranolaNoteListItem[] = data.notes || data.data || [];

    return notes.map((note) => ({
      id: note.id,
      title: note.title || "Untitled Meeting",
      date: note.created_at,
      participants: note.attendees?.map((a) => a.name) || [],
      summary: note.summary || undefined,
      providerUrl: `https://granola.ai/note/${note.id}`,
    }));
  },

  async getCallDetail(apiKey: string, callId: string): Promise<MeetingCallDetail> {
    const res = await granolaFetch(`/notes/${callId}?include=transcript`, apiKey);
    if (!res.ok) {
      throw new Error(`Failed to fetch note detail: ${res.status}`);
    }

    const note: GranolaNoteDetail = await res.json();

    // Log response keys to debug summary field availability
    console.log(`[Granola] Note ${callId} response keys:`, Object.keys(note));
    console.log(`[Granola] summary field:`, note.summary ? `${note.summary.substring(0, 100)}...` : note.summary);
    if (note.content) console.log(`[Granola] content field present (${note.content.length} chars)`);
    if (note.notes_plain) console.log(`[Granola] notes_plain field present (${note.notes_plain.length} chars)`);
    if (note.notes_markdown) console.log(`[Granola] notes_markdown field present (${note.notes_markdown.length} chars)`);

    // Build transcript from speaker-attributed entries
    let transcript = "";
    if (Array.isArray(note.transcript) && note.transcript.length > 0) {
      transcript = note.transcript
        .map((entry) => {
          const speakerName = entry.speaker?.diarization_label || entry.speaker?.source || "Speaker";
          return `${speakerName}: ${entry.text}`;
        })
        .join("\n\n");
    }

    // Try multiple possible field names for the AI-generated summary
    const summary = note.summary || note.content || note.notes_plain || note.notes_markdown || "";

    return {
      id: note.id,
      title: note.title || "Untitled Meeting",
      date: note.created_at,
      participants: note.attendees?.map((a) => a.name) || [],
      summary,
      transcript,
      providerUrl: `https://granola.ai/note/${note.id}`,
    };
  },
};
