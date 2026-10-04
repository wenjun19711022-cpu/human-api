// Turns the single-file build (dist/index.html) into a page body for hosts that wrap content in their
// own <html>/<head>/<body> skeleton: same markup, minus the document-level tags.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const body = html
  .replace(/<!doctype html>/i, "")
  .replace(/<\/?html[^>]*>/gi, "")
  .replace(/<\/?head>/gi, "")
  .replace(/<\/?body>/gi, "")
  .replace(/<meta charset="UTF-8"\s*\/?>/i, "")
  .replace(/<meta name="viewport"[^>]*>/i, "")
  .trim();
writeFileSync("dist/slice-exchange.html", body + "\n");
console.log(`dist/slice-exchange.html ${(body.length / 1024).toFixed(0)} KB`);
