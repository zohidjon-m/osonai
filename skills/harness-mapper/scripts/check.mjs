#!/usr/bin/env node
// Check an Osonai harness before anyone uses it.
//
//   node check.mjs harness/manifest.json [--root <app folder>]
//
// 1. The manifest has the shape the SDK reads (the same rules as checkManifest in packages/core).
// 2. Safety: the model never fills identity or raw IDs, destructive tools ask first, read and write
//    tools return only allowlisted fields.
// 3. With --root: every binding still points at code that exists (file there, function name in it).
//
// Prints one line per problem. Exit 0 = no problems, 1 = problems. No dependencies (Node 18+).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KINDS = ["read", "write", "destructive", "navigate", "local"];
const CONFIRMATIONS = ["none", "confirm", "undo"];
const STATUSES = ["needs_review", "approved", "rejected"];
const CALL_TYPES = ["api_client", "store_action", "mutation", "navigation", "local", "raw_http"];
const NAME_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const ID_RE = /(^id$|_id$|Id$|_ids$|Ids$)/;
const IDENTITY_RE = /(user_?id|account_?id|owner_?id|member_?id|token|session|password|^auth)/i;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => isObj(o) && Object.hasOwn(o, k);

function checkView(v, at, p) {
  if (!isObj(v)) return p.push(`${at}: must be an object`);
  if (v.type !== "list" && v.type !== "detail") p.push(`${at}.type must be "list" or "detail"`);
  if (v.layout && v.layout !== "cards" && v.layout !== "rows") p.push(`${at}.layout must be "cards" or "rows"`);
  if (!v.title) p.push(`${at}.title is missing`);
  if (v.list) {
    if (v.type === "detail") checkView(v.list, `${at}.list`, p);
    else p.push(`${at}.list is only for a detail view`);
  }
}

function checkTool(t, i, p, resolvers, kinds) {
  if (!isObj(t) || typeof t.name !== "string") return p.push(`tools[${i}]: must be an object with a name`);
  const w = t.name;

  // Shape
  if (!NAME_RE.test(t.name)) p.push(`${w}: name must be snake_case, e.g. add_to_cart`);
  if (t.name.startsWith("osonai_")) p.push(`${w}: the osonai_ prefix is reserved`);
  if (typeof t.description !== "string" || !t.description) p.push(`${w}: missing description`);
  if (!KINDS.includes(t.kind)) p.push(`${w}: kind must be one of ${KINDS.join(", ")}`);
  if (!CONFIRMATIONS.includes(t.confirmation)) p.push(`${w}: confirmation must be none or confirm`);
  if (!STATUSES.includes(t.status)) p.push(`${w}: status must be approved, needs_review or rejected`);
  if (t.preload && t.kind !== "read") p.push(`${w}: preload is only for read tools`);

  const b = t.binding;
  if (!isObj(b) || !b.target || !b.call_type) p.push(`${w}: binding needs target and call_type`);
  else if (!CALL_TYPES.includes(b.call_type)) p.push(`${w}: binding.call_type must be one of ${CALL_TYPES.join(", ")}`);
  if (!Array.isArray(t.sources) || !t.sources.length) p.push(`${w}: sources needs at least one "<screen file> — <label>"`);

  // Params
  const params = t.params;
  let props = {};
  if (!isObj(params) || params.type !== "object" || !isObj(params.properties ?? {})) {
    p.push(`${w}: params must be a JSON Schema object`);
  } else {
    props = params.properties ?? {};
    const required = params.required ?? [];
    if (!Array.isArray(required)) p.push(`${w}: params.required must be an array`);
    for (const r of Array.isArray(required) ? required : []) {
      if (!has(props, r)) p.push(`${w}: required param '${r}' is not in properties`);
    }
    for (const [name, s] of Object.entries(props)) {
      if (!isObj(s) || (!has(s, "type") && !has(s, "enum"))) p.push(`${w}: param '${name}' needs a type or enum`);
      else if (!s.description) p.push(`${w}: param '${name}' needs a description (format and an example)`);
      // Safety: the model never says who the user is, and never makes up an ID.
      if (IDENTITY_RE.test(name)) p.push(`${w}: param '${name}' is identity; the binding takes it from the app's auth, not the model`);
      else if (ID_RE.test(name) && !has(t.resolve, name) && !t.bound?.[name]) {
        p.push(`${w}: param '${name}' is an ID the model would invent; take a name and add a resolver`);
      }
    }
  }

  // Bound
  const required = new Set(Array.isArray(params?.required) ? params.required : []);
  for (const [key, spec] of Object.entries(t.bound ?? {})) {
    if (!isObj(spec) || typeof spec.from !== "string") {
      p.push(`${w}: bound.${key} must be { "from": "context.<name>" }`);
      continue;
    }
    if (IDENTITY_RE.test(key) && (spec.overridable || spec.overridable_by)) p.push(`${w}: bound.${key} is identity and must not be overridable`);
    if (spec.overridable && !has(props, key)) p.push(`${w}: bound.${key} is overridable but there is no param '${key}'`);
    if (spec.overridable_by && !has(props, spec.overridable_by)) p.push(`${w}: bound.${key}.overridable_by '${spec.overridable_by}' is not a param`);
    for (const r of [key, spec.overridable_by]) {
      if (r && required.has(r)) p.push(`${w}: '${r}' has a bound default, so it must not be required`);
    }
  }

  // Resolve
  for (const [name, spec] of Object.entries(t.resolve ?? {})) {
    if (!has(props, name)) p.push(`${w}: resolve.${name}: no param '${name}'`);
    if (!isObj(spec) || !spec.resolver || !spec.to_param) p.push(`${w}: resolve.${name} must be { resolver, to_param }`);
    else if (!has(resolvers, spec.resolver)) p.push(`${w}: resolve.${name} uses unknown resolver '${spec.resolver}'`);
  }

  // Safety: confirmation and output
  if (t.kind === "destructive" && t.confirmation !== "confirm") p.push(`${w}: destructive tools need confirmation "confirm"`);
  if ((t.kind === "read" || t.kind === "write") && !(Array.isArray(t.output_fields) && t.output_fields.length)) {
    p.push(`${w}: read and write tools need output_fields (only what the agent needs)`);
  }

  if (t.view !== undefined) checkView(t.view, `${w}: view`, p);
  kinds.set(t.name, t.kind);
}

