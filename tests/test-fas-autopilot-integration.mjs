/**
 * FAS ↔ AUTOPILOT INTEGRATION REGRESSION SUITE
 * (durable: ~/fas-verify/tests/)
 *
 * Proves:
 *   T1. When FAS is active (model = fas-router/auto), Autopilot delegates
 *       execution through fas-router/auto — does NOT override with a
 *       catalog-scanned reasoning model.
 *   T2. When FAS is active, Autopilot does NOT unconditionally force
 *       thinking="max" — FAS's model_select/turn_end handlers control it.
 *   T3. When FAS is inactive, Autopilot still picks reasoning models
 *       from the catalog (existing behavior preserved).
 *   T4. Explicit user model selection (when FAS is inactive) is respected
 *       — Autopilot overrides only via pi.setModel(reasoningModel), which
 *       is the documented method.
 *
 * TDD baseline: T1 and T2 FAIL on current source (Autopilot bypasses FAS).
 * Fix: make setupReasoningModel() FAS-aware and gate thinking="max" on
 * FAS-inactive state.
 * T5/T6 (this fix): with FAS inactive, Autopilot must consult the FAS
 * knowledge base — skip verified-failure / cooldown lanes and keep a
 * proven healthy current lane instead of switching onto dead quota-gone
 * models. TDD baseline: T5 and T6 FAIL on hint-only picking.
 */
"use strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

// Deterministic KB consult: point Autopilot at a missing KB by default so
// T1–T4 pin the pre-evidence behavior; T5/T6 inject crafted fixtures.
const HOME = process.env.HOME ?? "/data/data/com.termux/files/home";
const AP_KB_NONE = "/nonexistent-ap-fas-kb.json";
if (!process.env.AP_FAS_KB_PATH) process.env.AP_FAS_KB_PATH = AP_KB_NONE;

async function withKb(kbObj, fn) {
  const prev = process.env.AP_FAS_KB_PATH;
  const dir = fs.mkdtempSync(path.join(HOME, "apkb-"));
  const file = path.join(dir, "kb.json");
  try {
    fs.writeFileSync(file, JSON.stringify(kbObj));
    process.env.AP_FAS_KB_PATH = file;
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.AP_FAS_KB_PATH;
    else process.env.AP_FAS_KB_PATH = prev;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const require_ = createRequire(import.meta.url);
const PI = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const { createJiti } = require_(path.join(PI, "node_modules/jiti/lib/jiti.cjs"));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
  alias: { "@earendil-works/pi-ai": path.join(PI, "node_modules/@earendil-works/pi-ai/dist/compat.js") },
});
const autopilot = await jiti.import("/data/data/com.termux/files/home/.pi/agent/extensions/autopilot/index.ts");
const fasCore = await jiti.import("/data/data/com.termux/files/home/.pi/extensions/fas/core.ts");

/** Use FAS core constants for proper coupling — no hardcoded IDs */
const FAS_PROVIDER = fasCore.FAS_PROVIDER;
const FAS_MODEL_ID = fasCore.FAS_MODEL_ID;

let passed = 0, failed = 0;
const failures = [];
function assert(c, msg) { if (c) passed++; else { failed++; failures.push(msg); console.error(`  FAIL: ${msg}`); } }
async function runTest(name, fn) {
  console.log(`\n--- ${name} ---`);
  try { await fn(); } catch (e) { failed++; failures.push(`${name}: ${e.message}`); console.error(`  FAIL: ${e.message}`); }
}

function mockPi() {
  return {
    registeredCommands: [],
    setModelCalls: [],
    setThinkingLevelCalls: [],
    sendUserMessageCalls: [],
    getAllToolsCalls: [],
    getActiveToolsCalls: [],
    setActiveToolsCalls: [],
    async registerCommand(name, opts) { this.registeredCommands.push({ name, ...opts }); },
    async setModel(m) { this.setModelCalls.push(m); return true; },
    async setThinkingLevel(l) { this.setThinkingLevelCalls.push(l); },
    async sendUserMessage(...args) { this.sendUserMessageCalls.push(args); },
    getAllTools() { this.getAllToolsCalls.push(1); return []; },
    getActiveTools() { this.getActiveToolsCalls.push(1); return []; },
    setActiveTools(t) { this.setActiveToolsCalls.push(t); },
  };
}

