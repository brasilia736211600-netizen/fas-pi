/**
 * FAS CONSOLIDATION TESTS — final integration pass (durable copy: ~/fas-verify/tests/)
 *
 * C1  real index.ts loads via jiti; provider + 4 commands registered
 * C2  composed-provider dispatch wiring (registry.getProvider().streamSimple)
 * C3  command handler bodies end-to-end: on/off/status/token-efficiency
 * C4  no-previous-model fail-safe → complete AssistantMessage
 * C5  transparent fallthrough: no duplicate streamed content
 * C6  knowledge-bound stress: >200 records, eviction, recent cap, maxAttempts,
 *     corrupt recovery, reload persistence — real fs in a temp dir
 * C7  redact deep audit: headers, nested arrays, numeric retention
 * C8  compaction decision boundary: FAS decides (>85%), core performs
 * C9  persist stamps recency (at) so eviction is recency-based, not alphabetical
 */
"use strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const require_ = createRequire(import.meta.url);
const PI = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const { createJiti } = require_(path.join(PI, "node_modules/jiti/lib/jiti.cjs"));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
  alias: { "@earendil-works/pi-ai": path.join(PI, "node_modules/@earendil-works/pi-ai/dist/compat.js") },
});

const core = await jiti.import("/data/data/com.termux/files/home/.pi/extensions/fas/core.ts");
const indexMod = await jiti.import("/data/data/com.termux/files/home/.pi/extensions/fas/index.ts");

let passed = 0, failed = 0;
const failures = [];
function assert(c, msg) { if (c) passed++; else { failed++; failures.push(msg); console.error(`  FAIL: ${msg}`); } }
async function runTest(name, fn) {
  console.log(`\n--- ${name} ---`);
  try { await fn(); } catch (e) { failed++; failures.push(`${name}: ${e.message}`); console.error(`  FAIL: ${e.message}`); }
}
async function waitFor(cond, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return false;
}
const M = (o) => ({
  provider: o.provider, id: o.id, name: o.name ?? o.id,
  reasoning: o.reasoning ?? false, thinkingLevelMap: o.thinkingLevelMap ?? null,
  input: o.input ?? ["text"], cost: o.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: o.contextWindow ?? 128000, maxTokens: o.maxTokens ?? 8192,
  api: o.api ?? "openai-completions", baseUrl: o.baseUrl ?? "https://x",
});

function fakePi() {
  return {
    registered: [], commands: [], setModelCalls: [], handlers: {}, thinking: "off", setThinking: [],
    on(ev, h) { (this.handlers[ev] ||= []).push(h); },
    registerCommand(name, opts) { this.commands.push({ name, ...opts }); },
    registerProvider(name, config) { this.registered.push({ name, config }); },
    async setModel(m) { this.setModelCalls.push(m); return true; },
    getThinkingLevel() { return this.thinking; },
    setThinkingLevel(l) { this.thinking = l; this.setThinking.push(l); },
  };
}
async function fireHandlers(pi, ev, ctx) { for (const h of pi.handlers[ev] ?? []) await h({}, ctx); }
function streamPi() {
  return { registered: [], commands: [], handlers: {}, on() {}, registerCommand() {}, registerProvider(n, c) { this.registered.push({ name: n, config: c }); }, async setModel() { return true; } };
}

// ── C1: real index.ts load + registration ──
async function C1() {
  assert(typeof indexMod.default === "function", "C1: index.ts default export is a factory");
  const pi = fakePi();
  indexMod.default(pi);
  const reg = pi.registered.find((r) => r.name === "fas-router");
  assert(!!reg, "C1: fas-router provider registered by real index.ts");
  assert(reg.config.models[0].id === "auto", "C1: model auto");
  assert(typeof reg.config.streamSimple === "function", "C1: streamSimple wired");
  for (const c of ["fas-router:on", "fas-router:off", "fas-router:status", "token-efficiency"]) {
    assert(pi.commands.some((x) => x.name === c), `C1: command ${c} registered`);
  }
}

