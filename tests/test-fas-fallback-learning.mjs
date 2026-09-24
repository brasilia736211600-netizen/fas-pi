/**
 * FAS FALLBACK + LEARNING SUITE (durable: ~/fas-verify/tests/)
 *
 * Deterministic local/mock scenario required by the post-release hardening pass:
 *   - force TWO candidate failures followed by a success in the REAL
 *     runRouterStream path (no live provider, no quota);
 *   - prove candidate ordering, bounded attempts, no duplicate streamed content,
 *     correct evidence, and the learning update;
 *   - prove cross-"session" learning semantics: success never creates a false
 *     avoidance rule, penalties appear only at the documented threshold,
 *     recovery clears them, knowledge stays bounded, reload works, corrupt
 *     knowledge fails safe.
 */
"use strict";
import { createRequire } from "node:module";
import * as path from "node:path";

const require_ = createRequire(import.meta.url);
const PI = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const { createJiti } = require_(path.join(PI, "node_modules/jiti/lib/jiti.cjs"));
const jiti = createJiti(import.meta.url, {
  moduleCache: false, interopDefault: true,
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
async function waitFor(cond, ms = 5000) {
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

function streamPi() {
  return { registered: [], commands: [], handlers: {}, on() {}, registerCommand() {}, registerProvider(n, c) { this.registered.push({ name: n, config: c }); }, async setModel() { return true; } };
}

async function F1_two_failures_then_success() {
  const cands = ["a", "b", "c"].map((id) => M({ provider: "p", id }));
  const calls = [], logged = [], events = [];
  let saved = null;
  const behavior = (id) => {
    if (id === "a") return async function* () { yield { type: "error", reason: "error", error: { status: 429, errorMessage: "429 rate limit exceeded" } }; };
    if (id === "b") return async function* () { yield { type: "error", reason: "error", error: { status: 429, errorMessage: "429 rate limit exceeded" } }; };
    return async function* () { yield { type: "text_delta", contentIndex: 0, delta: "WINNER", partial: {} }; yield { type: "done", reason: "stop", message: { role: "assistant", content: [{ type: "text", text: "WINNER" }], usage: { input: 3, output: 5 }, stopReason: "stop" } }; };
  };
  const deps = {
    getCandidates: () => cands, getAvailable: () => undefined,
    getAuth: async () => ({ ok: true, apiKey: "k" }),
    streamCandidate: (m) => { calls.push(`${m.provider}/${m.id}`); return behavior(m.id)(); },
    createEventStream: () => ({ push: (e) => events.push(e), end: (m) => events.push({ type: "__ended", final: m }) }),
    fallbackModel: () => M({ provider: "prev", id: "m" }),
    findModel: () => undefined, getCurrentModel: () => undefined,
    now: () => 1_700_000_000_000, log: (e) => logged.push(e),
    loadKnowledge: () => core.newEvidenceStore(), saveKnowledge: (s) => { saved = s; },
    maxAttempts: 3,
  };
  core.installFas(streamPi(), deps);
  // Run the REAL provider streamSimple via a fresh pi instance.
  const pi = streamPi();
  core.installFas(pi, deps);
  pi.registered.find((r) => r.name === "fas-router").config.streamSimple({ provider: "fas-router", id: "auto" }, { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }, {});
  await waitFor(() => events.some((e) => e.type === "__ended"));

  // ordering + bound
  assert(calls.join(",") === "p/a,p/b,p/c", `candidate order is a,b,c (got ${calls.join(",")})`);
  assert(calls.length === 3, `exactly 3 candidate streams, no c3+ (got ${calls.length})`);
  assert(!calls.includes("prev/m"), "fallback model never used after a success");
  // no duplicate streamed content
  const deltas = events.filter((e) => e.type === "text_delta").map((e) => e.delta);
  const done = events.filter((e) => e.type === "done");
  assert(deltas.length === 1 && deltas[0] === "WINNER", `success content streamed exactly once (got ${JSON.stringify(deltas)})`);
  assert(done.length === 1, `exactly one terminal done (got ${done.length})`);
  const ended = events.find((e) => e.type === "__ended");
  assert(ended?.final?.stopReason === "stop", "stream ends with the successful message");
  // evidence
  const ev = logged.filter((e) => e.type === "fas-evidence");
  assert(ev.length === 3, `evidence recorded for all 3 attempts (got ${ev.length})`);
  assert(ev[0].ok === false && ev[0].kind === "rate_limit" && ev[0].provider === "p" && ev[0].id === "a", "evidence[0] = a rate_limit failure");
  assert(ev[1].ok === false && ev[1].kind === "rate_limit" && ev[1].id === "b", "evidence[1] = b rate_limit failure");
  assert(ev[2].ok === true && ev[2].id === "c" && ev[2].tokens === 8, "evidence[2] = c success with numeric tokens");
  assert(ev.every((e) => typeof e === "object" && !("apiKey" in e) && !("authorization" in e)), "evidence carries no credential fields");
  // learning update
  assert(saved && saved.stats["p/a"].consecutiveFailures === 1 && saved.stats["p/b"].failures === 1, "learning recorded consecutive failures");
  assert(saved.stats["p/c"].successes === 1 && saved.stats["p/c"].consecutiveFailures === 0, "learning recorded the success and reset its streak");
}

async function F2_no_false_avoidance_on_success() {
  let s = core.newEvidenceStore();
  s = core.recordOutcome(s, { provider: "good", id: "m", ok: true, latencyMs: 100, at: 1 });
  assert(core.learningRules(s).length === 0, "a single success creates no avoid rule");
  assert(core.shouldSkipCandidate(s, M({ provider: "good", id: "m" })) === false, "a successful candidate is never skipped");
  const ranked = core.rankCandidates([M({ provider: "good", id: "m" }), M({ provider: "other", id: "n" })], {}, s);
  assert(ranked[0].provider === "good", "successful candidate ranks ahead");
}

async function F3_threshold_only() {
  const TH = core.VERIFIED_FAILURE_THRESHOLD;
  assert(TH === 3, "documented threshold is 3");
  let s = core.newEvidenceStore();
  for (let i = 0; i < TH - 1; i++) s = core.recordOutcome(s, { provider: "flaky", id: "x", ok: false, kind: "timeout", at: i + 1 });
  assert(core.learningRules(s).some((r) => r.type === "avoid") === false, "below threshold → no avoid rule");
  assert(core.shouldSkipCandidate(s, M({ provider: "flaky", id: "x" })) === false, "below threshold → not skipped");
  const rankedBelow = core.rankCandidates([M({ provider: "flaky", id: "x" }), M({ provider: "solid", id: "y" })], {}, s);
  assert(rankedBelow.some((m) => m.provider === "flaky"), "below threshold → still in the ranked pool");
  s = core.recordOutcome(s, { provider: "flaky", id: "x", ok: false, kind: "timeout", at: 99 });
  assert(core.learningRules(s).some((r) => r.type === "avoid" && r.provider === "flaky"), "at threshold → avoid rule");
  assert(core.shouldSkipCandidate(s, M({ provider: "flaky", id: "x" })) === true, "at threshold → skipped");
  const rankedAt = core.rankCandidates([M({ provider: "flaky", id: "x" }), M({ provider: "solid", id: "y" })], {}, s);
  assert(rankedAt[0].provider === "solid" && !rankedAt.some((m) => m.provider === "flaky"), "at threshold → lower-ranked/deprioritized");
}

async function F4_recovery_clears_penalty() {
  let s = core.newEvidenceStore();
  for (let i = 0; i < 3; i++) s = core.recordOutcome(s, { provider: "flaky", id: "x", ok: false, kind: "timeout", at: i + 1 });
  assert(core.shouldSkipCandidate(s, M({ provider: "flaky", id: "x" })) === true, "penalty active before recovery");
  s = core.recordOutcome(s, { provider: "flaky", id: "x", ok: true, latencyMs: 50, at: 10 });
  assert(s.stats["flaky/x"].consecutiveFailures === 0, "recovery resets the consecutive-failure streak");
  assert(core.shouldSkipCandidate(s, M({ provider: "flaky", id: "x" })) === false, "no longer skipped after recovery");
  assert(core.learningRules(s).some((r) => r.type === "avoid") === false, "no avoid rule after recovery");
  assert(core.learningRules(s).some((r) => r.type === "recover"), "recover rule surfaced");
  const ranked = core.rankCandidates([M({ provider: "flaky", id: "x" })], {}, s);
  assert(ranked.length === 1, "recovered candidate rankable again");
}

// F7. persistent provider breaker: two homogeneous provider failures trip a
// time-boxed provider cooldown (lane-independent); success resets it; expiry
// re-admits; other providers never affected.
async function F7_provider_breaker() {
  const NOW = 2_000_000_000_000;
  let s = core.newEvidenceStore();
  s = core.recordOutcome(s, { provider: "k", id: "a", ok: false, kind: "execution", at: NOW - 1000 });
  assert(core.shouldSkipCandidate(s, M({ provider: "k", id: "b" }), NOW) === false, "single provider failure → no trip");
  s = core.recordOutcome(s, { provider: "k", id: "b", ok: false, kind: "execution", at: NOW - 500 });
  assert(core.shouldSkipCandidate(s, M({ provider: "k", id: "c" }), NOW) === true, "two failures → provider cooled");
  assert(core.shouldSkipCandidate(s, M({ provider: "z", id: "q" }), NOW) === false, "other provider unaffected");
  const ranked = core.rankCandidates([M({ provider: "k", id: "c" }), M({ provider: "z", id: "q" })], {}, s, NOW);
  assert(ranked.length === 1 && ranked[0].provider === "z", "cooled provider dropped from rank (fail-safe keeps z)");
  assert(core.shouldSkipCandidate(s, M({ provider: "k", id: "c" }), NOW + 31 * 60 * 1000) === false, "cooldown expiry re-admits");
  s = core.recordOutcome(s, { provider: "k", id: "c", ok: true, latencyMs: 50, at: NOW });
  assert(core.shouldSkipCandidate(s, M({ provider: "k", id: "c" }), NOW) === false, "success resets the breaker");
}

// F8. fail-safe neutrality: the provider breaker must never empty the pool —
// when it is the ONLY provider available (e.g. one working free lane mid-
// outage), its lanes stay rankable despite the cooldown flag.
async function F8_breaker_failsafe() {
  const NOW = 3_000_000_000_000;
  let s = core.newEvidenceStore();
  s = core.recordOutcome(s, { provider: "only", id: "a", ok: false, kind: "execution", at: NOW - 2000 });
  s = core.recordOutcome(s, { provider: "only", id: "b", ok: false, kind: "execution", at: NOW - 1000 });
  assert(core.providerInCooldown(s, "only", NOW) === true, "breaker tripped");
  const ranked = core.rankCandidates([M({ provider: "only", id: "a" }), M({ provider: "only", id: "b" })], {}, s, NOW);
  assert(ranked.length === 2, "solo-provider pool survives the breaker (no self-emptying)");
}

async function F5_cross_session_reload_and_corrupt() {
  let s = core.newEvidenceStore();
  for (let i = 0; i < 3; i++) s = core.recordOutcome(s, { provider: "flaky", id: "x", ok: false, kind: "timeout", at: 100 + i });
  s = core.recordOutcome(s, { provider: "solid", id: "y", ok: true, latencyMs: 20, at: 200 });
  const onDisk = core.serializeKnowledge(s); // simulates the persisted file
  const reloaded = core.parseKnowledge(onDisk); // a fresh "session" reads it back
  assert(core.verifiedFailure(reloaded, M({ provider: "flaky", id: "x" })) === true, "avoidance survives reload");
  assert(reloaded.stats["solid/y"].successes === 1, "successes survive reload");
  assert(core.shouldSkipCandidate(reloaded, M({ provider: "solid", id: "y" })) === false, "successful model never skipped after reload");
  const empty = core.parseKnowledge("{ this is not json");
  assert(empty.version === 1 && Object.keys(empty.stats).length === 0, "corrupt knowledge fails safe to an empty store");
  const nullish = core.parseKnowledge("null");
  assert(nullish.version === 1 && Object.keys(nullish.stats).length === 0, "null knowledge fails safe");
}

async function F6_bounded_knowledge() {
  let s = core.newEvidenceStore();
  for (let i = 0; i < core.MAX_KNOWLEDGE_RECORDS + 75; i++) s = core.recordOutcome(s, { provider: "p", id: "m" + i, ok: false, kind: "execution", at: i + 1 });
  assert(Object.keys(s.stats).length <= core.MAX_KNOWLEDGE_RECORDS, `bounded at ${core.MAX_KNOWLEDGE_RECORDS} records (got ${Object.keys(s.stats).length})`);
  // recency eviction: newest survives, oldest gone
  assert(s.stats["p/m" + (core.MAX_KNOWLEDGE_RECORDS + 74)] !== undefined, "newest record retained");
  assert(s.stats["p/m0"] === undefined, "oldest record evicted");
}

await runTest("F1. two failures then success (real stream path)", F1_two_failures_then_success);
await runTest("F2. success creates no false avoidance", F2_no_false_avoidance_on_success);
await runTest("F3. penalty only at the documented threshold", F3_threshold_only);
await runTest("F4. recovery clears the learned penalty", F4_recovery_clears_penalty);
await runTest("F7. persistent provider breaker with cooldown", F7_provider_breaker);
await runTest("F8. breaker never empties a solo-provider pool", F8_breaker_failsafe);
await runTest("F5. cross-session reload + corrupt fail-safe", F5_cross_session_reload_and_corrupt);
await runTest("F6. knowledge remains bounded", F6_bounded_knowledge);

console.log(`\n=== FAS Fallback+Learning Suite ===`);
console.log(`Passed: ${passed}/${passed + failed}`);
if (failed) { console.error(`Failed: ${failed}`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log("ALL FALLBACK+LEARNING TESTS PASSED");