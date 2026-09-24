/**
 * FAS COMPACTION-SAFETY SUITE (durable: ~/fas-verify/tests/) — regression for
 * the real-runtime compaction failure observed in a live TUI:
 *
 *   Error: Compaction failed: Cannot read properties of undefined (reading 'signal')
 *
 * Root cause (proven against Pi 0.85.1 core, dist/core/agent-session.js):
 *   - `compact()` has NO re-entrancy guard. Each call does:
 *       await this.abort()
 *       this._compactionAbortController = new AbortController()
 *       ... await summarization ...
 *     and its `finally` runs `_clearManualCompactionState()` which sets
 *     `_compactionAbortController = undefined`.
 *   - Two overlapping manual compactions therefore clear each other's
 *     controller: the surviving call later reads
 *     `this._compactionAbortController.signal` -> TypeError
 *     "Cannot read properties of undefined (reading 'signal')".
 *   - `compact()` also begins with `await this.abort()`, so a manual
 *     compaction issued while the agent is still streaming ABORTS the
 *     in-flight turn (observed as an assistant message with
 *     `stopReason:"error"`, `errorMessage:"This operation was aborted"`,
 *     zero usage, immediately before the compaction entry).
 *
 * FAS's `turn_end` handler used to issue `ctx.compact()` on EVERY turn whose
 * context was >85%. `turn_end` fires once per assistant turn — and an agentic
 * response with tool calls produces several turns per user message — so FAS
 * could (and in the live session did) launch overlapping manual compactions,
 * and could abort its own running turn.
 *
 * FAS's own budget contract already declares compaction CORE-DELEGATED
 * ("ctx.compact() triggers Pi's compaction engine above 85% context; execution
 * is Pi core's"): Pi core performs threshold compaction itself, awaited and
 * serialized, via `_compactBeforeNextAssistantResponse` (pre-turn) and
 * `_checkCompaction` (post-turn / pre-prompt, window - reserveTokens). The
 * decision stays in FAS as ADVISORY telemetry; the *execution* must remain
 * Pi core's, so FAS must not issue uncoordinated manual compactions.
 *
 * These tests fail on the pre-fix source (1+ manual compaction requests) and
 * pass on the fixed source (0 requests, telemetry intact).
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

/** Faithful ExtensionContext. `withCompact:false` models a context without the
 *  optional compaction API so the handler is proven not to depend on it. */
function ctxStub(o) {
  const ctx = {
    model: o.model,
    get thinkingLevel() { return o.level; },
    getContextUsage: () => o.usage,
    ui: { notify: (msg, kind) => o.notified.push({ msg, kind }) },
    modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] },
  };
  if (o.withCompact !== false) ctx.compact = () => { o.compact.push(1); };
  return ctx;
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

const REASONER = () => M({ provider: "p", id: "r", reasoning: true, thinkingLevelMap: { off: null, minimal: "min", low: "low", medium: "med", high: "high" } });

/** D1: >85% context must NOT produce a manual compaction request from FAS. */
async function D1() {
  const pi = apiStub();
  core.installFas(pi, deps());
  const compact = [], notified = [];
  pi.thinking = "minimal";
  await pi.handlers["turn_end"][0]({}, ctxStub({
    model: REASONER(), level: "minimal",
    usage: { tokens: 120000, contextWindow: 128000, percent: 93.7 }, compact, notified,
  }));
  assert(compact.length === 0,
    `turn_end >85% must NOT call ctx.compact() (Pi core owns compaction); got ${compact.length} call(s)`);
  assert(pi.setThinking.includes("low"),
    `turn_end >85% must still escalate thinking via pi.setThinkingLevel (set=${pi.setThinking})`);
}

/** D2: multi-round agentic turns (several turn_end events while compacting)
 *  must not accumulate compaction requests — this is the exact crash trigger. */
async function D2() {
  const pi = apiStub();
  core.installFas(pi, deps());
  const compact = [], notified = [];
  pi.thinking = "minimal";
  const usage = { tokens: 118000, contextWindow: 128000, percent: 92 };
  for (let i = 0; i < 5; i++) {
    await pi.handlers["turn_end"][0]({}, ctxStub({ model: REASONER(), level: "minimal", usage, compact, notified }));
  }
  assert(compact.length === 0,
    `5 consecutive high-context turn_ends must not queue overlapping compactions; got ${compact.length}`);
  const states = core.budgetStates();
  assert(states.find((s) => s.budget === "compact").state === "CORE-DELEGATED",
    "compaction stays documented as CORE-DELEGATED");
}

/** D3: the >85% decision stays visible as ADVISORY telemetry. */
async function D3() {
  const hi = core.planBudgets(M({ maxTokens: 8192 }), { tokens: 120000, contextWindow: 128000, percent: 93.7 });
  assert(hi.compact === true && hi.reason === "context-high",
    "planBudgets keeps reporting the >85% compaction decision (advisory)");
  const te = core.budgetStates().find((s) => s.budget === "compact");
  assert(/CORE-DELEGATED/.test(te.state), "budget states keep CORE-DELEGATED label");
}

/** D4: a context without a compaction API must not crash turn_end. */
async function D4() {
  const pi = apiStub();
  core.installFas(pi, deps());
  const notified = [];
  await pi.handlers["turn_end"][0]({}, ctxStub({
    model: REASONER(), level: "minimal",
    usage: { tokens: 121000, contextWindow: 128000, percent: 94.5 }, compact: [], notified, withCompact: false,
  }));
  assert(true, "turn_end survives when ctx.compact is absent");
}

/** D5: mixed agentic loop — high/low context turns still never compact manually. */
async function D5() {
  const pi = apiStub();
  core.installFas(pi, deps());
  const compact = [], notified = [];
  const percents = [86, 88, 90, 50, 92];
  for (const percent of percents) {
    pi.thinking = "minimal";
    await pi.handlers["turn_end"][0]({}, ctxStub({
      model: REASONER(), level: "minimal",
      usage: { tokens: Math.round(128000 * percent / 100), contextWindow: 128000, percent }, compact, notified,
    }));
  }
  assert(compact.length === 0, `mixed loop of ${percents.length} turns → 0 manual compactions; got ${compact.length}`);
  assert(pi.setThinking.length > 0, "mixed loop still performs thinking escalation on high-context turns");
}

await runTest("D1. turn_end >85% does not issue manual compaction", D1);
await runTest("D2. repeated turn_end never queues overlapping compactions", D2);
await runTest("D3. >85% decision remains advisory telemetry", D3);
await runTest("D4. turn_end tolerates a context without compact()", D4);
await runTest("D5. mixed agentic loop never compacts manually", D5);

console.log(`\n=== FAS Compaction-Safety Suite ===`);
console.log(`Passed: ${passed}/${passed + failed}`);
if (failed) { console.error(`Failed: ${failed}`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log("ALL COMPACTION-SAFETY TESTS PASSED");