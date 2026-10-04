import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { Application } from "./application.js";
import { runDueDiligence, type AgentEvent } from "./agent.js";
import { auditHash } from "./hash.js";
import { publishAudit } from "./chain.js";

/**
 * npm run audit -- examples/neon-coyote-bar.json --docs statements.pdf,articles.pdf --out report.json
 * Add --publish --asset 0 to write the score on-chain (needs RPC_URL, VERIFIER_PRIVATE_KEY, SLICE_HUB).
 */

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    docs: { type: "string" },
    out: { type: "string", default: "report.json" },
    publish: { type: "boolean", default: false },
    asset: { type: "string" },
  },
});

const file = positionals[0];
if (!file) {
  console.error("usage: npm run audit -- <application.json> [--docs a.pdf,b.png] [--out report.json] [--publish --asset <id>]");
  process.exit(1);
}

const MEDIA: Record<string, "application/pdf" | "image/png" | "image/jpeg" | "image/webp"> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const raw = JSON.parse(readFileSync(file, "utf8"));
for (const path of values.docs?.split(",").filter(Boolean) ?? []) {
  const mediaType = MEDIA[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`Unsupported document type: ${path}`);
  (raw.documents ??= []).push({ label: path, mediaType, data: readFileSync(path).toString("base64") });
}
const app = Application.parse(raw);

const ICON: Record<AgentEvent["type"], string> = {
  status: "•",
  thinking: "💭",
  search: "🔍",
  fetch: "🌐",
  sources: "  ↳",
  tool: "🛠 ",
  tool_result: "  ✓",
  note: "📝",
  report: "📄",
  error: "✗",
};

function log(e: AgentEvent) {
  const icon = ICON[e.type];
  switch (e.type) {
    case "status":
      return console.error(`${icon} ${e.message}`);
    case "thinking":
      return console.error(`${icon} ${e.text.replace(/\s+/g, " ").slice(0, 200)}`);
    case "search":
      return console.error(`${icon} ${e.query}`);
    case "fetch":
      return console.error(`${icon} ${e.url}`);
    case "sources":
      return console.error(`${icon} ${e.results.map((r) => r.title).join(" | ").slice(0, 160)}`);
    case "tool":
      return console.error(`${icon} ${e.name} ${JSON.stringify(e.input).slice(0, 140)}`);
    case "tool_result":
      return console.error(`${icon} ${e.name}`);
    case "note":
      return console.error(`${icon} ${e.text.slice(0, 200)}`);
    case "report":
      return console.error(`${icon} trust ${e.report.trustScore}/100 (${e.report.grade}) → ${e.report.verdict}`);
    case "error":
      return console.error(`${icon} ${e.message}`);
  }
}

const report = await runDueDiligence(app, log);
const hash = auditHash(report);
writeFileSync(values.out!, JSON.stringify({ auditHash: hash, report }, null, 2));
console.log(`\nTrust score ${report.trustScore}/100 · grade ${report.grade} · ${report.verdict}`);
console.log(report.summary);
console.log(`auditHash ${hash}\nSaved ${values.out}`);

if (values.publish) {
  if (values.asset === undefined) throw new Error("--publish needs --asset <id>");
  const tx = await publishAudit(BigInt(values.asset), report, hash);
  console.log(`recordAudit tx ${tx}`);
}
