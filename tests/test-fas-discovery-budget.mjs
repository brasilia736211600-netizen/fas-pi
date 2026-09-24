/**
 * FAS DISCOVERY + TOKEN-EFFICIENCY AUDIT SUITE (durable: ~/fas-verify/tests/)
 *
 * Step 5 — candidate discovery quality (deterministic; no live quota):
 *   provider-local shortlists (3..5), global normalization/dedup, self-exclusion
 *   (fas-router), capability filtering, deterministic ranking, penalized-skip,
 *   and the explicit CATALOG ≠ LIVE distinction.
 *
 * Step 6 — token-efficiency behavior on synthetic inputs:
 *   model-specific thinking selection, minimum-sufficient thinking, evidence-based
 *   escalation, output-token enforcement, context-threshold compaction decision,
 *   core-delegated compaction, and explicit ADVISORY-ONLY maxRounds/trim reporting.
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
const M = (o) => ({
  provider: o.provider, id: o.id, name: o.name ?? o.id,
  reasoning: o.reasoning ?? false, thinkingLevelMap: o.thinkingLevelMap ?? null,
  input: o.input ?? ["text"], cost: o.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: o.contextWindow ?? 128000, maxTokens: o.maxTokens ?? 8192,
  api: o.api ?? "openai-completions", baseUrl: o.baseUrl ?? "https://x",
});


async function D7_negative_cost_is_not_a_bonus() {
  const store = { version: 1, updatedAt: 0, stats: {} };
  const task = {};
  const marked = M({ provider: "p", id: "free-marked", cost: { input: -1000000, output: -1000000 } });
  const plain = M({ provider: "p", id: "plain", cost: { input: 0, output: 0 } });
  const paid = M({ provider: "p", id: "paid", cost: { input: 5, output: 10 } });
  const sMarked = core.scoreCandidate(marked, task, store);
  const sPlain = core.scoreCandidate(plain, task, store);
  const sPaid = core.scoreCandidate(paid, task, store);
  assert(sMarked === sPlain, `free-marker cost scores as zero-cost (marked=${sMarked} plain=${sPlain})`);
  assert(sMarked < 1000, `no runaway bonus from negative cost (got ${sMarked})`);
  assert(sPlain >= sPaid, "zero-cost ranks at or above paid cost");
  const ranked = core.rankCandidates([marked, plain], task, store);
  assert(ranked[0].id === "plain" || ranked[0].id === "free-marked", "tie-broken deterministically, never by bonus");
}

// ── Step 5 ──────────────────────────────────────────────────────────
async function D1_self_exclusion_and_dedup() {
  const all = [
    M({ provider: "alpha", id: "a1" }), M({ provider: "alpha", id: "a2" }),
    M({ provider: core.FAS_PROVIDER, id: core.FAS_MODEL_ID }), // must never be its own candidate
    M({ provider: "beta", id: "b1" }), M({ provider: "beta", id: "b1" }), // duplicate
  ];
  const d = core.discoverCandidates(all, undefined);
  assert(!d.some((m) => m.provider === core.FAS_PROVIDER), "discovery excludes fas-router itself (no self-routing)");
  assert(d.filter((m) => m.provider === "beta").length === 1, "global dedup by provider/id");
  assert(d.length === 3, `discovery yields unique non-self candidates (got ${d.length})`);
  const avail = [M({ provider: "alpha", id: "a1" })];
  const d2 = core.discoverCandidates(all, avail);
  assert(d2.length === 1 && d2[0].id === "a1", "when availability is known, only available candidates are used");
}

async function D2_capability_filter() {
  const pool = [
    M({ provider: "p", id: "text-only", input: ["text"] }),
    M({ provider: "p", id: "vision", input: ["text", "image"] }),
    M({ provider: "p", id: "small-ctx", contextWindow: 8000 }),
    M({ provider: "p", id: "no-reasoning", reasoning: false }),
    M({ provider: "excluded", id: "x" }),
  ];
  const f = core.hardFilter(pool, { requiredInput: ["image"] });
  assert(f.length === 1 && f[0].id === "vision", "capability filter: requiredInput image");
  const f2 = core.hardFilter(pool, { minContextWindow: 32000 });
  assert(f2.every((m) => m.contextWindow >= 32000) && !f2.some((m) => m.id === "small-ctx"), "capability filter: minContextWindow");
  const f3 = core.hardFilter(pool, { needsReasoning: true });
  assert(f3.every((m) => m.reasoning === true) && !f3.some((m) => m.id === "no-reasoning"), "capability filter: needsReasoning");
  const f4 = core.hardFilter(pool, { excludedProviders: ["excluded"] });
  assert(!f4.some((m) => m.provider === "excluded"), "capability filter: excludedProviders");
  const f5 = core.hardFilter(pool.concat(M({ provider: core.FAS_PROVIDER, id: "auto" })), {});
  assert(!f5.some((m) => m.provider === core.FAS_PROVIDER), "capability filter also self-excludes");
}

async function D3_shortlist_bounds_and_provider_locality() {
  const many = [];
  for (let p = 0; p < 4; p++) for (let i = 0; i < 12; i++) many.push(M({ provider: "prov" + p, id: "m" + i }));
  const sl = core.shortlistPerProvider(many, {}, core.newEvidenceStore());
  assert(Object.keys(sl).length === 4, "shortlist covers each provider separately");
  for (const [p, list] of Object.entries(sl)) {
    assert(list.length >= core.SHORTLIST_MIN && list.length <= core.SHORTLIST_SIZE, `${p} shortlist within [${core.SHORTLIST_MIN},${core.SHORTLIST_SIZE}] (got ${list.length})`);
    assert(list.every((m) => m.provider === p), `${p} shortlist is provider-local`);
  }
  const few = [M({ provider: "only", id: "a" }), M({ provider: "only", id: "b" })];
  const sl2 = core.shortlistPerProvider(few, {}, core.newEvidenceStore());
  assert(sl2.only.length === 2, "shortlist smaller than 3 is not padded (no invented candidates)");
}

async function D4_deterministic_ranking() {
  const pool = [M({ provider: "c", id: "x" }), M({ provider: "a", id: "z" }), M({ provider: "b", id: "y" }), M({ provider: "a", id: "a" })];
  const r1 = core.rankCandidates(pool, {}, core.newEvidenceStore()).map(core.modelKey);
  const r2 = core.rankCandidates(pool.slice().reverse(), {}, core.newEvidenceStore()).map(core.modelKey);
  assert(r1.join(",") === r2.join(","), `ranking is input-order independent (${r1.join(",")} vs ${r2.join(",")})`);
  const r3 = core.rankCandidates(pool, {}, core.newEvidenceStore()).map(core.modelKey);
  assert(r1.join(",") === r3.join(","), "ranking is deterministic across calls");
  assert(new Set(r1).size === r1.length, "ranking has no duplicates");
  // evidence changes rank deterministically
  let s = core.newEvidenceStore();
  s = core.recordOutcome(s, { provider: "c", id: "x", ok: true, latencyMs: 100, at: 1 });
  const r4 = core.rankCandidates(pool, {}, s)[0];
  assert(core.modelKey(r4) === "c/x", "proven-good candidate rises to the top deterministically");
}

async function D5_penalty_skip_and_failsafe() {
  let s = core.newEvidenceStore();
  for (let i = 0; i < core.VERIFIED_FAILURE_THRESHOLD; i++) s = core.recordOutcome(s, { provider: "bad", id: "m", ok: false, kind: "timeout", at: i + 1 });
  const ranked = core.rankCandidates([M({ provider: "bad", id: "m" }), M({ provider: "good", id: "g" })], {}, s);
  assert(!ranked.some((m) => m.provider === "bad"), "verified-failure candidate dropped from ranked pool");
  // fail-safe: if ALL are penalized, still return the pool rather than nothing
  const allBad = core.rankCandidates([M({ provider: "bad", id: "m" })], {}, s);
  assert(allBad.length === 1, "fail-safe: all-penalized pool still returns candidates (bounded retries prevent loops)");
}

async function D8_extension_lanes_surve_in_rank() {
  // Extension-registered lanes (freeflow/…) are absent from models-store.json
  // (their extension was not loaded there) yet live in the registry — and live
  // in the KB after serving. rankCandidates must order ALL registry lanes
  // passed to it, never only store-known ones.
  const s = core.newEvidenceStore();
  const ff = M({ provider: "freeflow", id: "kilo-auto/free" });
  const hist = M({ provider: "cline", id: "cline-free/deepseek-v4.1-flash" });
  let rs = core.recordOutcome(s, { provider: "freeflow", id: "kilo-auto/free", ok: true, latencyMs: 900, at: 1 });
  const ranked = core.rankCandidates([ff, hist, M({ provider: "x", id: "dead" })], {}, rs);
  assert(ranked.some((m) => m.provider === "freeflow"), "extension lane survives rank (not filtered as unknown)");
  assert(core.modelKey(ranked[0]) === "freeflow/kilo-auto/free", "served extension lane outranks unproven lanes");
  // failure evidence on an extension lane records under its own key too
  rs = core.recordOutcome(rs, { provider: "freeflow", id: "kilo-auto/free", ok: false, kind: "execution", at: 2 });
  assert(rs.stats["freeflow/kilo-auto/free"].consecutiveFailures === 1, "extension-lane failure tracked");
  assert(rs.providers["freeflow"].consec === 1, "extension provider rollup tracked");
}

async function D6_catalog_vs_live_is_explicit() {
  // The distinction must be observable in the STATUS output, not just implied.
  const pi = { registered: [], commands: [], handlers: {}, on() {}, registerCommand(n, o) { this.commands.push({ name: n, ...o }); }, registerProvider(n, c) { this.registered.push({ name: n, config: c }); }, async setModel() { return true; }, getThinkingLevel() { return "off"; }, setThinkingLevel() {} };
  const catalog = [M({ provider: "openrouter", id: "a" }), M({ provider: "kilo", id: "b" }), M({ provider: "never-authed", id: "c" })];
  const available = [M({ provider: "openrouter", id: "a" }), M({ provider: "kilo", id: "b" })];
  const deps = {
    getCandidates: () => catalog, getAvailable: () => available,
    getAuth: async () => ({ ok: true, apiKey: "k" }), streamCandidate: async function* () {}, createEventStream: () => ({ push() {}, end() {} }),
    fallbackModel: () => undefined, findModel: () => undefined, getCurrentModel: () => undefined,
    now: () => 1, log: () => {}, loadKnowledge: () => core.newEvidenceStore(), saveKnowledge: () => {},
  };
  core.installFas(pi, deps);
  const notified = [];
  const ctx = { model: M({ provider: "openrouter", id: "a" }), thinkingLevel: "off", getContextUsage: () => null, compact() {}, ui: { notify: (msg, kind) => notified.push({ msg, kind }) }, modelRegistry: { find: () => undefined } };
  await pi.commands.find((c) => c.name === "fas-router:status").handler("", ctx);
  const msg = notified.map((n) => n.msg).join("\n");
  assert(msg.includes("Candidates: 2"), `status reports AVAILABLE count (2), not catalog size (3) — got:\n${msg}`);
  assert(!msg.includes("Candidates: 3"), "status never labels unauthenticated catalog entries as live candidates");
}

// ─ Step 6 ─────────────────────────────────────────────────────────
async function B1_min_sufficient_thinking() {
  assert(core.decideThinking(M({ provider: "p", id: "plain", reasoning: false }), "medium").level === "off", "non-reasoning → off");
  const r = M({ provider: "p", id: "r", reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "med", high: "high" } });
  assert(core.selectMinThinkingLevel(r) === "low", "minimum-sufficient = first non-null supported level (low when off+minimal unsupported)");
  const d = core.decideThinking(r, "off");
  assert(d.level === "low" && d.changed === true && d.reason === "min-sufficient", "off → min-sufficient supported level");
  const d2 = core.decideThinking(r, "medium");
  assert(d2.changed === false && d2.reason === "sufficient", "already-sufficient level is not lowered or raised");
  const plain = M({ provider: "p", id: "plain2", reasoning: true });
  assert(core.selectMinThinkingLevel(plain) === "minimal", "reasoning without a map defaults to minimal");
  const offOnly = M({ provider: "p", id: "offonly", reasoning: true, thinkingLevelMap: { off: null, minimal: "min", low: "low" } });
  assert(core.selectMinThinkingLevel(offOnly) === "minimal", "off:null is skipped; minimal becomes the minimum-sufficient level");
}

async function B2_evidence_escalation() {
  const r = M({ provider: "p", id: "r", reasoning: true, thinkingLevelMap: { off: null, minimal: "min", low: "low", medium: "med", high: "high", xhigh: "xh" } });
  const up = core.decideThinking(r, "low", { insufficient: true });
  assert(up.level === "medium" && up.changed && up.reason === "evidence-insufficient", "insufficient evidence escalates exactly one supported level");
  const cap = core.decideThinking(r, "high", { insufficient: true });
  assert(cap.level === "xhigh", "escalation continues while a higher supported level exists");
  const top = M({ provider: "p", id: "t", reasoning: true, thinkingLevelMap: { off: null, minimal: "min", low: "low" } });
  const nowhere = core.decideThinking(top, "low", { insufficient: true });
  assert(nowhere.changed === false && nowhere.level === "low", "no higher supported level → no change (never invents a level)");
  assert(core.nextThinkingLevel("max") === null, "nextThinkingLevel is bounded at the top");
}

async function B3_output_token_enforcement() {
  const m = M({ provider: "p", id: "r", maxTokens: 4096 });
  const b = core.planBudgets(m, { tokens: 1000, contextWindow: 128000, percent: 0.8 });
  assert(b.maxOutputTokens === 4096, "maxOutputTokens taken from the candidate model's real maxTokens");
  const states = core.budgetStates();
  const mot = states.find((s) => s.budget === "maxOutputTokens");
  assert(mot.state === "ENFORCED", "maxOutputTokens is declared ENFORCED, not advisory");
  const m2 = M({ provider: "p", id: "r2", maxTokens: undefined, contextWindow: 64000 });
  const b2 = core.planBudgets({ ...m2, maxTokens: 0 }, { tokens: 1, contextWindow: 64000, percent: 0 });
  assert(b2.maxOutputTokens === 0, "no model maxTokens → no invented output cap (reports 0)");
}

async function B4_context_threshold_and_advisory_only() {
  const m = M({ provider: "p", id: "r", maxTokens: 8192 });
  const hi = core.planBudgets(m, { tokens: 120000, contextWindow: 128000, percent: 93.75 });
  assert(hi.compact === true && hi.reason === "context-high", ">85% context → compact decision true");
  const ok = core.planBudgets(m, { tokens: 100000, contextWindow: 128000, percent: 78.1 });
  assert(ok.compact === false && ok.reason === "context-ok", "≤85% context → no compaction");
  const edge = core.planBudgets(m, { tokens: 108800, contextWindow: 128000, percent: 85.0 });
  assert(edge.compact === false, "exactly 85% is not > 85% (boundary is exclusive)");
  const none = core.planBudgets(m, null);
  assert(none.compact === false && none.trim === false && none.reason === "no-telemetry", "no telemetry → no compaction no trim, no crash");
  // trim threshold is separate and advisory
  const trimCase = core.planBudgets(m, { tokens: 110000, contextWindow: 128000, percent: 85.9 });
  assert(trimCase.trim === true, "trim flagged when within 20k of the window");
  const states = core.budgetStates();
  assert(states.find((s) => s.budget === "compact").state === "CORE-DELEGATED", "compaction is explicitly CORE-DELEGATED (ctx.compact())");
  assert(states.find((s) => s.budget === "maxRounds").state === "ADVISORY-ONLY", "maxRounds is explicitly ADVISORY-ONLY");
  assert(states.find((s) => s.budget === "trim").state === "ADVISORY-ONLY", "trim is explicitly ADVISORY-ONLY");
  assert(states.every((s) => ["ENFORCED", "CORE-DELEGATED", "ADVISORY-ONLY"].includes(s.state)), "no budget claims an unsupported enforcement level");
  // maxRounds is computed but advisory
  const rounds = core.planBudgets(m, { tokens: 1000, contextWindow: 128000, percent: 0.8 });
  assert(rounds.maxRounds === Math.max(1, Math.floor((128000 - 1000) / 8000)), "maxRounds derived from remaining context (advisory)");
}

async function B5_token_efficiency_report_renders() {
  const pi = { registered: [], commands: [], handlers: {}, on() {}, registerCommand(n, o) { this.commands.push({ name: n, ...o }); }, registerProvider(n, c) { this.registered.push({ name: n, config: c }); }, async setModel() { return true; }, getThinkingLevel() { return "minimal"; }, setThinkingLevel() {} };
  const deps = { getCandidates: () => [M({ provider: "p", id: "r", maxTokens: 4096 })], getAvailable: () => undefined, getAuth: async () => ({ ok: true }), streamCandidate: async function* () {}, createEventStream: () => ({ push() {}, end() {} }), fallbackModel: () => undefined, findModel: () => undefined, getCurrentModel: () => undefined, now: () => 1, log: () => {}, loadKnowledge: () => core.newEvidenceStore(), saveKnowledge: () => {} };
  core.installFas(pi, deps);
  const notified = [];
  const model = M({ provider: "p", id: "r", reasoning: true, maxTokens: 4096, thinkingLevelMap: { off: null, minimal: "min", low: "low" } });
  const ctx = { model, thinkingLevel: "minimal", getContextUsage: () => ({ tokens: 64000, contextWindow: 128000, percent: 50 }), compact() {}, ui: { notify: (m, k) => notified.push({ msg: m, kind: k }) }, modelRegistry: { find: () => undefined } };
  await pi.commands.find((c) => c.name === "token-efficiency").handler("", ctx);
  const t = notified.map((n) => n.msg).join("\n");
  assert(t.includes("FAS Token Efficiency Report"), "report renders");
  assert(!/unable to report metrics/.test(t), "no crash fallback");
  assert(t.includes("Thinking Level: minimal"), "reports current thinking level from the real context property");
  assert(t.includes("Available Thinking Levels:"), "reports the model's supported thinking levels");
  assert(t.includes("Round Budget:"), "reports the advisory round budget");
  assert(t.includes("Context: 64,000 / 128,000"), "reports measured context usage");
  assert(notified.every((n) => n.kind === "info"), "report is not an error");
}

await runTest("D1. self-exclusion + global dedup + availability preference", D1_self_exclusion_and_dedup);
await runTest("D2. capability filtering", D2_capability_filter);
await runTest("D3. provider-local shortlist bounds", D3_shortlist_bounds_and_provider_locality);
await runTest("D4. deterministic ranking", D4_deterministic_ranking);
await runTest("D5. penalty skip + fail-safe pool", D5_penalty_skip_and_failsafe);
await runTest("D6. catalog ≠ live availability is explicit", D6_catalog_vs_live_is_explicit);
await runTest("B1. minimum-sufficient thinking selection", B1_min_sufficient_thinking);
await runTest("B2. evidence-based escalation", B2_evidence_escalation);
await runTest("B3. output-token enforcement", B3_output_token_enforcement);
await runTest("B4. context threshold + advisory-only budgets", B4_context_threshold_and_advisory_only);
await runTest("B5. token-efficiency report renders", B5_token_efficiency_report_renders);
await runTest("D7. negative cost is not a bonus", D7_negative_cost_is_not_a_bonus);
await runTest("D8. extension lanes survive in rank", D8_extension_lanes_surve_in_rank);

console.log(`\n=== FAS Discovery+Budget Suite ===`);
console.log(`Passed: ${passed}/${passed + failed}`);
if (failed) { console.error(`Failed: ${failed}`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log("ALL DISCOVERY+BUDGET TESTS PASSED");