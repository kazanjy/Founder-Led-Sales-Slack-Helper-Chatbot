import crypto from "crypto";
import {
  MeetingRecorderProvider,
  MeetingCall,
  MeetingCallDetail,
  ListCallsOptions,
  normalizeListCallsOpts,
} from "./interface";
import { McpClient, McpAuthError } from "./mcp-client";

/**
 * Circleback meeting-recorder provider — talks to the centrally
 * hosted Circleback MCP server over Streamable HTTP with an OAuth
 * Bearer token.
 *
 * Auth metadata (live values, retrieved from
 * https://circleback.ai/.well-known/oauth-authorization-server):
 *   authorize:    https://circleback.ai/api/oauth/authorize
 *   token:        https://circleback.ai/api/oauth/access-token
 *   register:     https://circleback.ai/api/oauth/register
 *   scope:        user
 *   PKCE:         S256 required
 *   grant types:  authorization_code + refresh_token
 *
 * Flow on connect (in /api/meeting-recorder/oauth route):
 *   1. POST register endpoint to dynamically register a client per
 *      RFC 7591. Returns { client_id, client_secret? }.
 *   2. Generate PKCE verifier + state.
 *   3. Stash { verifier, client_id, client_secret } in an HttpOnly
 *      cookie keyed by state nonce so the callback route can pick
 *      them up — putting them in the OAuth state param would leak
 *      them to Circleback and defeat PKCE.
 *   4. Redirect user to authorize endpoint with code_challenge,
 *      state, scope=user.
 *
 * Flow on callback (in /api/meeting-recorder/oauth/callback route):
 *   1. Read state from query, look up cookie.
 *   2. POST token endpoint with code + verifier + client_id +
 *      (client_secret if present) + redirect_uri.
 *   3. Store encrypted access_token / refresh_token in
 *      MeetingRecorderConnection.
 *   4. Clear cookie.
 */

export const CIRCLEBACK_MCP_ENDPOINT = "https://circleback.ai/api/mcp";
export const CIRCLEBACK_AUTH_URL = "https://circleback.ai/api/oauth/authorize";
export const CIRCLEBACK_TOKEN_URL = "https://circleback.ai/api/oauth/access-token";
export const CIRCLEBACK_REGISTER_URL = "https://circleback.ai/api/oauth/register";
export const CIRCLEBACK_SCOPE = "user";

export interface CirclebackClientRegistration {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
}

export interface CirclebackTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/**
 * Dynamic client registration per RFC 7591. We register a fresh
 * client every time the user starts an OAuth flow — orphaned
 * registrations at Circleback are a small price for not needing a
 * schema migration to cache them. If this becomes a problem at
 * scale we can move the cached client_id/secret into GlobalSettings.
 */
export async function registerCirclebackClient(
  redirectUri: string
): Promise<CirclebackClientRegistration> {
  const res = await fetch(CIRCLEBACK_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Mikey - A Founder Led Sales Helper",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: CIRCLEBACK_SCOPE,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Circleback dynamic registration failed: ${res.status} ${body.substring(0, 400)}`);
  }
  const data = (await res.json()) as CirclebackClientRegistration;
  if (!data.client_id) {
    throw new Error("Circleback registration response missing client_id");
  }
  return data;
}

export function buildCirclebackAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    scope: CIRCLEBACK_SCOPE,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${CIRCLEBACK_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCirclebackCode(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
}): Promise<CirclebackTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
    client_id: opts.clientId,
  });
  if (opts.clientSecret) {
    body.set("client_secret", opts.clientSecret);
  }
  const res = await fetch(CIRCLEBACK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Circleback token exchange failed: ${res.status} ${text.substring(0, 400)}`);
  }
  return (await res.json()) as CirclebackTokens;
}

export async function refreshCirclebackToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<CirclebackTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  });
  if (opts.clientSecret) {
    body.set("client_secret", opts.clientSecret);
  }
  const res = await fetch(CIRCLEBACK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Circleback token refresh failed: ${res.status} ${text.substring(0, 400)}`);
  }
  return (await res.json()) as CirclebackTokens;
}

