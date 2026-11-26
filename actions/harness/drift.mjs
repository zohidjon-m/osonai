#!/usr/bin/env node
// Drift check for the Osonai harness Action: every binding still points at code that exists (its file is
// there, and the function's name is in it). The manifest rules themselves are checked by the Osonai server
// (POST /v1/osonai/manifest/check); this part needs the app's code, so it runs here, on the CI machine.
//
//   node drift.mjs harness/manifest.json --root <app folder>
//
// One line per problem. Exit 0 = none, 1 = problems. No dependencies.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--root");
const rootAt = args.indexOf("--root");
const root = rootAt >= 0 ? args[rootAt + 1] : ".";
if (!file) {
  console.error("usage: drift.mjs <manifest.json> [--root <app folder>]");
  process.exit(2);
}

const m = JSON.parse(readFileSync(file, "utf8"));
const problems = [];
const files = new Map();
for (const t of Array.isArray(m.tools) ? m.tools : []) {
  const b = t?.binding;
  if (t?.status === "rejected" || !b?.file || !["api_client", "mutation", "store_action"].includes(b.call_type)) continue;
  if (!files.has(b.file)) {
    const path = join(root, b.file);
    files.set(b.file, existsSync(path) ? readFileSync(path, "utf8") : null);
  }
  const text = files.get(b.file);
  if (text === null) {
    problems.push(`${t.name}: binding file '${b.file}' does not exist`);
    continue;
  }
  const symbol = String(b.target).split(/[.#:/]/).pop().replace(/\(.*$/, "");
  if (symbol && !text.includes(symbol)) problems.push(`${t.name}: '${b.target}' not found in '${b.file}'`);
}
for (const line of problems) console.log(line);
console.log(problems.length ? `${problems.length} bindings point at code that is gone` : "Bindings: OK");
process.exit(problems.length ? 1 : 0);
