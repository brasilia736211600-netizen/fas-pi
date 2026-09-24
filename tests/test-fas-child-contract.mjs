/**
 * FAS ↔ SUBAGENTS CHILD RESULT CONTRACT SUITE (Phase 2B)
 * (durable: ~/fas-verify/tests/)
 *
 * Proves the minimal structured child-result envelope for subagents children:
 *   B1. buildChildResult() emits a fenced `fas-result` JSON block carrying the
 *       minimal envelope: status enum (ok/fail/blocked), required report,
 *       files_modified, files_created, tests_run, problems, conflicts
 *       (string arrays, default []), optional data object.
 *   B2. parseChildResult() validates a fenced block: accepts full + minimal
 *       envelopes, defaults missing arrays to [], passes through data.
 *   B3. parseChildResult() rejects with explicit errors (never throws):
 *       unknown status, empty report, non-string-array fields, malformed JSON,
 *       missing fence, non-object data — raw text always preserved.
 *   B4. Unstructured child text passes through as {valid:false} with raw
 *       preserved (existing behavior unchanged — no breakage).
 *   B5. Envelope composes with the real funnel: canonicalCompletionPayload()
 *       output containing a built envelope still parses valid (parent-side
 *       integration point: publishCompletion attaches the parsed contract
 *       to delivery details without changing existing fields).
 *
 * TDD baseline: B1 FAILS on current source (runtime/child-contract.ts absent).
 */
"use strict";
import { createRequire } from "node:module";
import * as path from "node:path";

const require_ = createRequire(import.meta.url);
const PI = "/data/data/com.termux/files/home/.pi/pi-enhanced";
const HOME = process.env.HOME ?? "/data/data/com.termux/files/home";
const PI_DIST = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const { createJiti } = require_(path.join(PI_DIST, "node_modules/jiti/lib/jiti.cjs"));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
  alias: { "@earendil-works/pi-ai": path.join(PI_DIST, "node_modules/@earendil-works/pi-ai/dist/compat.js") },
});
const contract = await jiti.import(path.join(HOME, ".pi/pi-enhanced/extensions/subagents/runtime/child-contract.ts"));
const prompts = await jiti.import(path.join(HOME, ".pi/pi-enhanced/extensions/subagents/prompts.ts"));

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`ok: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}`); }
}
const isStrArr = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

console.log("B1. build emits fenced envelope with full fields");
{
  const built = contract.buildChildResult({
    status: "ok", report: "Did the thing.",
    files_modified: ["a.ts"], files_created: ["b.ts"],
    tests_run: ["node t.mjs: 3 passed"], problems: [], conflicts: ["none"],
    data: { extra: 1 },
  });
  ok("fenced block present", built.includes("```fas-result") && built.trimEnd().endsWith("```"));
  const body = built.split("```fas-result")[1].split("```")[0];
  const parsed = JSON.parse(body);
  ok("status ok", parsed.status === "ok");
  ok("report kept", parsed.report === "Did the thing.");
  ok("arrays kept", isStrArr(parsed.files_modified) && isStrArr(parsed.tests_run));
  ok("data kept", parsed.data && parsed.data.extra === 1);
}

console.log("B2. parse accepts full + minimal envelopes");
{
  const full = contract.buildChildResult({ status: "fail", report: "Broke.", problems: ["x"] });
  const r1 = contract.parseChildResult(`some preamble\n${full}\ntrailer`);
  ok("full parses valid", r1.valid === true && r1.result.status === "fail");
  ok("missing arrays default []", isStrArr(r1.result.files_modified) && r1.result.files_modified.length === 0);
  const min = contract.buildChildResult({ status: "blocked", report: "Stuck." });
  const r2 = contract.parseChildResult(min);
  ok("minimal parses valid", r2.valid === true && r2.result.status === "blocked");
  ok("report non-empty", r2.result.report === "Stuck.");
}

console.log("B3. parse rejects explicitly, never throws");
{
  const cases = [
    ["bad status", '```fas-result\n{"status":"maybe","report":"r"}\n```'],
    ["empty report", '```fas-result\n{"status":"ok","report":"  "}\n```'],
    ["non-array field", '```fas-result\n{"status":"ok","report":"r","files_modified":"a.ts"}\n```'],
    ["non-string item", '```fas-result\n{"status":"ok","report":"r","problems":[42]}\n```'],
    ["malformed json", '```fas-result\n{"status":\n```'],
    ["array data", '```fas-result\n{"status":"ok","report":"r","data":[1]}\n```'],
  ];
  for (const [name, text] of cases) {
    let r;
    try { r = contract.parseChildResult(text); }
    catch (e) { r = { threw: String(e) }; }
    ok(`${name} -> valid:false + errors`, r.valid === false && Array.isArray(r.errors) && r.errors.length > 0);
    ok(`${name} raw preserved`, typeof r.raw === "string" && r.raw.includes("fas-result"));
  }
}

console.log("B4. unstructured passthrough");
{
  const r = contract.parseChildResult("CHILD-OK\nJust some free text.");
  ok("unstructured valid:false", r.valid === false);
  ok("raw preserved", r.raw === "CHILD-OK\nJust some free text.");
  const r2 = contract.parseChildResult("");
  ok("empty valid:false, no throw", r2.valid === false);
}

console.log("B5. composes with real funnel");
{
  const built = contract.buildChildResult({ status: "ok", report: "Funnel check.", tests_run: ["t: pass"] });
  const payload = prompts.canonicalCompletionPayload("completed", `Summary line.\n${built}`);
  const r = contract.parseChildResult(payload);
  ok("funnel output parses valid", r.valid === true && r.result.report === "Funnel check.");
  const plain = prompts.canonicalCompletionPayload("completed", "no envelope here");
  ok("plain funnel output passthrough", contract.parseChildResult(plain).valid === false);
  const err = prompts.canonicalCompletionPayload("errored", built);
  ok("errored funnel still parses", contract.parseChildResult(err).valid === true);
}

console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
