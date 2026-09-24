/**
 * FAS RELEASE SUITE (durable: ~/fas-verify/tests/) — derived from the CURRENT
 * implementation (core.ts + index.ts at release fingerprints), not from reports.
 *
 * Scope: registration · activation · discovery · filtering · scoring ·
 * failure classification · fallback planning · evidence/redact · thinking ·
 * budgets + budget states · learning/persistence · fail-safe delegation ·
 * transparent fallback · complete error results · provider-aware dispatch ·
 * EXACT fallback-attempt-bound semantics (group 15).
 *
 * Attempt-budget semantics (verified in source, core.ts runRouterStream):
 *   DEFAULT_MAX_ATTEMPTS = 3 bounds FAS *candidate* attempts per turn
 *   (loop `i < maxAttempts`, planFallback stops at `attemptIndex+1 >= maxAttempts`).
 *   After the loop, at most ONE previous-model fallback delegation
 *   (streamViaFallback, single call site per turn, non-retrying).
 *   Worst case per turn: 3 candidate streams + 1 fallback stream = 4 total
 *   streamCandidate invocations, single-pass, no re-entry, no loops.
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
function streamPi() {
  return { registered: [], commands: [], handlers: {}, on() {}, registerCommand() {}, registerProvider(n, c) { this.registered.push({ name: n, config: c }); }, async setModel() { return true; } };
}
function streamDeps(o = {}) {
  const logged = [];
  return {
    logged,
    getCandidates: () => o.candidates ?? [],
    getAvailable: () => o.available,
    getAuth: o.getAuth ?? (async () => ({ ok: true, apiKey: "k" })),
    streamCandidate: o.streamCandidate ?? (async function* () { yield { type: "done", message: {} }; }),
    createEventStream: () => ({ push: (e) => o.events.push(e), end: (m) => o.events.push({ type: "__ended", final: m }) }),
    fallbackModel: () => o.fallbackModel,
    findModel: () => undefined,
    getCurrentModel: () => undefined,
    now: () => 1_700_000_000_000,
    log: (e) => { logged.push(e); },
    loadKnowledge: () => o.knowledge ?? core.newEvidenceStore(),
    saveKnowledge: () => {},
    maxAttempts: o.maxAttempts ?? 3,
  };
}
function runRouter(deps, events) {
  const pi = streamPi();
  core.installFas(pi, deps);
  pi.registered.find((r) => r.name === core.FAS_PROVIDER)
    .config.streamSimple({ provider: core.FAS_PROVIDER, id: core.FAS_MODEL_ID, api: "openai-completions" }, { messages: [] }, {});
}
const errStream = (msg) => async function* () { yield { type: "error", reason: "error", error: { errorMessage: msg, stopReason: "error" } }; };
const okStream = (text) => async function* () {
  yield { type: "text_delta", contentIndex: 0, delta: text, partial: {} };
  yield { type: "done", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 1, output: 1 } } };
};

// 1. registration
async function T_registration() {
  const pi = fakePi();
  core.installFas(pi, streamDeps({ events: [] }));
  const reg = pi.registered.find((r) => r.name === core.FAS_PROVIDER);
  assert(!!reg, "fas-router registered");
  assert(reg.config.models[0].id === "auto", "model auto");
  assert(typeof reg.config.streamSimple === "function", "streamSimple present");
  assert(reg.config.apiKey !== undefined, "apiKey placeholder");
  for (const c of ["fas-router:on", "fas-router:off", "fas-router:status", "token-efficiency"])
    assert(pi.commands.some((x) => x.name === c), `command ${c}`);
}

// 2. activation
async function T_activation() {
  const pi = fakePi();
  const current = M({ provider: "zai", id: "glm" });
  const routerModel = M({ provider: core.FAS_PROVIDER, id: core.FAS_MODEL_ID });
  const deps = streamDeps({ events: [] });
  deps.getCurrentModel = () => current;
  deps.findModel = (p, i) => (p === core.FAS_PROVIDER && i === core.FAS_MODEL_ID ? routerModel : undefined);
  core.installFas(pi, deps);
  const ctx = { model: current, thinkingLevel: "off", getContextUsage: () => null, ui: { notify() {} }, modelRegistry: { find: () => undefined } };
  await pi.commands.find((c) => c.name === "fas-router:on").handler("", ctx);
  assert(pi.setModelCalls.length === 1 && pi.setModelCalls[0].provider === core.FAS_PROVIDER, "on → setModel router");
  await pi.commands.find((c) => c.name === "fas-router:off").handler("", { ...ctx, model: routerModel });
  assert(pi.setModelCalls.length === 2 && pi.setModelCalls[1].provider === "zai", "off → restores previous");
}

// 3. discovery
async function T_discovery() {
  const all = [M({ provider: "zai", id: "a" }), M({ provider: core.FAS_PROVIDER, id: "auto" }), M({ provider: "openrouter", id: "b" })];
  const c = core.discoverCandidates(all, []);
  assert(c.length === 2 && !c.some((m) => m.provider === core.FAS_PROVIDER), "excludes fas-router");
  assert(core.discoverCandidates(all, [all[0], all[0]]).length === 1, "available wins, deduped");
}

// 4. hard filter
async function T_filter() {
  const models = [
    M({ provider: "a", id: "text", input: ["text"], contextWindow: 8000, reasoning: false }),
    M({ provider: "a", id: "vision", input: ["text", "image"], contextWindow: 128000 }),
    M({ provider: "b", id: "reasoner", reasoning: true, contextWindow: 128000 }),
    M({ provider: "c", id: "tiny", contextWindow: 1000, reasoning: true }),
  ];
  assert(core.hardFilter(models, { requiredInput: ["image"] }).length === 1, "image filter");
  assert(!core.hardFilter(models, { minContextWindow: 100000 }).some((m) => m.id === "tiny"), "context filter");
  assert(core.hardFilter(models, { needsReasoning: true }).every((m) => m.reasoning), "reasoning filter");
  assert(!core.hardFilter(models, { excludedProviders: ["a"] }).some((m) => m.provider === "a"), "provider exclusion");
  assert(!core.hardFilter(models, { excludedModels: ["a/vision"] }).some((m) => m.id === "vision"), "model exclusion");
}

// 5. scoring / ranking
async function T_selection() {
  let s = core.newEvidenceStore();
  s = core.recordOutcome(s, { provider: "slow", id: "big", ok: false, kind: "timeout", latencyMs: 60000, at: 1 });
  s = core.recordOutcome(s, { provider: "fast", id: "small", ok: true, latencyMs: 400, at: 2 });
  const models = [M({ provider: "slow", id: "big" }), M({ provider: "fast", id: "small" })];
  assert(core.rankCandidates(models, {}, s)[0].provider === "fast", "evidence favors fast");
  const r1 = core.rankCandidates(models, {}, s).map(core.modelKey).join(",");
  assert(core.rankCandidates(models, {}, s).map(core.modelKey).join(",") === r1, "deterministic");
  assert(core.rankCandidates(models, { preferredProvider: "slow" }, core.newEvidenceStore())[0].provider === "slow", "preferred provider");
  const sl = core.shortlistPerProvider(models, {}, s);
  assert(Object.keys(sl).length === 2, "per-provider shortlists");
  assert(core.normalizePool([...models, ...models]).length === 2, "pool deduped");
}

// 6. classification + fallback plan
async function T_classify() {
  assert(core.classifyFailure({ status: 429 }).kind === "rate_limit", "429 rate_limit");
  assert(core.classifyFailure({ status: 401 }).fatal === true, "401 fatal");
  assert(core.classifyFailure({ errorMessage: "request timeout" }).kind === "timeout", "timeout");
  assert(core.classifyFailure({ status: 503 }).retryable === true, "503 retryable");
  assert(core.classifyFailure({ status: 400 }).retryable === false, "400 not retryable");
  const ranked = [M({ provider: "a", id: "1" }), M({ provider: "b", id: "2" }), M({ provider: "c", id: "3" })];
  const rl = core.classifyFailure({ status: 429 });
  assert(core.planFallback(ranked, rl, 0, 3).next.provider === "b", "fallback to #2");
  assert(core.planFallback(ranked, rl, 2, 3).stop === true, "budget stops at 3");
  assert(core.planFallback(ranked, core.classifyFailure({ status: 401 }), 0, 3).stop === true, "fatal stops");
  assert(core.DEFAULT_MAX_ATTEMPTS === 3, "DEFAULT_MAX_ATTEMPTS is 3");
}

// 7. evidence + redact
async function T_evidence() {
  const rec = core.buildEvidenceRecord({ provider: "zai", id: "glm", ok: false, kind: "rate_limit", status: 429, latencyMs: 1200, reason: "rate_limit:429", tokens: 55 });
  assert(rec.tokens === 55 && !("apiKey" in rec), "record tokens, no credentials");
  const red = core.redact({ apiKey: "sk-X", Authorization: "Bearer y", nested: { token: "abc", tokens: 9 }, totalTokens: 4 });
  assert(red.apiKey === "[REDACTED]" && red.Authorization === "[REDACTED]" && red.nested.token === "[REDACTED]", "strings redacted");
  assert(red.nested.tokens === 9 && red.totalTokens === 4, "numeric telemetry retained");
}

// 8. thinking + budgets + states
async function T_policy() {
  const reasoner = M({ provider: "p", id: "r", reasoning: true, thinkingLevelMap: { off: null, minimal: "min", low: "low" } });
  assert(core.selectMinThinkingLevel(reasoner) === "minimal", "min level");
  assert(core.selectMinThinkingLevel(M({ provider: "p", id: "n" })) === "off", "non-reasoning off");
  assert(core.decideThinking(reasoner, "off", {}).level === "minimal", "starts at minimum");
  assert(core.decideThinking(reasoner, "minimal", { insufficient: true }).level === "low", "escalates on evidence");
  const b = core.planBudgets(M({ maxTokens: 4096 }), { tokens: 10000, contextWindow: 128000, percent: 7.8 });
  assert(b.maxOutputTokens === 4096 && b.compact === false, "output budget, no compact");
  assert(core.planBudgets(M({ maxTokens: 1 }), { tokens: 120000, contextWindow: 128000, percent: 93.7 }).compact === true, "compact >85%");
  const by = Object.fromEntries(core.budgetStates().map((s) => [s.budget, s.state]));
  assert(by.maxOutputTokens === "ENFORCED" && by.compact === "CORE-DELEGATED" && by.maxRounds === "ADVISORY-ONLY" && by.trim === "ADVISORY-ONLY", "honest budget states");
}

// 9. learning / persistence / bounds
async function T_learning() {
  let store = core.newEvidenceStore();
  for (let i = 0; i < core.VERIFIED_FAILURE_THRESHOLD; i++)
    store = core.recordOutcome(store, { provider: "flaky", id: "x", ok: false, kind: "timeout", latencyMs: 1000, at: i + 1 });
  assert(core.shouldSkipCandidate(store, M({ provider: "flaky", id: "x" })) === true, "penalized skipped");
  assert(core.learningRules(store).some((r) => r.type === "avoid" && r.provider === "flaky"), "avoid rule");
  assert(core.rankCandidates([M({ provider: "flaky", id: "x" }), M({ provider: "solid", id: "y" })], {}, store)[0].provider === "solid", "selection avoids");
  const reloaded = core.parseKnowledge(core.serializeKnowledge(store));
  assert(core.verifiedFailure(reloaded, M({ provider: "flaky", id: "x" })) === true, "reload preserves");
  assert(Object.keys(core.parseKnowledge("not json").stats).length === 0, "corrupt → empty");
  let big = core.newEvidenceStore();
  for (let i = 0; i < core.MAX_KNOWLEDGE_RECORDS + 50; i++)
    big = core.recordOutcome(big, { provider: "p", id: "m" + i, ok: false, kind: "execution", at: i + 1 });
  assert(Object.keys(big.stats).length <= core.MAX_KNOWLEDGE_RECORDS, "bounded at 200");
}

// 10. fail-safe delegation + complete errors
async function T_failsafe() {
  const events = [];
  const deps = streamDeps({ events, candidates: [], fallbackModel: M({ provider: "orig", id: "m" }), streamCandidate: okStream("ok") });
  runRouter(deps, events);
  await waitFor(() => events.some((e) => e.type === "done"));
  assert(events.some((e) => e.type === "done"), "delegates to fallback when no candidate");
  const events2 = [];
  const deps2 = streamDeps({ events: events2, candidates: [M({ provider: "a", id: "1" })], fallbackModel: undefined, streamCandidate: errStream("429") });
  runRouter(deps2, events2);
  await waitFor(() => events2.some((e) => e.type === "__ended"));
  const fin = events2.find((e) => e.type === "__ended")?.final;
  assert(fin?.stopReason === "error" && Array.isArray(fin?.content), "no-fallback → complete error");
  fin.content.filter((c) => c.type === "toolCall"); // must not throw (agent-loop.js shape)
  assert(true, "agent-loop filter survives");
}

// 11. transparent fallback, no duplicates
async function T_transparent() {
  const events = [];
  const deps = streamDeps({
    events,
    candidates: [M({ provider: "a", id: "1" }), M({ provider: "b", id: "2" })],
    streamCandidate: async function* (m) {
      if (m.provider === "a") { yield { type: "error", reason: "error", error: { errorMessage: "429", stopReason: "error" } }; return; }
      yield* okStream("hi")();
    },
  });
  runRouter(deps, events);
  await waitFor(() => events.some((e) => e.type === "done"));
  const deltas = events.filter((e) => e.type === "text_delta");
  assert(deltas.length === 1 && deltas[0].delta === "hi", "winner forwarded once, no duplicates");
  assert(deps.logged.some((e) => e.provider === "a" && e.ok === false && e.kind === "rate_limit"), "failure evidence");
  assert(deps.logged.some((e) => e.provider === "b" && e.ok === true), "success evidence");
}

// 12. dispatch
async function T_dispatch() {
  let reg = 0, compat = 0;
  const registry = { getProvider: (id) => (id === "free-router" ? { streamSimple: async function* () { reg++; yield { type: "done", message: {} }; } } : undefined) };
  const fn = core.makeStreamCandidate({ getRegistry: () => registry }, () => { compat++; return (async function* () {})(); });
  for await (const _ of fn(M({ provider: "free-router", id: "auto", api: "freerouter" }), { messages: [] }, {})) { /* drain */ }
  assert(reg === 1 && compat === 0, "composed dispatch preferred for custom api");
  const fn2 = core.makeStreamCandidate({ getRegistry: () => undefined }, () => { compat++; return (async function* () {})(); });
  for await (const _ of fn2(M({ provider: "z", id: "m" }), { messages: [] }, {})) { /* drain */ }
  assert(compat === 1, "compat fallback when registry absent");
}

