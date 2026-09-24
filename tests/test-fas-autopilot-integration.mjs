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

await runTest("T1. FAS active → delegates through fas-router/auto, no thinking=max", T1_fas_active_delegates_through_fas_router);
await runTest("T2. FAS inactive → picks reasoning model, thinking=max forced", T2_fas_inactive_picks_reasoning_model);
await runTest("T3. FAS active → does not override FAS model or force thinking=max", T3_fas_active_respects_fas_model);
await runTest("T4. FAS inactive with regular model → existing behavior preserved", T4_fas_inactive_regular_model_preserved);

console.log(`\n=== FAS Autopilot Integration Suite ===`);
console.log(`Passed: ${passed}/${passed + failed}`);
if (failed) { console.error(`Failed: ${failed}`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log("ALL AUTOPILOT INTEGRATION TESTS PASSED");
