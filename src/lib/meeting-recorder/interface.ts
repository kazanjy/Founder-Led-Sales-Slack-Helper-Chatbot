export interface MeetingCallAttendee {
  name: string;
  email?: string;
}

export interface MeetingCall {
  id: string;
  title: string;
  date: string; // ISO date
  duration?: number; // seconds
  participants: string[];
  attendees?: MeetingCallAttendee[];
  callType?: string;
  providerUrl?: string; // link to call in provider's UI
  summary?: string;
}

export interface MeetingCallDetail extends MeetingCall {
  transcript: string;
  summary: string;
  actionItems?: string[];
}

export interface MeetingRecorderProvider {
  name: string;
  slug: string; // "granola" | "fireflies" | "fathom" | "gong"
  icon: string;
  authType: "api_key" | "oauth2";

  /** Validate an API key by making a test call */
  validateKey(apiKey: string): Promise<{ valid: boolean; accountId?: string; error?: string }>;

  /** List recent calls/meetings */
  listCalls(apiKey: string, limit?: number): Promise<MeetingCall[]>;

  /** Fetch full detail for a specific call (transcript + summary) */
  getCallDetail(apiKey: string, callId: string): Promise<MeetingCallDetail>;
}