function mockCtx(o) {
  const opts = o || {};
  return {
    model: opts.model || null,
    isIdle: () => opts.isIdle ?? true,
    waitForIdle: opts.waitForIdle || (async () => {}),
    cwd: opts.cwd || "/tmp",
    sendUserMessage: opts.sendUserMessage || (async () => {}),
    ui: {
      notify: opts.notify || (() => {}),
      setStatus: opts.setStatus || (() => {}),
      setWidget: opts.setWidget || (() => {}),
    },
    modelRegistry: opts.modelRegistry || {
      getAvailable: () => opts.availableModels || [],
      getAll: () => opts.availableModels || [],
    },
  };
}

const reasoningModel = { provider: "cline", id: "cline/google/gemma-4-26b-a4b-it:free", reasoning: true };
const regularModel = { provider: "openrouter", id: "openrouter/model-v1", reasoning: false };

async function T1_fas_active_delegates_through_fas_router() {
  const pi = mockPi();
  const ctx = mockCtx({ model: { provider: FAS_PROVIDER, id: FAS_MODEL_ID, reasoning: true }, availableModels: [reasoningModel, { provider: FAS_PROVIDER, id: FAS_MODEL_ID, reasoning: true }] });
  autopilot.default(pi);
  const cmd = pi.registeredCommands.find((c) => c.name === "ap");
  assert(!!cmd, "ap command registered");
  await cmd.handler("fix the bug", ctx);
  assert(pi.setModelCalls.length === 0,
    `T1: Autopilot should NOT call setModel when FAS is active (calls: ${JSON.stringify(pi.setModelCalls.map(m => m?.provider + "/" + m?.id))})`);
  assert(!pi.setThinkingLevelCalls.includes("max"),
    `T1: Autopilot should NOT force thinking=max when FAS is active (calls: ${JSON.stringify(pi.setThinkingLevelCalls)})`);
}

async function T2_fas_inactive_picks_reasoning_model() {
  const pi = mockPi();
  const ctx = mockCtx({ model: regularModel, availableModels: [reasoningModel, regularModel] });
  autopilot.default(pi);
  const cmd = pi.registeredCommands.find((c) => c.name === "ap");
  assert(!!cmd, "ap command registered");
  await cmd.handler("fix the bug", ctx);
  assert(pi.setModelCalls.length > 0,
    `T2: Autopilot should call setModel when FAS is inactive (calls: ${JSON.stringify(pi.setModelCalls)})`);
  assert(pi.setThinkingLevelCalls.includes("max"),
    `T2: Autopilot should force thinking=max when FAS is inactive (calls: ${JSON.stringify(pi.setThinkingLevelCalls)})`);
}

async function T3_fas_active_respects_fas_model() {
  const pi = mockPi();
  const ctx = mockCtx({ model: { provider: FAS_PROVIDER, id: FAS_MODEL_ID, reasoning: true }, availableModels: [reasoningModel, { provider: FAS_PROVIDER, id: FAS_MODEL_ID, reasoning: true }, { provider: "kilo", id: "kilo/multi-200k", reasoning: true }] });
  autopilot.default(pi);
  const cmd = pi.registeredCommands.find((c) => c.name === "ap");
  assert(!!cmd, "ap command registered");
  await cmd.handler("test task", ctx);
  const overridesFas = pi.setModelCalls.some((m) => m.provider !== FAS_PROVIDER);
  assert(!overridesFas, `T3: Should not override FAS model with non-FAS model (calls: ${JSON.stringify(pi.setModelCalls)})`);
  assert(pi.setModelCalls.length === 0, `T3: Should make NO setModel call when FAS is active (calls: ${JSON.stringify(pi.setModelCalls)})`);
  assert(!pi.setThinkingLevelCalls.includes("max"),
    `T3: Should not force thinking=max on FAS path (calls: ${JSON.stringify(pi.setThinkingLevelCalls)})`);
}