// ── C2: composed-provider dispatch wiring ──
async function C2() {
  let composedCalled = 0;
  const composed = {
    streamSimple: async function* () {
      composedCalled++;
      yield { type: "done", message: { role: "assistant", content: [{ type: "text", text: "VIA-COMPOSED" }] } };
    },
  };
  const registry = { getProvider: (id) => (id === "prov-a" ? composed : undefined), getAll: () => [], getAvailable: () => [] };
  const dispatch = core.makeStreamCandidate({ getRegistry: () => registry }, () => { throw new Error("compat must not be used"); });
  const out = [];
  for await (const ev of dispatch(M({ provider: "prov-a", id: "x" }), { messages: [] }, {})) out.push(ev);
  assert(composedCalled === 1, `C2: composed provider streamSimple invoked (got ${composedCalled})`);
  assert(out.some((e) => e.type === "done"), "C2: candidate output forwarded");
  // compat fallback when provider absent / lacks streamSimple
  let compatCalled = 0;
  const compat = () => { compatCalled++; return (async function* () { yield { type: "done", message: {} }; })(); };
  const d2 = core.makeStreamCandidate({ getRegistry: () => undefined }, compat);
  for await (const _ of d2(M({ provider: "zai", id: "glm" }), { messages: [] }, {})) { /* drain */ }
  assert(compatCalled === 1, "C2: compat used when registry unavailable");
  const d3 = core.makeStreamCandidate({ getRegistry: () => ({ getProvider: () => ({}) }) }, compat);
  for await (const _ of d3(M({ provider: "zai", id: "glm" }), { messages: [] }, {})) { /* drain */ }
  assert(compatCalled === 2, "C2: compat used when composed provider lacks streamSimple");
}

// ── C3: command handler bodies end-to-end ──
async function C3() {
  const pi = fakePi();
  const notified = [];
  const routerModel = M({ provider: "fas-router", id: "auto" });
  const current = M({ provider: "zai", id: "glm-4.7-flash" });
  const registry = {
    find: (p, i) => (p === "fas-router" && i === "auto" ? routerModel : undefined),
    getAll: () => [current, M({ provider: "kilo", id: "k2" })],
    getAvailable: () => [],
  };
  const deps = {
    getCurrentModel: () => current,
    findModel: (p, i) => registry.find(p, i),
    getCandidates: () => registry.getAll(),
    getAvailable: () => registry.getAvailable(),
    fallbackModel: () => current,
    getAuth: async () => ({ ok: true, apiKey: "k" }),
    streamCandidate: async function* () { yield { type: "done", message: {} }; },
    createEventStream: () => ({ push() {}, end() {} }),
    now: () => 1_700_000_000_000,
    log: () => {},
    loadKnowledge: () => core.newEvidenceStore(),
    saveKnowledge: () => {},
    maxAttempts: 3,
  };
  core.installFas(pi, deps);
  const mkCtx = (model) => ({
    model,
    modelRegistry: registry,
    thinkingLevel: "off",
    getContextUsage: () => ({ tokens: 10000, contextWindow: 128000, percent: 7.8 }),
    ui: { notify: (msg, kind) => notified.push({ msg, kind }) },
  });

  const on = pi.commands.find((c) => c.name === "fas-router:on");
  await on.handler("", mkCtx(current));
  assert(pi.setModelCalls.length === 1 && pi.setModelCalls[0].provider === "fas-router", "C3: on → setModel(fas-router/auto)");
  assert(notified.some((n) => n.msg.includes("FAS router active")), "C3: on → success notify");

  const off = pi.commands.find((c) => c.name === "fas-router:off");
  await off.handler("", mkCtx(routerModel));
  assert(pi.setModelCalls.length === 2 && pi.setModelCalls[1].provider === "zai", "C3: off → setModel(previous zai)");
  assert(notified.some((n) => n.msg.includes("disabled")), "C3: off → success notify");

  // production wiring: fallbackModel is the same captured previousModel
  const pi2 = fakePi();
  core.installFas(pi2, { ...deps, getCurrentModel: () => undefined, fallbackModel: () => undefined });
  const off2 = pi2.commands.find((c) => c.name === "fas-router:off");
  await off2.handler("", mkCtx(routerModel));
  assert(pi2.setModelCalls.length === 0, "C3: off with no previous → no setModel");
  assert(notified.some((n) => (n.msg || "").includes("no previous model")), "C3: off with no previous → warning");

  const status = pi.commands.find((c) => c.name === "fas-router:status");
  const before = notified.length;
  await status.handler("", mkCtx(routerModel));
  const statusMsg = notified.slice(before).map((n) => n.msg).join("\n");
  assert(statusMsg.includes("FAS Router Status"), "C3: status renders header");
  assert(statusMsg.includes("Candidates: 2"), "C3: status lists candidate count");
  assert(statusMsg.includes("zai:") || statusMsg.includes("kilo:"), "C3: status lists provider shortlists");

  const te = pi.commands.find((c) => c.name === "token-efficiency");
  const before2 = notified.length;
  await te.handler("", mkCtx(routerModel));
  const teMsg = notified.slice(before2).map((n) => n.msg).join("\n");
  assert(teMsg.includes("Budget maxOutputTokens: ENFORCED"), "C3: token-efficiency lists ENFORCED");
  assert(teMsg.includes("Budget compact: CORE-DELEGATED"), "C3: token-efficiency lists CORE-DELEGATED");
  assert(teMsg.includes("Budget maxRounds: ADVISORY-ONLY"), "C3: token-efficiency lists ADVISORY-ONLY");
  assert(teMsg.includes("Budget trim: ADVISORY-ONLY"), "C3: token-efficiency lists trim ADVISORY-ONLY");
  assert(teMsg.includes("Round Budget:"), "C3: token-efficiency keeps Round Budget line");
}