// 13. model_select + turn_end wiring
async function T_wiring() {
  const pi = fakePi();
  const deps = streamDeps({ events: [] });
  core.installFas(pi, deps);
  let level = "off"; let compactCalls = 0;
  const ctx = (model, usage) => ({
    model, get thinkingLevel() { return level; },
    getContextUsage: () => usage, compact: () => { compactCalls++; },
    ui: { notify() {} },
  });
  await pi.handlers["model_select"][0]({}, ctx(M({ provider: "p", id: "r", reasoning: true, thinkingLevelMap: { off: null, minimal: "min" } })));
  assert(pi.thinking === "minimal", "model_select raises to min");
  await pi.handlers["turn_end"][0]({}, ctx(M({ provider: "p", id: "r", reasoning: true }), { tokens: 120000, contextWindow: 128000, percent: 93.7 }));
  // CORE-DELEGATED: FAS decides, Pi core executes. ctx.compact() from turn_end is
  // forbidden (Pi 0.85.1 compact() has no re-entrancy guard; overlapping calls throw
  // "Cannot read properties of undefined (reading 'signal')" and abort the live turn).
  assert(compactCalls === 0, ">85% → no manual ctx.compact (CORE-DELEGATED)");
  await pi.handlers["turn_end"][0]({}, ctx(M({ provider: "p", id: "r", reasoning: true }), { tokens: 1, contextWindow: 128000, percent: 0 }));
  assert(compactCalls === 0, "low usage → no compact");
}

