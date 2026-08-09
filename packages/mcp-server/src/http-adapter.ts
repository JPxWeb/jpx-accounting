import { randomUUID } from "node:crypto";

const PROTOCOL_VERSION = "2025-06-18";
const MAX_SESSION_EVENTS = 100;

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

type SessionEvent = {
  id: number;
  method: string;
  payload: unknown;
};

type Session = {
  id: string;
  expiresAt: number;
  nextEventId: number;
  events: SessionEvent[];
  pending: Promise<void>;
};

export type McpHttpToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type McpHttpToolHandlers = {
  list(): Promise<McpHttpToolDefinition[]>;
  call?(name: string, input: Record<string, unknown>, request: Request): Promise<unknown>;
};

export type McpHttpSessionStore = {
  create(): Session;
  get(id: string): Session | undefined;
  run<T>(session: Session, operation: () => Promise<T>): Promise<T>;
  append(session: Session, method: string, payload: unknown): void;
  eventsAfter(session: Session, lastEventId: number): readonly SessionEvent[];
};

export type McpHttpAdapter = {
  handlePost(request: Request): Promise<Response>;
  handleGet(request: Request): Response;
  readonly resourceUrl: string;
  readonly authorizationServers: readonly string[];
  readonly allowedOrigins: ReadonlySet<string>;
  readonly allowedHosts: ReadonlySet<string>;
};

export function createMcpHttpSessionStore({
  ttlMs,
  maxSessions,
  now = Date.now,
}: {
  ttlMs: number;
  maxSessions: number;
  now?: () => number;
}): McpHttpSessionStore {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError("MCP session TTL must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0) {
    throw new RangeError("MCP maximum sessions must be a positive safe integer.");
  }
  const sessions = new Map<string, Session>();

  function get(id: string) {
    const session = sessions.get(id);
    if (session === undefined) return undefined;
    const currentTime = now();
    if (currentTime >= session.expiresAt) {
      sessions.delete(id);
      return undefined;
    }
    session.expiresAt = currentTime + ttlMs;
    return session;
  }

  function sweepExpired(currentTime: number) {
    for (const [id, session] of sessions) {
      if (currentTime >= session.expiresAt) sessions.delete(id);
    }
  }

  function evictNextExpiring() {
    let candidate: Session | undefined;
    for (const session of sessions.values()) {
      if (candidate === undefined || session.expiresAt < candidate.expiresAt) {
        candidate = session;
      }
    }
    if (candidate !== undefined) sessions.delete(candidate.id);
  }

  return {
    create() {
      const currentTime = now();
      sweepExpired(currentTime);
      if (sessions.size >= maxSessions) evictNextExpiring();
      const session: Session = {
        id: randomUUID(),
        expiresAt: currentTime + ttlMs,
        nextEventId: 1,
        events: [],
        pending: Promise.resolve(),
      };
      sessions.set(session.id, session);
      return session;
    },
    get,
    run(session, operation) {
      const result = session.pending.then(operation);
      session.pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    append(session, method, payload) {
      session.events.push({ id: session.nextEventId, method, payload });
      session.nextEventId += 1;
      if (session.events.length > MAX_SESSION_EVENTS) {
        session.events.splice(0, session.events.length - MAX_SESSION_EVENTS);
      }
    },
    eventsAfter(session, lastEventId) {
      return session.events.filter((event) => event.id > lastEventId);
    },
  };
}

function protocolError(id: JsonRpcId, code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

function transportError(code: string, error: string, status: number) {
  return Response.json({ code, error }, { status });
}

function parseRequest(value: unknown): JsonRpcRequest | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.jsonrpc !== "2.0" || typeof candidate.method !== "string") return undefined;
  if (
    "id" in candidate &&
    candidate.id !== null &&
    typeof candidate.id !== "string" &&
    typeof candidate.id !== "number"
  ) {
    return undefined;
  }
  return candidate as JsonRpcRequest;
}