// ── C4: no-previous-model fail-safe ──
async function C4() {
  const events = [];
  const pi = streamPi();
  const deps = {
    getCandidates: () => [M({ provider: "a", id: "1" })],
    getAvailable: () => undefined,
    getAuth: async () => ({ ok: true, apiKey: "k" }),
    streamCandidate: async function* () { yield { type: "error", reason: "error", error: { errorMessage: "boom", stopReason: "error" } }; },
    createEventStream: () => ({ push: (e) => events.push(e), end: (m) => events.push({ type: "__ended", final: m }) }),
    fallbackModel: () => undefined,
    findModel: () => undefined,
    getCurrentModel: () => undefined,
    now: () => 1_700_000_000_000,
    log: () => {},
    loadKnowledge: () => core.newEvidenceStore(),
    saveKnowledge: () => {},
    maxAttempts: 3,
  };
  core.installFas(pi, deps);
  const reg = pi.registered.find((r) => r.name === "fas-router");
  reg.config.streamSimple({ provider: "fas-router", id: "auto", api: "openai-completions" }, { messages: [] }, {});
  await waitFor(() => events.some((e) => e.type === "__ended"));
  const final = events.find((e) => e.type === "__ended")?.final;
  const err = events.find((e) => e.type === "error")?.error;
  for (const [label, m] of [["error-event", err], ["final", final]]) {
    assert(m && Array.isArray(m.content), `C4: ${label} content array`);
    assert(m?.role === "assistant", `C4: ${label} role assistant`);
    assert(m?.stopReason === "error", `C4: ${label} stopReason error`);
    assert(typeof m?.errorMessage === "string" && m.errorMessage.length > 0, `C4: ${label} errorMessage`);
  }
  const toolCalls = err.content.filter((c) => c.type === "toolCall");
  assert(Array.isArray(toolCalls), "C4: agent-loop content.filter survives");
}

