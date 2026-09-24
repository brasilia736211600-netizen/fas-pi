/**
 * FAS ROLE + CAPABILITY ROUTING SUITE (Phase 2C)
 * (durable: ~/fas-verify/tests/)
 *
 * Proves role mapping uses ONLY the existing centralized FAS scorer/ranker:
 *   C1. roleTaskConstraints() returns exact constraint objects for the 5 roles
 *       (explorer/implementer/tester/reviewer/debugger); every key is an
 *       existing hardFilter/scorer field (no second ranker, no weights).
 *   C2. Unknown role throws (fail fast); no auto-classifier is exported
 *       (no LLM role inference: resolveRole/classifyRole must not exist).
 *   C3. Routing is deterministic per role (same pool+KB ×3 → identical order).
 *   C4. Role constraints steer the EXISTING ranker: explorer prefers
 *       non-reasoning; debugger filters to reasoning-capable; reviewer enforces
 *       min context; implementer is unconstrained; tester routes on evidence.
 *   C5. Fallback preserved: all-penalized pool still returns candidates
 *       (rankCandidates fail-safe), with role constraints applied.
 *   C6. rolePromptSnippet() carries the fas-result fence + role-required fields;
 *       validateRoleContract() enforces them (tester ok requires tests_run).
 *
 * TDD baseline: C1 FAILS on current source (fas/roles.ts absent).
 */
"use strict";
import { createRequire } from "node:module";
import * as path from "node:path";

const require_ = createRequire(import.meta.url);
const HOME = process.env.HOME ?? "/data/data/com.termux/files/home";
const PI_DIST = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const { createJiti } = require_(path.join(PI_DIST, "node_modules/jiti/lib/jiti.cjs"));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
  alias: { "@earendil-works/pi-ai": path.join(PI_DIST, "node_modules/@earendil-works/pi-ai/dist/compat.js") },
});
const roles = await jiti.import(path.join(HOME, ".pi/extensions/fas/roles.ts"));
const fasCore = await jiti.import(path.join(HOME, ".pi/extensions/fas/core.ts"));

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`ok: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}`); }
}
const keyOf = (m) => `${m.provider}/${m.id}`;

// Fixture pool: varied metadata, zero evidence (equal footing).
const POOL = [
  { provider: "p1", id: "cheap-think", reasoning: true, contextWindow: 200000, cost: { input: 1 }, input: ["text"] },
  { provider: "p1", id: "cheap-plain", reasoning: false, contextWindow: 64000, cost: { input: 0.5 }, input: ["text"] },
  { provider: "p2", id: "big-plain", reasoning: false, contextWindow: 1000000, cost: { input: 5 }, input: ["text"] },
  { provider: "p2", id: "tiny", reasoning: false, contextWindow: 8000, cost: { input: 0.2 }, input: ["text"] },
];
const EMPTY_STORE = { version: 1, updatedAt: 0, stats: {} };
const route = (role, store = EMPTY_STORE) =>
  fasCore.rankCandidates(fasCore.discoverCandidates(POOL, POOL), roles.roleTaskConstraints(role), store).map(keyOf);

console.log("C1. exact constraint shapes, existing fields only");
{
  const ALLOWED = new Set(["requiredInput", "minContextWindow", "needsReasoning", "excludedProviders", "excludedModels", "preferredProvider"]);
  for (const r of ["explorer", "implementer", "tester", "reviewer", "debugger"]) {
    const c = roles.roleTaskConstraints(r);
    ok(`${r} is object`, c && typeof c === "object");
    ok(`${r} keys all pre-existing`, Object.keys(c).every((k) => ALLOWED.has(k)));
    ok(`${r} has no weights/scores`, !("weight" in c || "score" in c || "rank" in c));
  }
  ok("explorer needsReasoning false", roles.roleTaskConstraints("explorer").needsReasoning === false);
  ok("implementer unconstrained", Object.keys(roles.roleTaskConstraints("implementer")).length === 0);
  ok("debugger needsReasoning true", roles.roleTaskConstraints("debugger").needsReasoning === true);
  ok("reviewer sets minContextWindow", (roles.roleTaskConstraints("reviewer").minContextWindow ?? 0) > 0);
}

console.log("C2. unknown role throws; no auto-classifier");
{
  let threw = false;
  try { roles.roleTaskConstraints("researcher"); } catch { threw = true; }
  ok("unknown role throws", threw);
  ok("no resolveRole export", typeof roles.resolveRole === "undefined");
  ok("no classifyRole export", typeof roles.classifyRole === "undefined");
}

console.log("C3. deterministic per role");
{
  for (const r of ["explorer", "implementer", "tester", "reviewer", "debugger"]) {
    const a = JSON.stringify(route(r)), b = JSON.stringify(route(r)), c = JSON.stringify(route(r));
    ok(`${r} deterministic x3`, a === b && b === c);
  }
}

console.log("C4. constraints steer existing ranker");
{
  const exp = route("explorer");
  const expTop = POOL.find((m) => keyOf(m) === exp[0]);
  ok("explorer top is non-reasoning", !!expTop && expTop.reasoning === false);
  const dbg = route("debugger");
  ok("debugger only reasoning-capable", dbg.length === 1 && dbg[0] === "p1/cheap-think");
  const rev = route("reviewer");
  ok("reviewer drops tiny-context", !rev.includes("p2/tiny") && rev.length === 3);
  const imp = route("implementer");
  ok("implementer sees full pool", imp.length === 4);
  let store = EMPTY_STORE;
  store = fasCore.recordOutcome(store, { provider: "p1", id: "cheap-plain", ok: true, latencyMs: 1000, tokens: 10 });
  const tst = route("tester", store);
  ok("tester routes on evidence", tst[0] === "p1/cheap-plain");
}

console.log("C5. fallback preserved under roles");
{
  let store = EMPTY_STORE;
  for (const m of POOL)
    for (let i = 0; i < 5; i++)
      store = fasCore.recordOutcome(store, { provider: m.provider, id: m.id, ok: false, kind: "execution", latencyMs: 100 });
  for (const r of ["explorer", "implementer", "debugger"]) {
    const ranked = fasCore.rankCandidates(fasCore.discoverCandidates(POOL, POOL), roles.roleTaskConstraints(r), store);
    ok(`${r} fail-safe returns pool`, ranked.length > 0);
  }
}

console.log("C6. snippets + role validation");
{
  for (const r of ["explorer", "implementer", "tester", "reviewer", "debugger"]) {
    const s = roles.rolePromptSnippet(r);
    ok(`${r} snippet has fence`, typeof s === "string" && s.includes("fas-result"));
  }
  ok("tester snippet names tests_run", roles.rolePromptSnippet("tester").includes("tests_run"));
  const bad = roles.validateRoleContract("tester", { status: "ok", report: "done", tests_run: [] });
  ok("tester ok without tests_run rejected", bad.valid === false && bad.errors.length > 0);
  const good = roles.validateRoleContract("tester", { status: "ok", report: "done", tests_run: ["t: pass"] });
  ok("tester ok with tests_run accepted", good.valid === true);
  const exp = roles.validateRoleContract("explorer", { status: "ok", report: "done" });
  ok("explorer minimal accepted", exp.valid === true);
  const blk = roles.validateRoleContract("tester", { status: "blocked", report: "stuck" });
  ok("blocked needs no tests", blk.valid === true);
}

console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
