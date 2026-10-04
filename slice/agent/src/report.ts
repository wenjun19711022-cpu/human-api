import { z } from "zod";

/**
 * The due-diligence report every asset must carry before it can launch.
 * Its hash is written on-chain via SliceHub.recordAudit(); the full JSON is shown to investors.
 */

export const CATEGORIES = ["identity", "registry", "presence", "reputation", "financials", "legal", "license"] as const;
export const CHECK_STATUS = ["pass", "warn", "fail", "unknown"] as const;
export const SEVERITY = ["high", "medium", "low"] as const;

const Evidence = z.object({
  label: z.string(),
  url: z.string(),
});

export const Check = z.object({
  category: z.enum(CATEGORIES),
  title: z.string(),
  status: z.enum(CHECK_STATUS),
  finding: z.string(),
  evidence: z.array(Evidence),
});

export const RiskFlag = z.object({
  severity: z.enum(SEVERITY),
  title: z.string(),
  detail: z.string(),
});

export const Report = z.object({
  trustScore: z.number().int().min(0).max(100),
  grade: z.enum(["A", "B", "C", "D", "F"]),
  verdict: z.enum(["pass", "review", "reject"]),
  summary: z.string(),
  scoreBreakdown: z.object({
    identity: z.number().min(0).max(25),
    registry: z.number().min(0).max(20),
    presence: z.number().min(0).max(20),
    financials: z.number().min(0).max(25),
    legal: z.number().min(0).max(10),
  }),
  metrics: z.object({
    googleRating: z.number().nullable(),
    googleReviewCount: z.number().nullable(),
    instagramFollowers: z.number().nullable(),
    lastSocialPostDays: z.number().nullable(),
    registryStatus: z.string().nullable(),
    yearsOperating: z.number().nullable(),
    avgMonthlyDeposits: z.number().nullable(),
  }),
  checks: z.array(Check),
  riskFlags: z.array(RiskFlag),
  suggestedQuestions: z.array(z.string()),
  monitoring: z.array(z.string()),
});

export type Report = z.infer<typeof Report>;

const nullableNumber = { type: ["number", "null"] };

/** JSON Schema for the submit_report tool (mirrors the Zod schema above). */
export const REPORT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "trustScore",
    "grade",
    "verdict",
    "summary",
    "scoreBreakdown",
    "metrics",
    "checks",
    "riskFlags",
    "suggestedQuestions",
    "monitoring",
  ],
  properties: {
    trustScore: { type: "integer", description: "0-100, the sum of scoreBreakdown." },
    grade: { type: "string", enum: ["A", "B", "C", "D", "F"] },
    verdict: { type: "string", enum: ["pass", "review", "reject"] },
    summary: { type: "string", description: "3-5 sentences an ordinary investor can read in 15 seconds." },
    scoreBreakdown: {
      type: "object",
      additionalProperties: false,
      required: ["identity", "registry", "presence", "financials", "legal"],
      properties: {
        identity: { type: "number", description: "0-25" },
        registry: { type: "number", description: "0-20" },
        presence: { type: "number", description: "0-20 (Google Maps, socials, website, reviews)" },
        financials: { type: "number", description: "0-25" },
        legal: { type: "number", description: "0-10 (licences, lawsuits, liens, sanctions)" },
      },
    },
    metrics: {
      type: "object",
      additionalProperties: false,
      required: [
        "googleRating",
        "googleReviewCount",
        "instagramFollowers",
        "lastSocialPostDays",
        "registryStatus",
        "yearsOperating",
        "avgMonthlyDeposits",
      ],
      properties: {
        googleRating: nullableNumber,
        googleReviewCount: nullableNumber,
        instagramFollowers: nullableNumber,
        lastSocialPostDays: nullableNumber,
        registryStatus: { type: ["string", "null"] },
        yearsOperating: nullableNumber,
        avgMonthlyDeposits: nullableNumber,
      },
    },
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "title", "status", "finding", "evidence"],
        properties: {
          category: { type: "string", enum: [...CATEGORIES] },
          title: { type: "string" },
          status: { type: "string", enum: [...CHECK_STATUS] },
          finding: { type: "string" },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "url"],
              properties: { label: { type: "string" }, url: { type: "string" } },
            },
          },
        },
      },
    },
    riskFlags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "title", "detail"],
        properties: {
          severity: { type: "string", enum: [...SEVERITY] },
          title: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
    suggestedQuestions: {
      type: "array",
      items: { type: "string" },
      description: "Pointed questions the merchant must answer publicly in the Q&A before the round opens.",
    },
    monitoring: {
      type: "array",
      items: { type: "string" },
      description: "Signals to re-check monthly after listing (e.g. 'Google rating below 4.0').",
    },
  },
} as const;

export function gradeFor(score: number): Report["grade"] {
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}