// ── C5: transparent fallthrough, no duplicate content ──
async function C5() {
  const events = [];
  const pushedText = () => events.filter((e) => e.type === "text_delta").map((e) => e.delta);
  const cands = [M({ provider: "a", id: "1" }), M({ provider: "b", id: "2" }), M({ provider: "c", id: "3" })];
  const base = {
    getCandidates: () => cands,
    getAuth: async () => ({ ok: true, apiKey: "k" }),
    createEventStream: () => ({ push: (e) => events.push(e), end: (m) => events.push({ type: "__ended", final: m }) }),
    fallbackModel: () => undefined,
    findModel: () => undefined,
    getCurrentModel: () => undefined,
    now: () => 1_700_000_000_000,
    log: () => {},
    loadKnowledge: () => core.newEvidenceStore(),
    saveKnowledge: () => {},
    maxAttempts: 3,
  };
  const deps = {
    ...base,
    streamCandidate: async function* (m) {
      if (m.provider === "a") { yield { type: "text_delta", contentIndex: 0, delta: "PARTIAL", partial: {} }; yield { type: "error", reason: "error", error: { errorMessage: "mid-stream", stopReason: "error" } }; }
      else if (m.provider === "b") { yield { type: "error", reason: "error", error: { errorMessage: "429", stopReason: "error" } }; }
      else { yield { type: "done", message: { role: "assistant", content: [{ type: "text", text: "FINAL-OK" }], stopReason: "stop", usage: { input: 1, output: 1 } } }; }
    },
  };
  const pi = streamPi();
  core.installFas(pi, deps);
  pi.registered.find((r) => r.name === "fas-router").config.streamSimple({ provider: "fas-router", id: "auto" }, { messages: [] }, {});
  await waitFor(() => events.some((e) => e.type === "__ended"));
  assert(pushedText().filter((t) => t === "PARTIAL").length === 1, "C5: partial content streamed exactly once");
  const final = events.find((e) => e.type === "__ended")?.final;
  assert(final?.stopReason === "error", "C5: failure-after-content → terminal error, no retry after output");
  assert(!pushedText().includes("FINAL-OK"), "C5: no late retry output after content was streamed");

  // all-fail (clean, no partial content) → complete error
  const events2 = [];
  const deps2 = {
    ...base,
    streamCandidate: async function* () { yield { type: "error", reason: "error", error: { errorMessage: "fail", stopReason: "error" } }; },
    createEventStream: () => ({ push: (e) => events2.push(e), end: (m) => events2.push({ type: "__ended", final: m }) }),
  };
  const pi2 = streamPi();
  core.installFas(pi2, deps2);
  pi2.registered.find((r) => r.name === "fas-router").config.streamSimple({ provider: "fas-router", id: "auto" }, { messages: [] }, {});
  await waitFor(() => events2.some((e) => e.type === "__ended"));
  const final2 = events2.find((e) => e.type === "__ended")?.final;
  assert(final2?.stopReason === "error" && Array.isArray(final2?.content), "C5: all-fail + no fallback → complete error result");
  assert(events2.filter((e) => e.type === "text_delta").length === 0, "C5: no partial content in all-fail path");
}