async function T4_fas_inactive_regular_model_preserved() {
  const pi = mockPi();
  const ctx = mockCtx({ model: regularModel, availableModels: [reasoningModel, regularModel] });
  autopilot.default(pi);
  const cmd = pi.registeredCommands.find((c) => c.name === "ap");
  assert(!!cmd, "ap command registered");
  await cmd.handler("test task", ctx);
  assert(pi.setModelCalls.length > 0,
    `T4: Autopilot should set a reasoning model when FAS is inactive (calls: ${JSON.stringify(pi.setModelCalls)})`);
  assert(pi.setThinkingLevelCalls.includes("max"),
    `T4: thinking=max should be forced when FAS is inactive (calls: ${JSON.stringify(pi.setThinkingLevelCalls)})`);
}

async function T5_fas_inactive_skips_fas_blocked_lanes() {
  const kb = {
    stats: {
      "dead/deepseek-v4-pro": { attempts: 3, successes: 0, failures: 3, consecutiveFailures: 3 },
      "good/kimi-k3": { attempts: 2, successes: 2, failures: 0, consecutiveFailures: 0 },
    },
    providers: {},
  };
  const calls = await withKb(kb, async () => {
    const pi = mockPi();
    const dead = { provider: "dead", id: "deepseek-v4-pro", reasoning: true };
    const good = { provider: "good", id: "kimi-k3", reasoning: true };
    const ctx = mockCtx({ model: regularModel, availableModels: [dead, good] });
    autopilot.default(pi);
    const cmd = pi.registeredCommands.find((c) => c.name === "ap");
    await cmd.handler("fix the bug", ctx);
    return pi.setModelCalls;
  });
  assert(calls.length > 0 && calls[0].provider === "good",
    `T5: blocked top-hint lane skipped, proven lane picked first (calls: ${JSON.stringify(calls.map((m) => m?.provider + "/" + m?.id))})`);
  assert(!calls.some((m) => m.provider === "dead"),
    "T5: FAS-blocked lane never attempted when a healthy lane has auth");
}

async function T6_healthy_proven_current_lane_kept() {
  const kb = {
    stats: {
      "good/kimi-k3": { attempts: 3, successes: 3, failures: 0, consecutiveFailures: 0 },
    },
    providers: {},
  };
  const calls = await withKb(kb, async () => {
    const pi = mockPi();
    const cur = { provider: "good", id: "kimi-k3", reasoning: true };
    const other = { provider: "dead", id: "deepseek-v4-pro", reasoning: true };
    const ctx = mockCtx({ model: cur, availableModels: [other, cur] });
    autopilot.default(pi);
    const cmd = pi.registeredCommands.find((c) => c.name === "ap");
    await cmd.handler("keep working", ctx);
    return pi.setModelCalls;
  });
  assert(calls.length === 0,
    `T6: proven healthy current lane kept, no model switch (calls: ${JSON.stringify(calls.map((m) => m?.provider + "/" + m?.id))})`);
}

await runTest("T1. FAS active → delegates through fas-router/auto, no thinking=max", T1_fas_active_delegates_through_fas_router);
await runTest("T2. FAS inactive → picks reasoning model, thinking=max forced", T2_fas_inactive_picks_reasoning_model);
await runTest("T3. FAS active → does not override FAS model or force thinking=max", T3_fas_active_respects_fas_model);
await runTest("T4. FAS inactive with regular model → existing behavior preserved", T4_fas_inactive_regular_model_preserved);
await runTest("T5. FAS inactive → FAS-blocked lanes skipped, proven lane first", T5_fas_inactive_skips_fas_blocked_lanes);
await runTest("T6. FAS inactive → proven healthy current lane kept (no switch)", T6_healthy_proven_current_lane_kept);

console.log(`\n=== FAS Autopilot Integration Suite ===`);
console.log(`Passed: ${passed}/${passed + failed}`);
if (failed) { console.error(`Failed: ${failed}`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log("ALL AUTOPILOT INTEGRATION TESTS PASSED");
