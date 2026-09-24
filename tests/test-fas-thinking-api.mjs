/**
 * FAS THINKING-LEVEL API SUITE (durable: ~/fas-verify/tests/) — regression for
 * the REAL Pi 0.85.1 context/API surface.
 *
 * Defect (reproduced in a real TUI, 2026-09-20):
 *   `ctx.getThinkingLevel()` / `ctx.setThinkingLevel()` do NOT exist on
 *   ExtensionContext / ExtensionCommandContext. Pi exposes:
 *     - ctx.thinkingLevel          (read-only getter on the context)
 *     - pi.getThinkingLevel()      (ExtensionAPI)
 *     - pi.setThinkingLevel(level) (ExtensionAPI)
 *   The command/event handlers therefore threw TypeError at runtime:
 *     /token-efficiency  -> "FAS: unable to report metrics"
 *     model_select       -> min-thinking enforcement silently no-op (swallowed)
 *     turn_end           -> thinking escalation silently no-op (swallowed)
 *
 * These tests use a FAITHFUL context (thinkingLevel property, no get/set
 * methods) so they fail on the pre-fix source and pass on the fixed source.
 */
"use strict";
import { createRequire } from "node:module";
import * as path from "node:path";

const require_ = createRequire(import.meta.url);
const PI = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const { createJiti } = require_(path.join(PI, "node_modules/jiti/lib/jiti.cjs"));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
  alias: { "@earendil-works/pi-ai": path.join(PI, "node_modules/@earendil-works/pi-ai/dist/compat.js") },
});
const core = await jiti.import("/data/data/com.termux/files/home/.pi/extensions/fas/core.ts");

let passed = 0, failed = 0;
const failures = [];
function assert(c, msg) { if (c) passed++; else { failed++; failures.push(msg); console.error(`  FAIL: ${msg}`); } }
async function runTest(name, fn) {
  console.log(`\n--- ${name} ---`);
  try { await fn(); } catch (e) { failed++; failures.push(`${name}: ${e.message}`); console.error(`  FAIL: ${e.message}`); }
}

const M = (o) => ({
  provider: o.provider, id: o.id, name: o.name ?? o.id,
  reasoning: o.reasoning ?? false, thinkingLevelMap: o.thinkingLevelMap ?? null,
  input: o.input ?? ["text"], cost: o.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: o.contextWindow ?? 128000, maxTokens: o.maxTokens ?? 8192,
  api: o.api ?? "openai-completions", baseUrl: o.baseUrl ?? "https://x",
});

/** Faithful Pi ExtensionAPI stub: thinking level lives on the API, not ctx. */
function apiStub() {
  return {
    registered: [], commands: [], handlers: {},
    thinking: "off", setThinking: [],
    on(ev, h) { (this.handlers[ev] ||= []).push(h); },
    registerCommand(name, opts) { this.commands.push({ name, ...opts }); },
    registerProvider(name, config) { this.registered.push({ name, config }); },
    async setModel() { return true; },
    getThinkingLevel() { return this.thinking; },
    setThinkingLevel(l) { this.thinking = l; this.setThinking.push(l); },
  };
}

/** Faithful ExtensionCommandContext/ExtensionContext stub.
 *  NOTE: intentionally NO getThinkingLevel/setThinkingLevel — as in real Pi. */
function ctxStub(o) {
  return {
    model: o.model,
    get thinkingLevel() { return o.level; },
    getContextUsage: () => o.usage,
    compact: () => { o.compact.push(1); },
    ui: { notify: (msg, kind) => o.notified.push({ msg, kind }) },
    modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] },
  };
}

function deps() {
  return {
    getCurrentModel: () => undefined, findModel: () => undefined,
    getCandidates: () => [], getAvailable: () => [], fallbackModel: () => undefined,
    getAuth: async () => ({ ok: true, apiKey: "k" }),
    streamCandidate: async function* () { yield { type: "done", message: {} }; },
    createEventStream: () => ({ push() {}, end() {} }),
    now: () => 1, log: () => {},
    loadKnowledge: () => core.newEvidenceStore(), saveKnowledge: () => {},
  };
}

