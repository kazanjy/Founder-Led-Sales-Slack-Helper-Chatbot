/**
 * Minimal MCP (Model Context Protocol) client speaking JSON-RPC 2.0
 * over Streamable HTTP. Built specifically for Circleback's hosted
 * MCP server — supports just enough of the spec to do an initialize
 * handshake, list tools, and call tools with a Bearer token. Not a
 * full SDK; if we need more providers on MCP later this is the spot
 * to grow.
 *
 * Streamable HTTP responses can come back as either application/json
 * (single response) or text/event-stream (SSE). For our call-and-
 * await pattern we read both: if SSE, we consume the stream and
 * return the first JSON-RPC result/error message we see.
 *
 * Auth: all requests carry `Authorization: Bearer <accessToken>` per
 * the protected-resource metadata Circleback publishes.
 */

const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = {
  name: "mikey-deal-helper",
  version: "1.0.0",
};

export interface McpToolDefinition {
  name: string;
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema?: Record<string, any>;
}

export interface McpCallResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content?: Array<{ type: string; text?: string; [k: string]: any }>;
  isError?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export class McpAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "McpAuthError";
  }
}

export class McpProtocolError extends Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(message: string, data?: any) {
    super(message);
    this.data = data;
    this.name = "McpProtocolError";
  }
}

export interface McpClientOptions {
  endpoint: string;
  accessToken: string;
}

/**
 * Stateful client for one MCP session. Re-uses the same Mcp-Session-Id
 * header across calls when the server returns one on initialize. For
 * Circleback we mostly issue a single request per tool call and don't
 * keep long-lived sessions, but the spec allows session reuse so we
 * thread it through.
 */
export class McpClient {
  private endpoint: string;
  private accessToken: string;
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(opts: McpClientOptions) {
    this.endpoint = opts.endpoint;
    this.accessToken = opts.accessToken;
  }

  private async post(
    body: Record<string, unknown>,
    opts: { expectResponse: boolean } = { expectResponse: true }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      "Accept": opts.expectResponse ? "application/json, text/event-stream" : "application/json",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // Session id is published on the initial response and persists
    // for the conversation per spec. Save it so subsequent calls
    // ride the same session.
    const newSession = res.headers.get("Mcp-Session-Id");
    if (newSession) this.sessionId = newSession;

    if (res.status === 401 || res.status === 403) {
      throw new McpAuthError(
        `MCP auth failed: ${res.status} ${res.statusText}`,
        res.status
      );
    }

    if (!opts.expectResponse) {
      // Notifications don't expect a response body.
      return undefined;
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream")) {
      // Consume the SSE stream until we see a JSON-RPC message with
      // an `id` matching what we sent — that's our reply.
      return await readSseUntilResponse(res, body.id as number);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new McpProtocolError(`MCP HTTP error ${res.status}: ${text.substring(0, 400)}`);
    }

    return await res.json();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const id = this.nextId++;
    const reply = await this.post({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
    });
    if (reply?.error) {
      throw new McpProtocolError(`MCP initialize error: ${JSON.stringify(reply.error)}`, reply.error);
    }
    // Per spec, the client sends a notifications/initialized after a
    // successful initialize handshake.
    await this.post(
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      { expectResponse: false }
    );
    this.initialized = true;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    await this.initialize();
    const id = this.nextId++;
    const reply = await this.post({
      jsonrpc: "2.0",
      id,
      method: "tools/list",
      params: {},
    });
    if (reply?.error) {
      throw new McpProtocolError(`tools/list error: ${JSON.stringify(reply.error)}`, reply.error);
    }
    return reply?.result?.tools || [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async callTool(name: string, args: Record<string, any>): Promise<McpCallResult> {
    await this.initialize();
    const id = this.nextId++;
    const reply = await this.post({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (reply?.error) {
      throw new McpProtocolError(
        `tools/call ${name} error: ${JSON.stringify(reply.error)}`,
        reply.error
      );
    }
    const result = reply?.result || {};
    // The MCP spec lets tools surface result-level errors via
    // { isError: true, content: [{ type: "text", text: "<msg>" }] }
    // instead of the JSON-RPC error envelope. Treat them as throws so
    // callers don't quietly try to parse error text as data (which
    // bit us during the Circleback schema-mismatch debug).
    if (result?.isError) {
      const text =
        Array.isArray(result.content) && result.content[0]?.text
          ? result.content[0].text
          : JSON.stringify(result);
      throw new McpProtocolError(`tools/call ${name} returned isError: ${text}`);
    }
    return result;
  }
}

/**
 * Read an SSE response stream and return the first JSON-RPC message
 * we see whose `id` matches the request we sent. Implements the
 * minimum of the spec we need — no event-id buffering, no
 * reconnection, no progress notifications surfaced.
 */
async function readSseUntilResponse(
  res: Response,
  requestId: number
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!res.body) {
    throw new McpProtocolError("SSE response had no body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by blank lines.
    let sep;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      // Each event has zero or more "data: <line>" parts that we
      // join with "\n" per the SSE spec.
      const dataLines = rawEvent
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6));
      if (dataLines.length === 0) continue;
      const payload = dataLines.join("\n");
      try {
        const parsed = JSON.parse(payload);
        if (parsed?.id === requestId) {
          // Drain and discard the rest of the stream — caller has
          // its answer.
          try {
            await reader.cancel();
          } catch { /* ignore */ }
          return parsed;
        }
      } catch { /* skip non-JSON events */ }
    }
  }
  throw new McpProtocolError("SSE stream ended without a matching response");
}
