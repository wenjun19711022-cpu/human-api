import { createHash } from "node:crypto";
import type { Report } from "./report.js";

/** Stable JSON (sorted keys) so the same report always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** bytes32 written to SliceHub.recordAudit(assetId, score, auditHash, approved). */
export function auditHash(report: Report): `0x${string}` {
  return `0x${createHash("sha256").update(canonicalJson(report)).digest("hex")}`;
}