function requestId(value: unknown): JsonRpcId {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return id === null || typeof id === "string" || typeof id === "number" ? id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeSse(event: SessionEvent) {
  return `id: ${event.id}\nevent: message\ndata: ${JSON.stringify({
    method: event.method,
    payload: event.payload,
  })}\n\n`;
}

export function createMcpHttpAdapter({
  sessions,
  allowedOrigins,
  allowedHosts,
  toolHandlers,
  resourceUrl,
  authorizationServers,
}: {
  sessions: McpHttpSessionStore;
  allowedOrigins: readonly string[];
  allowedHosts: readonly string[];
  toolHandlers: McpHttpToolHandlers;
  resourceUrl: string;
  authorizationServers: readonly string[];
}): McpHttpAdapter {
  const origins = new Set(allowedOrigins);
  const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()));

  return {
    resourceUrl,
    authorizationServers,
    allowedOrigins: origins,
    allowedHosts: hosts,

    async handlePost(request) {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return protocolError(null, -32600, "Invalid Request");
      }

      const message = parseRequest(raw);
      if (message === undefined) {
        return protocolError(requestId(raw), -32600, "Invalid Request");
      }

      const requestedSessionId = request.headers.get("Mcp-Session-Id");
      if (message.method === "initialize") {
        if (requestedSessionId !== null) {
          return protocolError(message.id ?? null, -32600, "Initialize must not include Mcp-Session-Id.", 400);
        }
        if (
          message.id === undefined ||
          !isRecord(message.params) ||
          message.params.protocolVersion !== PROTOCOL_VERSION ||
          !isRecord(message.params.capabilities) ||
          !isRecord(message.params.clientInfo)
        ) {
          return protocolError(message.id ?? null, -32602, "Invalid initialize parameters");
        }
        const session = sessions.create();
        return Response.json(
          {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: "jpx-accounting", version: "0.0.0" },
            },
          },
          { headers: { "Mcp-Session-Id": session.id } },
        );
      }

      if (requestedSessionId === null || requestedSessionId.trim() === "") {
        return transportError("mcp_session_required", "Mcp-Session-Id is required.", 400);
      }
      const session = sessions.get(requestedSessionId);
      if (session === undefined) {
        return transportError("mcp_session_not_found", "MCP session was not found or has expired.", 404);
      }

      if (message.method === "notifications/initialized") {
        if (message.id !== undefined || (message.params !== undefined && !isRecord(message.params))) {
          return protocolError(message.id ?? null, -32602, "Invalid initialized notification parameters");
        }
        return new Response(null, { status: 202, headers: { "Mcp-Session-Id": session.id } });
      }

      return sessions.run(session, async () => {
        if (message.id === undefined) {
          return protocolError(null, -32600, "Requests must include an id.");
        }

        let payload: unknown;
        if (message.method === "tools/list") {
          if (message.params !== undefined && !isRecord(message.params)) {
            return protocolError(message.id, -32602, "Invalid tools/list parameters");
          }
          payload = {
            jsonrpc: "2.0",
            id: message.id,
            result: { tools: await toolHandlers.list() },
          };
        } else if (message.method === "tools/call") {
          if (
            !isRecord(message.params) ||
            typeof message.params.name !== "string" ||
            (message.params.arguments !== undefined && !isRecord(message.params.arguments))
          ) {
            return protocolError(message.id, -32602, "Invalid tools/call parameters");
          }
          if (toolHandlers.call === undefined) {
            return protocolError(message.id, -32601, "Method not found");
          }
          try {
            payload = {
              jsonrpc: "2.0",
              id: message.id,
              result: await toolHandlers.call(message.params.name, message.params.arguments ?? {}, request),
            };
          } catch (error) {
            return protocolError(message.id, -32602, error instanceof Error ? error.message : "Invalid tool arguments");
          }
        } else {
          return protocolError(message.id, -32601, "Method not found");
        }

        sessions.append(session, message.method, payload);
        return Response.json(payload, { headers: { "Mcp-Session-Id": session.id } });
      });
    },

    handleGet(request) {
      const requestedSessionId = request.headers.get("Mcp-Session-Id");
      if (requestedSessionId === null || requestedSessionId.trim() === "") {
        return transportError("mcp_session_required", "Mcp-Session-Id is required.", 400);
      }
      const session = sessions.get(requestedSessionId);
      if (session === undefined) {
        return transportError("mcp_session_not_found", "MCP session was not found or has expired.", 404);
      }

      const lastEventHeader = request.headers.get("Last-Event-ID");
      const lastEventId = lastEventHeader === null ? 0 : Number(lastEventHeader);
      if (!Number.isSafeInteger(lastEventId) || lastEventId < 0) {
        return transportError("mcp_last_event_id_invalid", "Last-Event-ID must be a non-negative integer.", 400);
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of sessions.eventsAfter(session, lastEventId)) {
            controller.enqueue(encoder.encode(encodeSse(event)));
          }
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "Mcp-Session-Id": session.id,
        },
      });
    },
  };
}
