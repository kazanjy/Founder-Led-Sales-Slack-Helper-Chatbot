import { MeetingRecorderProvider, MeetingCall, MeetingCallDetail } from "./interface";

const BASE_URL = "https://public-api.granola.ai/v1";

interface GranolaNoteListItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  owner?: { name: string; email: string };
  attendees?: Array<{ name: string; email?: string }>;
  summary_text?: string;
  summary_markdown?: string | null;
}

interface GranolaNoteDetail extends GranolaNoteListItem {
  transcript?: Array<{
    speaker: { source: string; diarization_label?: string };
    text: string;
  }> | null;
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
    const allNotes: GranolaNoteListItem[] = [];
    let cursor: string | undefined;

    // Granola's API has a fixed page size — use cursor pagination to fetch more
    while (allNotes.length < limit) {
      const pageSize = Math.min(limit - allNotes.length, 25);
      let url = `/notes?limit=${pageSize}`;
      if (cursor) url += `&cursor=${cursor}`;

      const res = await granolaFetch(url, apiKey);
      if (!res.ok) {
        throw new Error(`Failed to fetch notes: ${res.status}`);
      }

      const data = await res.json();
      const notes: GranolaNoteListItem[] = data.notes || data.data || [];
      allNotes.push(...notes);

      // Check if there are more pages
      if (!data.hasMore || !data.cursor || notes.length === 0) break;
      cursor = data.cursor;
    }

    return allNotes.map((note) => ({
      id: note.id,
      title: note.title || "Untitled Meeting",
      date: note.created_at,
      participants: note.attendees?.map((a) => a.name) || [],
      attendees: note.attendees?.map((a) => ({ name: a.name, email: a.email })) || [],
      summary: note.summary_text || note.summary_markdown || undefined,
      providerUrl: `https://granola.ai/note/${note.id}`,
    }));
  },

  async getCallDetail(apiKey: string, callId: string): Promise<MeetingCallDetail> {
    const res = await granolaFetch(`/notes/${callId}?include=transcript`, apiKey);
    if (!res.ok) {
      throw new Error(`Failed to fetch note detail: ${res.status}`);
    }

    const note: GranolaNoteDetail = await res.json();

    // Build a speaker label map from attendees
    // Granola uses "microphone" for the note owner and "speaker" / "speaker_N" for others
    const attendeeNames = note.attendees?.map((a) => a.name) || [];
    const ownerName = note.owner?.name || null;

    // "microphone" = the person who recorded (note owner)
    // "speaker" / "speaker_0" / "speaker_1" etc. = other participants
    // Map speaker_N labels to attendees (excluding the owner)
    const otherAttendees = attendeeNames.filter((n) => n !== ownerName);

    function resolveSpeaker(speaker: { source: string; diarization_label?: string }): string {
      if (speaker.diarization_label) return speaker.diarization_label;
      const src = speaker.source || "Speaker";
      if (src === "microphone" && ownerName) return ownerName;
      // "speaker" or "speaker_N" — try to map to an attendee
      const match = src.match(/^speaker(?:_(\d+))?$/);
      if (match) {
        const idx = match[1] !== undefined ? parseInt(match[1], 10) : 0;
        if (idx < otherAttendees.length) return otherAttendees[idx];
      }
      return src;
    }

    // Build transcript from speaker-attributed entries
    let transcript = "";
    if (Array.isArray(note.transcript) && note.transcript.length > 0) {
      transcript = note.transcript
        .map((entry) => {
          const speakerName = resolveSpeaker(entry.speaker);
          return `${speakerName}: ${entry.text}`;
        })
        .join("\n\n");
    }

    // Use summary_text (plain) or summary_markdown from the Granola API
    const summary = note.summary_text || note.summary_markdown || "";

    return {
      id: note.id,
      title: note.title || "Untitled Meeting",
      date: note.created_at,
      participants: note.attendees?.map((a) => a.name) || [],
      attendees: note.attendees?.map((a) => ({ name: a.name, email: a.email })) || [],
      summary,
      transcript,
      providerUrl: `https://granola.ai/note/${note.id}`,
    };
  },
};