// PKCE helpers ─────────────────────────────────────────────────────

export function generatePkce(): { verifier: string; challenge: string } {
  // 64 bytes → 86-char base64url string, comfortably within RFC 7636's
  // 43-128 char range for the verifier.
  const verifier = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function generateOauthState(): string {
  return crypto.randomBytes(24).toString("base64url");
}

// MCP-backed provider impl ─────────────────────────────────────────

// Reads the text payload out of an MCP tool result. Circleback's
// SearchMeetings / GetTranscriptsForMeetings return their data as
// JSON-encoded strings inside content[0].text — same pattern most
// MCP servers use. Falls back to the raw content array if the shape
// surprises us.
function extractJsonFromMcpResult(result: { content?: Array<{ type: string; text?: string }> }): unknown {
  const first = result.content?.[0];
  if (first?.type === "text" && typeof first.text === "string") {
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text;
    }
  }
  return result.content;
}

// Normalize a Circleback meeting payload to our MeetingCall shape.
// Field names confirmed against a live ReadMeetings/SearchMeetings
// response — Circleback's MCP is camelCase: createdAt, recordingUrl,
// actionItems, linkId. We keep snake_case aliases too for safety
// in case the public surface ever shifts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMeetingCall(raw: any): MeetingCall {
  const id = String(raw.id || raw.meeting_id || raw.uuid || "");
  const title = String(raw.title || raw.name || "Untitled meeting");
  const startedAt =
    raw.createdAt ||
    raw.started_at ||
    raw.start_time ||
    raw.startTime ||
    raw.date ||
    raw.created_at;
  const date = startedAt ? new Date(startedAt).toISOString() : new Date().toISOString();
  const duration =
    typeof raw.duration_seconds === "number"
      ? raw.duration_seconds
      : typeof raw.duration === "number"
        ? raw.duration
        : undefined;
  const attendeesRaw: Array<{ name?: string; email?: string }> =
    raw.attendees || raw.participants || raw.people || [];
  const attendees = attendeesRaw
    .map((a) => ({ name: String(a.name || a.email || "Unknown"), email: a.email }))
    .filter((a) => !!a.name);
  // recordingUrl is the watchable video; `url` falls back to the
  // Circleback meeting page. Prefer the recording so the Call Review
  // "Call Recording URL" field gets the playable link.
  const providerUrl =
    raw.recordingUrl || raw.url || raw.web_url || raw.share_url;
  // ReadMeetings exposes the markdown summary under `notes`; older
  // shape sometimes uses `summary`. Either works.
  const summary =
    typeof raw.notes === "string"
      ? raw.notes
      : typeof raw.summary === "string"
        ? raw.summary
        : undefined;
  return {
    id,
    title,
    date,
    duration,
    participants: attendees.map((a) => a.name),
    attendees,
    providerUrl,
    summary,
  };
}