// 14. errorAssistantMessage shape
async function T_errshape() {
  const m = core.errorAssistantMessage(M({ provider: "p", id: "i", api: "openai-completions" }), "boom");
  assert(m.role === "assistant" && Array.isArray(m.content) && m.content.length === 0, "role + empty content array");
  assert(m.stopReason === "error" && m.errorMessage === "boom", "stopReason + message");
  assert(m.usage && typeof m.timestamp === "number" && m.provider === "p", "usage + timestamp + provider");
  const d = core.errorAssistantMessage(undefined, "x");
  assert(d.provider === core.FAS_PROVIDER && d.model === core.FAS_MODEL_ID, "defaults to fas-router/auto");
}

// 15. EXACT fallback-attempt-bound semantics
async function T_attempt_bounds() {
  const N = (n) => Array.from({ length: n }, (_, i) => M({ provider: "prov", id: "c" + i }));
  async function run(cands, fb, behavior) {
    const calls = [];
    const events = [];
    const deps = streamDeps({
      events, candidates: cands, fallbackModel: fb,
      streamCandidate: async function* (m) {
        calls.push(`${m.provider}/${m.id}`);
        yield* behavior(m)();
      },
    });
    runRouter(deps, events);
    await waitFor(() => events.some((e) => e.type === "__ended"), 5000);
    return { calls, final: events.find((e) => e.type === "__ended")?.final };
  }
  const fb = M({ provider: "prev", id: "m" });
  // 10 failing candidates + fallback → exactly 3 candidates (rank order) + 1 fallback
  let r = await run(N(10), fb, () => errStream("fail"));
  assert(r.calls.length === 4, `10-fail+fb → 4 total streams (got ${r.calls.length})`);
  assert(r.calls.slice(0, 3).join(",") === "prov/c0,prov/c1,prov/c2", `first 3 are c0,c1,c2 (got ${r.calls.slice(0, 3)})`);
  assert(r.calls[3] === "prev/m", "4th is the fallback model");
  assert(!r.calls.includes("prov/c3"), "c3 never attempted — candidate bound is exactly 3");
  assert(r.final?.stopReason === "error" && Array.isArray(r.final?.content), "terminal complete error");
  // 10 failing, no fallback → exactly 3
  r = await run(N(10), undefined, () => errStream("fail"));
  assert(r.calls.length === 3 && !r.calls.includes("prov/c3"), "no-fb → exactly 3 candidate streams");
  // fatal on first (numeric status 401, as real pi-ai error events carry) → 1 candidate + 1 fallback
  // (behavior must return a generator FUNCTION; run() invokes it once via yield* behavior(m)())
  const err401 = async function* () { yield { type: "error", reason: "error", error: { status: 401, errorMessage: "401 Unauthorized", stopReason: "error" } }; };
  r = await run(N(10), fb, (m) => (m.provider === "prov" ? err401 : okStream("fb-ok")));
  assert(r.calls.length === 2 && r.calls[0] === "prov/c0" && r.calls[1] === "prev/m", `fatal-first → c0 then fallback (got ${r.calls})`);
  // bare "401" text WITHOUT numeric status is conservatively retryable (not fatal)
  assert(core.classifyFailure({ errorMessage: "401 Unauthorized" }).fatal === false, "text-only 401 is not fatal");
  assert(core.classifyFailure({ status: 401 }).fatal === true, "numeric-status 401 is fatal");
  // success on 2nd → 2 calls, done, no fallback
  const events = [];
  r = await run(N(10), fb, (m) => (m.provider === "prov" && m.id === "c0" ? errStream("429") : okStream("WIN")));
  const doneEv = events.find((e) => e.type === "done");
  assert(r.calls.length === 2, `success-2nd → 2 streams (got ${r.calls.length})`);
  assert(r.calls[1] === "prov/c1" && !r.calls.includes("prev/m"), "winner is c1, fallback untouched");
  // zero candidates + fallback → fallback only
  r = await run([], fb, (m) => okStream("fb"));
  assert(r.calls.length === 1 && r.calls[0] === "prev/m", "empty pool → single fallback stream");
  // Meaning (asserted, not increased): 3 = candidate bound; +1 = bounded previous-model delegation
  assert(core.DEFAULT_MAX_ATTEMPTS === 3, "bound unchanged at 3");
}