function check(m, p) {
  if (!isObj(m)) return p.push("manifest must be a JSON object");
  if (m.manifest_version !== 1) p.push("manifest_version must be 1");
  if (!isObj(m.app) || !m.app.name) p.push("app.name is missing");
  if (m.context !== undefined && !(Array.isArray(m.context) && m.context.every((c) => isObj(c) && c.name && c.description))) {
    p.push("context must be a list of { name, description }");
  }
  if (!Array.isArray(m.tools)) return p.push("tools must be a list");
  const resolvers = isObj(m.resolvers) ? m.resolvers : {};

  const kinds = new Map();
  const seen = new Set();
  m.tools.forEach((t, i) => {
    if (seen.has(t?.name)) p.push(`${t.name}: duplicate tool name`);
    seen.add(t?.name);
    checkTool(t, i, p, resolvers, kinds);
  });

  for (const [name, r] of Object.entries(resolvers)) {
    if (!isObj(r) || !r.tool || !r.id_field || !r.name_field) p.push(`resolver '${name}' needs tool, id_field and name_field`);
    else if (!kinds.has(r.tool)) p.push(`resolver '${name}' points at unknown tool '${r.tool}'`);
    else if (kinds.get(r.tool) !== "read") p.push(`resolver '${name}': tool '${r.tool}' must be a read tool`);
  }
  for (const key of ["excluded", "gaps"]) {
    (m[key] ?? []).forEach((x, j) => {
      if (!isObj(x) || !x.action || !x.reason) p.push(`${key}[${j}] needs action and reason`);
    });
  }
}

// Drift: the code each binding points at must still exist.
function checkBindings(m, root, p) {
  const files = new Map();
  for (const t of m.tools ?? []) {
    const b = t?.binding;
    if (t?.status === "rejected" || !isObj(b) || !b.file || !["api_client", "mutation", "store_action"].includes(b.call_type)) continue;
    if (!files.has(b.file)) {
      const path = join(root, b.file);
      files.set(b.file, existsSync(path) ? readFileSync(path, "utf8") : null);
    }
    const text = files.get(b.file);
    if (text === null) {
      p.push(`${t.name}: binding file '${b.file}' does not exist`);
      continue;
    }
    const symbol = String(b.target).split(/[.#:/]/).pop().replace(/\(.*$/, "");
    if (symbol && !text.includes(symbol)) p.push(`${t.name}: '${b.target}' not found in '${b.file}'`);
  }
}

function main(argv) {
  let file = null;
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else file = argv[i];
  }
  if (!file) {
    console.error("usage: check.mjs <manifest.json> [--root <app folder>]");
    return 2;
  }
  let m;
  try {
    m = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`manifest: cannot read (${e.message})`);
    return 1;
  }

  const p = [];
  check(m, p);
  if (root && Array.isArray(m?.tools)) checkBindings(m, root, p);
  for (const line of p) console.log(line);

  const tools = Array.isArray(m?.tools) ? m.tools : [];
  const n = (f) => tools.filter(f).length;
  console.log(
    `\n${tools.length} tools: ${n((t) => t.status === "approved")} approved, ${n((t) => t.status === "needs_review")} to review, ` +
      `${n((t) => t.status === "rejected")} rejected · ${(m.gaps ?? []).length} not mapped · ${(m.excluded ?? []).length} excluded`,
  );
  console.log(p.length ? `${p.length} problems` : "OK");
  return p.length ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