// ── C6: knowledge-bound stress (real fs in temp dir) ──
async function C6() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fas-stress-"));
  const kb = path.join(dir, "fas-knowledge.json");
  const MAX_RECENT = 100;
  let store = core.newEvidenceStore();
  let recent = [];
  const save = () => { fs.mkdirSync(path.dirname(kb), { recursive: true }); fs.writeFileSync(kb, JSON.stringify({ version: 1, updatedAt: Date.now(), stats: store.stats, recent: recent.slice(-MAX_RECENT) })); };
  let clock = 1_000_000;
  const record = (rec) => { store = core.recordOutcome(store, { ...rec, at: (clock += 100) }); const built = core.buildEvidenceRecord(rec); recent.push({ type: "fas-evidence", ...core.redact(built) }); save(); };

  for (let i = 0; i < 250; i++) record({ provider: "p", id: "m" + i, ok: false, kind: "execution", latencyMs: 10, tokens: i });
  let onDisk = JSON.parse(fs.readFileSync(kb, "utf8"));
  assert(Object.keys(onDisk.stats).length <= core.MAX_KNOWLEDGE_RECORDS, `C6: stats evicted to <=200 (got ${Object.keys(onDisk.stats).length})`);
  assert(onDisk.recent.length <= MAX_RECENT, `C6: recent capped at ${MAX_RECENT} (got ${onDisk.recent.length})`);
  assert(onDisk.recent.every((r) => typeof r.tokens === "number"), "C6: numeric tokens retained through persistence");

  for (let i = 0; i < core.VERIFIED_FAILURE_THRESHOLD; i++) record({ provider: "flaky", id: "x", ok: false, kind: "timeout", latencyMs: 1000 });
  assert(core.shouldSkipCandidate(store, M({ provider: "flaky", id: "x" })) === true, "C6: repeated failures → candidate skipped");
  const ranked = core.rankCandidates([M({ provider: "flaky", id: "x" }), M({ provider: "solid", id: "y" })], {}, store);
  assert(ranked[0].provider === "solid", "C6: ranked pool avoids flaky");

  const reloaded = core.parseKnowledge(fs.readFileSync(kb, "utf8"));
  assert(core.verifiedFailure(reloaded, M({ provider: "flaky", id: "x" })) === true, "C6: reload preserves verified failures");
  assert(Object.keys(reloaded.stats).length <= core.MAX_KNOWLEDGE_RECORDS, "C6: reload bounded");

  fs.writeFileSync(kb, "{corrupt!!not json");
  const recovered = core.parseKnowledge(fs.readFileSync(kb, "utf8"));
  assert(Object.keys(recovered.stats).length === 0 && recovered.version === 1, "C6: corrupt file → empty safe store");

  let streamCalls = 0;
  const events3 = [];
  const cands = Array.from({ length: 10 }, (_, i) => M({ provider: "prov", id: "c" + i }));
  const deps = {
    getCandidates: () => cands,
    getAuth: async () => ({ ok: true, apiKey: "k" }),
    streamCandidate: async function* () { streamCalls++; yield { type: "error", reason: "error", error: { errorMessage: "fail", stopReason: "error" } }; },
    createEventStream: () => ({ push: (e) => events3.push(e), end: (m) => events3.push({ type: "__ended", final: m }) }),
    fallbackModel: () => M({ provider: "fb", id: "prev" }),
    findModel: () => undefined, getCurrentModel: () => undefined,
    now: () => 1_700_000_000_000, log: () => {},
    loadKnowledge: () => core.newEvidenceStore(), saveKnowledge: () => {},
    maxAttempts: 3,
  };
  const pi = streamPi();
  core.installFas(pi, deps);
  const t0 = Date.now();
  pi.registered.find((r) => r.name === "fas-router").config.streamSimple({ provider: "fas-router", id: "auto" }, { messages: [] }, {});
  await waitFor(() => events3.some((e) => e.type === "__ended"), 5000);
  assert(Date.now() - t0 < 4500, "C6: no infinite fallback loop (settled quickly)");
  assert(streamCalls <= core.DEFAULT_MAX_ATTEMPTS + 1, `C6: candidate stream attempts bounded (got ${streamCalls})`);
  const final3 = events3.find((e) => e.type === "__ended")?.final;
  assert(final3?.stopReason === "error" && Array.isArray(final3?.content), "C6: exhausted budget → complete error via fallback");
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── C7: redact deep audit ──
async function C7() {
  const r = core.redact({
    apiKey: "sk-live", headers: { Authorization: "Bearer t", "x-api-key": "v" },
    list: [{ password: "p" }, 5, "safe"], tokens: 77, totalTokens: 12,
    nested: { deep: { credential: "c", ok: 1 } }, accessToken: "at",
  });
  assert(r.apiKey === "[REDACTED]", "C7: apiKey redacted");
  assert(r.headers.Authorization === "[REDACTED]", "C7: Authorization header redacted");
  assert(r.headers["x-api-key"] === "[REDACTED]", "C7: x-api-key redacted");
  assert(r.list[0].password === "[REDACTED]" && r.list[1] === 5 && r.list[2] === "safe", "C7: arrays deep-scanned, scalars kept");
  assert(r.tokens === 77 && r.totalTokens === 12, "C7: numeric telemetry retained");
  assert(r.nested.deep.credential === "[REDACTED]" && r.nested.deep.ok === 1, "C7: deep nesting redacted correctly");
  assert(r.accessToken === "[REDACTED]", "C7: accessToken redacted");
}