// 16. failure evidence keeps provider message + status (router-gap observability:
// live kilo lanes fail with execution:unknown and the lane error text is dropped,
// so the next turn cannot tell "no credits" from "network" — persist both).
async function T_failEvidence() {
  let saved = null;
  const events = [];
  const deps = streamDeps({
    events,
    candidates: [M({ provider: "k", id: "m1" })],
    streamCandidate: async function* () { yield { type: "error", reason: "error", error: { status: 402, errorMessage: "Add credits to continue", stopReason: "error" } }; },
    maxAttempts: 1,
  });
  deps.saveKnowledge = (next) => { saved = next; };
  runRouter(deps, events);
  await waitFor(() => events.some((e) => e.type === "__ended"), 5000);
  const s = saved && saved.stats && saved.stats["k/m1"];
  assert(s && s.failures === 1, "failure recorded");
  assert(s && s.lastStatus === 402, "status kept in stats");
  assert(s && typeof s.lastError === "string" && s.lastError.includes("credits"), "provider message kept in stats");
}

// 17. within-turn provider circuit breaker (F3 v1): after a provider fails
// this turn, prefer untried candidates from OTHER providers before burning
// another lane of the same dead provider (kilo credit-dead pattern).
// Preference only — with no alternative provider the order is unchanged (T15).
async function T_providerBreaker() {
  const calls = [];
  const events = [];
  const deps = streamDeps({
    events,
    candidates: [M({ provider: "a", id: "k1" }), M({ provider: "a", id: "k2" }), M({ provider: "z", id: "good" })],
    streamCandidate: async function* (m) {
      calls.push(`${m.provider}/${m.id}`);
      if (m.provider === "a") { yield { type: "error", reason: "error", error: { errorMessage: "boom", stopReason: "error" } }; return; }
      yield* okStream("WIN")();
    },
  });
  runRouter(deps, events);
  await waitFor(() => events.some((e) => e.type === "__ended" || e.type === "done"), 5000);
  assert(calls.join(",") === "a/k1,z/good", `breaker skips a/k2 for z/good (got ${calls})`);
  assert(events.some((e) => e.type === "done"), "good lane completes the turn");
}