async function T1() {
  const pi = apiStub();
  core.installFas(pi, deps());
  const notified = [];
  const te = pi.commands.find((c) => c.name === "token-efficiency");
  await te.handler("", ctxStub({ model: M({ provider: "p", id: "r", reasoning: true }), level: "medium", usage: { tokens: 100, contextWindow: 128000, percent: 0.1 }, compact: [], notified }));
  const msgs = notified.map((n) => n.msg).join("\n");
  assert(msgs.includes("FAS Token Efficiency Report"), "token-efficiency renders report (not the error fallback)");
  assert(!msgs.includes("unable to report metrics"), "token-efficiency does NOT hit the crash fallback");
  assert(msgs.includes("Thinking Level: medium"), "token-efficiency reports the real ctx.thinkingLevel");
  assert(notified.every((n) => n.kind === "info"), "token-efficiency notifies as info");
}

async function T2() {
  const pi = apiStub();
  core.installFas(pi, deps());
  const notified = [], compact = [];
  const reasoner = M({ provider: "p", id: "r", reasoning: true, thinkingLevelMap: { off: null, minimal: "min", low: "low" } });
  await pi.handlers["model_select"][0]({}, ctxStub({ model: reasoner, level: "off", usage: null, compact, notified }));
  assert(pi.thinking === "minimal", `model_select raises off→minimal via pi.setThinkingLevel (got ${pi.thinking})`);
  assert(pi.setThinking.includes("minimal"), "model_select used the API setter, not ctx");
}

async function T3() {
  const pi = apiStub();
  core.installFas(pi, deps());
  const compact = [], notified = [];
  const nonReasoning = M({ provider: "p", id: "plain", reasoning: false });
  await pi.handlers["model_select"][0]({}, ctxStub({ model: nonReasoning, level: "medium", usage: null, compact, notified }));
  assert(pi.thinking === "off", `model_select forces off for non-reasoning model (got ${pi.thinking})`);
}

async function T4() {
  const pi = apiStub();
  core.installFas(pi, deps());
  const compact = [], notified = [];
  const reasoner = M({ provider: "p", id: "r", reasoning: true, thinkingLevelMap: { off: null, minimal: "min", low: "low", medium: "med", high: "high" } });
  pi.thinking = "minimal";
  await pi.handlers["turn_end"][0]({}, ctxStub({ model: reasoner, level: "minimal", usage: { tokens: 120000, contextWindow: 128000, percent: 93.7 }, compact, notified }));
  // CORE-DELEGATED: FAS decides, Pi core executes (turn_end must not call ctx.compact —
  // Pi 0.85.1 compact() has no re-entrancy guard and aborts the in-flight turn).
  assert(compact.length === 0, ">85% context → no manual compaction request (CORE-DELEGATED)");
  assert(pi.setThinking.includes("low"), `>85% context escalates thinking via pi.setThinkingLevel (set=${pi.setThinking})`);
}

async function T5() {
  const pi = apiStub();
  core.installFas(pi, deps());
  const compact = [], notified = [];
  const reasoner = M({ provider: "p", id: "r", reasoning: true, thinkingLevelMap: { off: null, minimal: "min", low: "low" } });
  pi.thinking = "medium";
  await pi.handlers["turn_end"][0]({}, ctxStub({ model: reasoner, level: "medium", usage: { tokens: 1, contextWindow: 128000, percent: 0 }, compact, notified }));
  assert(compact.length === 0, "low usage → no compaction");
  assert(pi.setThinking.length === 0, "low usage → no thinking change");
}

await runTest("A1. token-efficiency on faithful command context", T1);
await runTest("A2. model_select min-thinking via API setter", T2);
await runTest("A3. model_select off for non-reasoning", T3);
await runTest("A4. turn_end compaction + evidence escalation", T4);
await runTest("A5. turn_end low-context no-op", T5);

console.log(`\n=== FAS Thinking-API Suite ===`);
console.log(`Passed: ${passed}/${passed + failed}`);
if (failed) { console.error(`Failed: ${failed}`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log("ALL THINKING-API TESTS PASSED");