export const circlebackProvider: MeetingRecorderProvider = {
  name: "Circleback",
  slug: "circleback",
  icon: "🔁",
  authType: "oauth2",

  async validateKey(accessToken: string) {
    try {
      const client = new McpClient({ endpoint: CIRCLEBACK_MCP_ENDPOINT, accessToken });
      const tools = await client.listTools();
      const hasSearch = tools.some((t) => t.name === "SearchMeetings");
      if (!hasSearch) {
        return {
          valid: false,
          error: "Circleback MCP didn't expose SearchMeetings — token may lack scope.",
        };
      }
      return { valid: true };
    } catch (err) {
      if (err instanceof McpAuthError) {
        return { valid: false, error: `Circleback rejected the token (${err.status}).` };
      }
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Circleback connectivity check failed.",
      };
    }
  },

  async listCalls(accessToken: string, opts?: number | ListCallsOptions) {
    const { limit, since } = normalizeListCallsOpts(opts, 25);
    const client = new McpClient({ endpoint: CIRCLEBACK_MCP_ENDPOINT, accessToken });
    // Circleback's SearchMeetings requires:
    //   intent: string  — semantic description of what we're after
    //   pageIndex: number — zero-based pagination
    // and optionally accepts a `limit` (kept from our earlier guess).
    // When `since` is provided we weave a date hint into the intent
    // string since structured date filters aren't part of the
    // documented schema.
    const intent = since
      ? `All meetings since ${since.toISOString().slice(0, 10)}, most recent first`
      : "All recent meetings, most recent first";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args: Record<string, any> = { intent, pageIndex: 0, limit };
    const result = await client.callTool("SearchMeetings", args);
    const payload = extractJsonFromMcpResult(result);
    // SearchMeetings returns a bare array; the wrapper-key branch is
    // kept for safety in case the shape ever shifts.
    let meetings: unknown[] = [];
    if (Array.isArray(payload)) meetings = payload;
    else if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      meetings = (obj.meetings ||
        obj.results ||
        obj.data ||
        obj.items ||
        obj.records ||
        []) as unknown[];
    }
    console.log(`[circleback.listCalls] parsed ${meetings.length} meetings`);
    return meetings.map(toMeetingCall);
  },

  async getCallDetail(accessToken: string, callId: string): Promise<MeetingCallDetail> {
    const client = new McpClient({ endpoint: CIRCLEBACK_MCP_ENDPOINT, accessToken });
    // Circleback's MCP schema is camelCase and requires `intent` on
    // every call (same shape we discovered on SearchMeetings).
    const readArgs = {
      intent: `Read full meeting record for meeting id ${callId}`,
      meetingIds: [callId],
    };
    const transcriptArgs = {
      intent: `Get the full transcript for meeting id ${callId}`,
      meetingIds: [callId],
    };
    const [readRes, transcriptRes] = await Promise.all([
      client.callTool("ReadMeetings", readArgs),
      client.callTool("GetTranscriptsForMeetings", transcriptArgs),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const readPayload = extractJsonFromMcpResult(readRes) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transcriptPayload = extractJsonFromMcpResult(transcriptRes) as any;

    // Both tools return arrays; pick the first match (we only request
    // one meetingId at a time so the first row is ours).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pickFromArray = (p: any) => {
      if (!p) return null;
      if (Array.isArray(p)) return p[0];
      const arr = p.meetings || p.results || p.data || p.items || p.records;
      if (Array.isArray(arr)) return arr[0];
      return p;
    };
    const meeting = pickFromArray(readPayload) || {};
    const transcriptObj = pickFromArray(transcriptPayload) || {};

    const base = toMeetingCall({ ...meeting, id: callId });
    // Circleback's GetTranscriptsForMeetings returns transcript as an
    // ARRAY of { speaker, text, timestamp } segments — not a string.
    // Render to `Speaker: text` lines so the Call Review textarea can
    // accept it. Keep the string/text/segments fallbacks for safety.
    const transcript = (() => {
      if (typeof transcriptObj.transcript === "string") return transcriptObj.transcript;
      if (Array.isArray(transcriptObj.transcript)) {
        return transcriptObj.transcript
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((s: any) => `${s.speaker || s.name || "?"}: ${s.text || ""}`)
          .join("\n");
      }
      if (typeof transcriptObj.text === "string") return transcriptObj.text;
      if (Array.isArray(transcriptObj.segments)) {
        return transcriptObj.segments
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((s: any) => `${s.speaker || s.name || "?"}: ${s.text || ""}`)
          .join("\n");
      }
      return "";
    })();
    const summary = typeof meeting.notes === "string" ? meeting.notes : typeof meeting.summary === "string" ? meeting.summary : "";
    const actionItemsRaw = meeting.actionItems || meeting.action_items || [];
    const actionItems = Array.isArray(actionItemsRaw)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? actionItemsRaw.map((a: any) => (typeof a === "string" ? a : a.text || a.title || JSON.stringify(a)))
      : undefined;

    return {
      ...base,
      transcript,
      summary,
      actionItems,
    };
  },
};