// ── C8: compaction decision boundary ──
async function C8() {
  let compactCalls = 0;
  const mkCtx = (usage, model) => ({
    model,
    getContextUsage: () => usage,
    thinkingLevel: "minimal",
    compact: () => { compactCalls++; },
  });
  const pi = fakePi();
  const deps = { getCurrentModel: () => undefined, findModel: () => undefined, getCandidates: () => [], getAvailable: () => [], fallbackModel: () => undefined, getAuth: async () => ({ ok: true }), streamCandidate: async function* () {}, createEventStream: () => ({ push() {}, end() {} }), now: () => 0, log: () => {}, loadKnowledge: () => core.newEvidenceStore(), saveKnowledge: () => {}, maxAttempts: 3 };
  core.installFas(pi, deps);
  const reasoner = M({ provider: "zai", id: "glm", reasoning: true });
  const handler = pi.handlers["turn_end"][0];
  await handler({}, mkCtx({ tokens: 120000, contextWindow: 128000, percent: 93.7 }, reasoner));
  // CORE-DELEGATED: FAS DECIDES (>85%, advisory) and PI CORE EXECUTES.
  // FAS must not call ctx.compact() from turn_end: turn_end fires several times per
  // tool-using response, Pi 0.85.1's compact() has no re-entrancy guard, and overlapping
  // calls throw "Cannot read properties of undefined (reading 'signal')" ("Compaction
  // failed: ..."). See test-fas-compaction-safety.mjs.
  assert(core.planBudgets(reasoner, { tokens: 120000, contextWindow: 128000, percent: 93.7 }).compact === true, "C8: >85% decision still reported (advisory)");
  await handler({}, mkCtx({ tokens: 10000, contextWindow: 128000, percent: 7.8 }, reasoner));
  await handler({}, mkCtx(null, reasoner));
  assert(core.planBudgets(reasoner, { tokens: 10000, contextWindow: 128000, percent: 7.8 }).compact === false, "C8: <=85% decision false (boundary is exclusive)");
  assert(compactCalls === 0, "C8: FAS never issues ctx.compact() — CORE-DELEGATED, no crash, no duplicates");
}

// ── C9: persist stamps recency ──
async function C9() {
  let savedStore = null;
  let tick = 1_700_000_000_000;
  const events = [];
  const cands = Array.from({ length: 4 }, (_, i) => M({ provider: "prov", id: "c" + i }));
  const deps = {
    getCandidates: () => cands,
    getAuth: async () => ({ ok: true, apiKey: "k" }),
    streamCandidate: async function* () { yield { type: "error", reason: "error", error: { errorMessage: "fail", stopReason: "error" } }; },
    createEventStream: () => ({ push: (e) => events.push(e), end: (m) => events.push({ type: "__ended", final: m }) }),
    fallbackModel: () => undefined,
    findModel: () => undefined, getCurrentModel: () => undefined,
    now: () => (tick += 1000),
    log: () => {},
    loadKnowledge: () => core.newEvidenceStore(),
    saveKnowledge: (s) => { savedStore = s; },
    maxAttempts: 3,
  };
  const pi = streamPi();
  core.installFas(pi, deps);
  pi.registered.find((r) => r.name === "fas-router").config.streamSimple({ provider: "fas-router", id: "auto" }, { messages: [] }, {});
  await waitFor(() => events.some((e) => e.type === "__ended"), 5000);
  assert(!!savedStore, "C9: store persisted during routing");
  const lastSeens = Object.values(savedStore.stats).map((s) => s.lastSeen ?? 0);
  const distinct = new Set(lastSeens).size;
  assert(distinct >= 2, `C9: recency stamped per attempt (distinct lastSeen: ${distinct})`);
  let store = core.newEvidenceStore();
  for (let i = 0; i < 250; i++) store = core.recordOutcome(store, { provider: "p", id: "m" + i, ok: false, at: i + 1 });
  store = core.recordOutcome(store, { provider: "aaa", id: "just-learned", ok: false, at: 9999 });
  assert("aaa/just-learned" in store.stats, "C9: newest-updated record survives eviction (not alphabetical)");
}

await runTest("C1. real index.ts loads + registers provider/commands", C1);
await runTest("C2. composed-provider dispatch wiring", C2);
await runTest("C3. command handlers end-to-end (on/off/status/token-efficiency)", C3);
await runTest("C4. no-previous-model fail-safe → complete AssistantMessage", C4);
await runTest("C5. transparent fallthrough / no duplicate content", C5);
await runTest("C6. knowledge-bound stress (eviction/caps/attempts/corrupt/reload)", C6);
await runTest("C7. redact deep audit", C7);
await runTest("C8. compaction decision boundary", C8);
await runTest("C9. persist stamps recency (at) so eviction is recency-based", C9);

console.log(`\n=== FAS Consolidation Results ===`);
console.log(`Passed: ${passed}/${passed + failed}`);
if (failed) { console.error(`Failed: ${failed}`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log("ALL CONSOLIDATION TESTS PASSED");
