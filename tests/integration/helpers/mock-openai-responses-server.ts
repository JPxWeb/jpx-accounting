import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal OpenAI-compatible **Responses API** mock for advisor normal-mode
 * integration tests (WS-D item 8).
 *
 * `createAdvisorModel` builds `createAzure({ baseURL: `${endpoint}/openai` })`
 * and the plain provider call form is a Responses model, so with a
 * non-`*.openai.azure.com` host the SDK POSTs `${endpoint}/openai/responses`
 * (no `/v1` prefix, no `api-version` query — see `@ai-sdk/azure`'s URL
 * builder). This server binds an EPHEMERAL 127.0.0.1 port (never the E2E
 * ports 3200/3201), records every request, and answers each POST with the
 * next enqueued script's SSE stream.
 */

/** One recorded model call: headers lowercased by node, body JSON-parsed. */
export type RecordedResponsesRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
};

/** Streaming controls handed to a script. All writes are SSE `data:` events. */
export type SseWriter = {
  /** Write one Responses-API chunk as an SSE `data:` event. */
  send: (chunk: Record<string, unknown>) => void;
  /** End the response cleanly (server-side stream complete). */
  end: () => void;
  /** Sever the socket mid-stream (simulates a provider crash). */
  destroy: () => void;
  /** Resolves when the connection closes — normal end OR client abort. */
  closed: Promise<void>;
};

export type ResponsesScript = (writer: SseWriter, request: RecordedResponsesRequest) => void | Promise<void>;

export class MockOpenAiResponsesServer {
  readonly requests: RecordedResponsesRequest[] = [];
  private readonly scripts: ResponsesScript[] = [];

  private constructor(
    private readonly server: Server,
    readonly port: number,
  ) {}

  /** The value to hand `createApiRuntimeDependencies` as AZURE_OPENAI_ENDPOINT. */
  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Queue the SSE script for the NEXT incoming model call. */
  enqueue(script: ResponsesScript): void {
    this.scripts.push(script);
  }

  static async start(): Promise<MockOpenAiResponsesServer> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      // Port 0 = OS-assigned ephemeral port; never collides with the E2E servers.
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    const instance = new MockOpenAiResponsesServer(server, port);
    server.on("request", (req, res) => instance.handleRequest(req, res));
    return instance;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const bodyChunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(bodyChunks).toString("utf8");
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        body = { unparseable: rawBody };
      }
      const record: RecordedResponsesRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: { ...req.headers },
        body,
      };
      this.requests.push(record);

      const script = this.scripts.shift();
      if (!script) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock: no scripted response enqueued" } }));
        return;
      }

      let headersSent = false;
      const ensureSseHeaders = () => {
        if (headersSent) return;
        headersSent = true;
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        });
      };
      const closed = new Promise<void>((resolve) => {
        res.on("close", () => resolve());
      });
      const writer: SseWriter = {
        send: (chunk) => {
          ensureSseHeaders();
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        },
        end: () => {
          ensureSseHeaders();
          res.end();
        },
        destroy: () => {
          res.destroy();
        },
        closed,
      };
      void script(writer, record);
    });
  }

  async close(): Promise<void> {
    // Drop keep-alive sockets so close() never hangs the test process.
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

// ---------------------------------------------------------------------------
// Responses-API chunk builders (shapes pinned by @ai-sdk/openai's
// `openaiResponsesChunkSchema` — unknown shapes fail the SDK's zod parse).
// ---------------------------------------------------------------------------

export function responseCreated(id = "resp_mock_1"): Record<string, unknown> {
  return { type: "response.created", response: { id, created_at: 1_752_000_000, model: "mock-deployment" } };
}

export function messageItemAdded(itemId: string): Record<string, unknown> {
  return { type: "response.output_item.added", output_index: 0, item: { type: "message", id: itemId } };
}

export function outputTextDelta(itemId: string, delta: string): Record<string, unknown> {
  return { type: "response.output_text.delta", item_id: itemId, delta };
}

export function messageItemDone(itemId: string): Record<string, unknown> {
  return { type: "response.output_item.done", output_index: 0, item: { type: "message", id: itemId } };
}

export function functionCallItemAdded(itemId: string, callId: string, name: string): Record<string, unknown> {
  return {
    type: "response.output_item.added",
    output_index: 0,
    item: { type: "function_call", id: itemId, call_id: callId, name, arguments: "" },
  };
}

export function functionCallArgumentsDelta(itemId: string, delta: string): Record<string, unknown> {
  return { type: "response.function_call_arguments.delta", item_id: itemId, output_index: 0, delta };
}

export function functionCallItemDone(
  itemId: string,
  callId: string,
  name: string,
  argumentsJson: string,
): Record<string, unknown> {
  return {
    type: "response.output_item.done",
    output_index: 0,
    item: { type: "function_call", id: itemId, call_id: callId, name, arguments: argumentsJson, status: "completed" },
  };
}

export function responseCompleted(usage = { input_tokens: 42, output_tokens: 7 }): Record<string, unknown> {
  return { type: "response.completed", response: { usage } };
}

/** A complete plain-text model turn. */
export function textTurnScript(text: string): ResponsesScript {
  return (writer) => {
    writer.send(responseCreated());
    writer.send(messageItemAdded("msg_mock_1"));
    writer.send(outputTextDelta("msg_mock_1", text));
    writer.send(messageItemDone("msg_mock_1"));
    writer.send(responseCompleted());
    writer.end();
  };
}

/** A model turn that calls one tool with the given JSON-serializable input. */
export function toolCallTurnScript(toolName: string, input: unknown, callId = "call_mock_1"): ResponsesScript {
  const argumentsJson = JSON.stringify(input);
  return (writer) => {
    writer.send(responseCreated());
    writer.send(functionCallItemAdded("fc_mock_1", callId, toolName));
    writer.send(functionCallArgumentsDelta("fc_mock_1", argumentsJson));
    writer.send(functionCallItemDone("fc_mock_1", callId, toolName, argumentsJson));
    writer.send(responseCompleted());
    writer.end();
  };
}
