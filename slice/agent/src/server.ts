import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Application } from "./application.js";
import { runDueDiligence, type AgentEvent } from "./agent.js";
import { auditHash } from "./hash.js";

/**
 * POST /api/audit   body: Application JSON  →  text/event-stream of AgentEvent, ending with {type:"report"}
 * GET  /health
 *
 * The Slice web app points VITE_AGENT_URL at this server to show the agent working live.
 */

const PORT = Number(process.env.PORT ?? 8787);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? "*";
const MAX_BODY = 30 * 1024 * 1024;

function cors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleAudit(req: IncomingMessage, res: ServerResponse) {
  let app: Application;
  try {
    app = Application.parse(JSON.parse(await readBody(req)));
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Invalid application" }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const send = (e: AgentEvent | { type: "done"; auditHash: string }) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);

  try {
    const report = await runDueDiligence(app, send, { signal: controller.signal });
    send({ type: "done", auditHash: auditHash(report) });
  } catch (err) {
    if (!controller.signal.aborted) send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method === "POST" && req.url === "/api/audit") return handleAudit(req, res);
  res.writeHead(404);
  res.end();
}).listen(PORT, () => console.log(`Slice due-diligence agent on http://localhost:${PORT}`));
