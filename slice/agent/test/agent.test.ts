import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { cashflowForensics } from "../src/tools/forensics.js";
import { enforceRubric, runDueDiligence, type AgentEvent } from "../src/agent.js";
import { Application } from "../src/application.js";
import { auditHash } from "../src/hash.js";
import type { Report } from "../src/report.js";

const steady = Array.from({ length: 12 }, (_, i) => ({ period: `2026-${i + 1}`, amount: 100_000 + (i % 3) * 2_000 }));

test("forensics: steady business raises no flags", () => {
  const r = cashflowForensics({ monthly: steady, claimedMonthlyRevenue: 101_000 });
  assert.equal(r.months, 12);
  assert.deepEqual(r.flags, []);
  assert.ok(r.coefficientOfVariation < 0.05);
});

test("forensics: spike, short history and inflated claim are flagged", () => {
  const r = cashflowForensics({
    monthly: [
      { period: "a", amount: 40_000 },
      { period: "b", amount: 42_000 },
      { period: "c", amount: 120_000 },
    ],
    claimedMonthlyRevenue: 150_000,
  });
  const codes = r.flags.map((f) => f.split(":")[0]);
  assert.ok(codes.includes("SHORT_HISTORY"));
  assert.ok(codes.includes("SPIKE"));
  assert.ok(codes.includes("CLAIM_MISMATCH"));
});

test("forensics: round-number cash deposits and Benford deviation", () => {
  const tx = Array.from({ length: 80 }, (_, i) => (i % 2 ? 9_000 : 8_000));
  const r = cashflowForensics({ monthly: steady, transactions: tx });
  assert.equal(r.roundNumberShare, 1);
  assert.ok(r.benford?.suspicious);
});

const baseReport: Report = {
  trustScore: 99,
  grade: "A",
  verdict: "pass",
  summary: "s",
  scoreBreakdown: { identity: 20, registry: 18, presence: 14, financials: 15, legal: 5 },
  metrics: {
    googleRating: 4.6,
    googleReviewCount: 1284,
    instagramFollowers: null,
    lastSocialPostDays: null,
    registryStatus: "Active",
    yearsOperating: 6,
    avgMonthlyDeposits: 98_000,
  },
  checks: [],
  riskFlags: [{ severity: "high", title: "Liquor licence not found", detail: "d" }],
  suggestedQuestions: [],
  monitoring: [],
};

test("rubric: score is the sum, grade follows score, high flag blocks pass", () => {
  const r = enforceRubric(baseReport);
  assert.equal(r.trustScore, 72);
  assert.equal(r.grade, "C");
  assert.equal(r.verdict, "review");
  assert.equal(enforceRubric({ ...baseReport, scoreBreakdown: { ...baseReport.scoreBreakdown, identity: 0 } }).verdict, "reject");
});

test("auditHash is stable under key order", () => {
  const reverse = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(reverse)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)]))
        : v;
  const shuffled = reverse(baseReport) as Report;
  assert.notEqual(JSON.stringify(shuffled), JSON.stringify(baseReport));
  assert.equal(auditHash(baseReport), auditHash(shuffled));
});

/** Minimal stand-in for client.beta.messages.stream(): replays scripted assistant turns. */
function stubClient(turns: Anthropic.Beta.BetaContentBlock[][]) {
  const requests: Anthropic.Beta.MessageCreateParams[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        stream(params: Anthropic.Beta.MessageCreateParams) {
          requests.push(structuredClone(params));
          const content = turns[i++];
          const listeners: ((b: Anthropic.Beta.BetaContentBlock) => void)[] = [];
          return {
            on(event: string, fn: (b: Anthropic.Beta.BetaContentBlock) => void) {
              if (event === "contentBlock") listeners.push(fn);
              return this;
            },
            async finalMessage() {
              content.forEach((b) => listeners.forEach((fn) => fn(b)));
              const stop = content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
              return { content, stop_reason: stop, stop_details: null } as unknown as Anthropic.Beta.BetaMessage;
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}

test("agent loop: runs tools, rejects an invalid report, accepts a valid one", async () => {
  const app = Application.parse({
    business: { name: "Neon Coyote Bar", category: "bar", country: "US", city: "Los Angeles" },
    owner: { fullName: "Jordan Example" },
    registry: { entityName: "Neon Coyote Bar LLC", jurisdiction: "us_ca" },
    offering: { instrument: "equity", percentOffered: 30, targetRaise: 300000, dividendPerPeriod: 9000, periodDays: 90 },
  });
  const { client, requests } = stubClient([
    [
      { type: "thinking", thinking: "Check the deposits first.", signature: "x" } as Anthropic.Beta.BetaContentBlock,
      { type: "tool_use", id: "t1", name: "cashflow_forensics", input: { monthly: steady } } as Anthropic.Beta.BetaContentBlock,
    ],
    [{ type: "tool_use", id: "t2", name: "submit_report", input: { trustScore: "high" } } as Anthropic.Beta.BetaContentBlock],
    [{ type: "tool_use", id: "t3", name: "submit_report", input: baseReport } as Anthropic.Beta.BetaContentBlock],
  ]);
  const events: AgentEvent[] = [];
  const report = await runDueDiligence(app, (e) => events.push(e), { client });

  assert.equal(report.trustScore, 72);
  assert.equal(report.verdict, "review");
  assert.equal(requests.length, 3);
  assert.equal(requests[0].model, "claude-opus-5-5");
  // Turn 2 carried the forensics result back; turn 3 carried the validation error for the bad report.
  const last = (r: Anthropic.Beta.MessageCreateParams) => r.messages[r.messages.length - 1].content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.equal(last(requests[1])[0].tool_use_id, "t1");
  assert.equal(last(requests[2])[0].is_error, true);
  assert.ok(events.some((e) => e.type === "thinking"));
  assert.ok(events.some((e) => e.type === "tool" && e.name === "cashflow_forensics"));
  assert.ok(events.some((e) => e.type === "report"));
});
