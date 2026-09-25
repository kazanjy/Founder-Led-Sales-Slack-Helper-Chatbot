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

export interface ListCallsOptions {
  /** Maximum number of calls to return. Providers stop paginating once
   *  this many results are collected. */
  limit?: number;
  /** Stop paginating once a call older than this is encountered, and
   *  trim the result set to calls at or after this cutoff. Useful for
   *  reaching further back than the default limit without overfetching. */
  since?: Date;
}

/** Internal helper used by every provider to normalize the listCalls
 *  argument from either a bare number or an options object. */
export function normalizeListCallsOpts(
  opts: number | ListCallsOptions | undefined,
  defaultLimit: number
): { limit: number; since: Date | undefined } {
  if (typeof opts === "number") return { limit: opts, since: undefined };
  return {
    limit: opts?.limit ?? defaultLimit,
    since: opts?.since,
  };
}

export interface MeetingRecorderProvider {
  name: string;
  slug: string; // "granola" | "fireflies" | "fathom" | "gong"
  icon: string;
  authType: "api_key" | "oauth2";

  /** Validate an API key by making a test call */
  validateKey(apiKey: string): Promise<{ valid: boolean; accountId?: string; error?: string }>;

  /** List recent calls/meetings. Accepts either a bare limit (legacy) or
   *  an options object so callers can scan further back via `since`. */
  listCalls(apiKey: string, opts?: number | ListCallsOptions): Promise<MeetingCall[]>;

  /** Fetch full detail for a specific call (transcript + summary) */
  getCallDetail(apiKey: string, callId: string): Promise<MeetingCallDetail>;
}