// 18. status-from-text (advisory): providers throw "402: {...}" / "404: {...}"
// without status objects. A LEADING code+colon upgrades the reason (better KB
// + learning evidence) but stays retryable/non-fatal: the failure is
// lane-scoped, and the breaker—not the classifier—decides the turn.
// Bare prose with no colon ("401 Unauthorized") stays conservative (T15 pin).
async function T_statusFromText() {
  const t402 = core.classifyFailure({ errorMessage: '402: {"title":"Paid Model - Credits Required"}' });
  assert(t402.kind === "credits" && t402.reason === "credits:402", "leading 402: → credits:402");
  assert(t402.retryable === true && t402.fatal === false, "text-402 stays retryable (breaker decides)");
  const t404 = core.classifyFailure({ errorMessage: '404: {"message":"No endpoints found"}' });
  assert(t404.kind === "execution" && t404.reason === "execution:404", "leading 404: → execution:404");
  assert(t404.retryable === true && t404.fatal === false, "text-404 stays retryable (breaker decides)");
  const t401 = core.classifyFailure({ errorMessage: "401 Unauthorized" });
  assert(t401.fatal === false, "bare 401 prose stays non-fatal");
  const tNum = core.classifyFailure({ status: 401, errorMessage: "401 Unauthorized" });
  assert(tNum.fatal === true && tNum.retryable === false, "numeric 401 event stays fatal");
}

await runTest("1. registration", T_registration);
await runTest("2. activation/deactivation", T_activation);
await runTest("3. discovery", T_discovery);
await runTest("4. hard filtering", T_filter);
await runTest("5. scoring/ranking", T_selection);
await runTest("6. classification + fallback plan", T_classify);
await runTest("7. evidence + redact", T_evidence);
await runTest("8. thinking + budgets + states", T_policy);
await runTest("9. learning/persistence/bounds", T_learning);
await runTest("10. fail-safe delegation + complete errors", T_failsafe);
await runTest("11. transparent fallback", T_transparent);
await runTest("12. provider-aware dispatch", T_dispatch);
await runTest("13. event wiring (model_select/turn_end)", T_wiring);
await runTest("14. error message shape", T_errshape);
await runTest("15. EXACT attempt-bound semantics (3+1)", T_attempt_bounds);
await runTest("16. failure evidence keeps message + status", T_failEvidence);
await runTest("17. within-turn provider circuit breaker", T_providerBreaker);
await runTest("18. status-from-text advisory parsing", T_statusFromText);

console.log(`\n=== FAS Release Suite ===`);
console.log(`Passed: ${passed}/${passed + failed}`);
if (failed) { console.error(`Failed: ${failed}`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log("ALL RELEASE TESTS PASSED");
