/**
 * FAS ↔ WORKFLOW INTEGRATION REGRESSION SUITE (Phase 2F)
 * (durable: ~/fas-verify/tests/)
 *
 * Proves:
 *   W1. When FAS is active (effective child model = fas-router/auto), workflow
 *       phase children spawned via runPhase must load the FAS extension
 *       (-e <fas path> in child argv) together with "--model fas-router/auto",
 *       so the model resolves in the child and the child is routed through FAS
 *       (independent per-process context).
 *       TODAY: runPhase() builds child argv with --model but NEVER any -e
 *       extension inheritance; FAS registers no tools → child never loads FAS →
 *       "--model fas-router/auto" is unresolvable in the child and it silently
 *       falls back to an arbitrary static model (FAS bypass — same class as
 *       pre-fix subagents, Phase 2E).
 *   W2. Non-FAS parent → child argv has NO -e FAS path (existing behavior
 *       preserved; explicit model selection untouched).
 *   W3. FAS-effective but command discovery fails/missing → graceful, no throw,
 *       no -e added, --model still present (falls back to today's behavior).
 *   W4. Phase model override preserved: phase.model="qwen/..." with FAS-active
 *       parent → child --model is the override and NO -e FAS (effective child
 *       model is not FAS); phase.model="fas-router/auto" with non-FAS parent →
 *       child gets -e FAS + --model fas-router/auto (gated on EFFECTIVE model).
 *   W5. Thinking/tools/DAG/RPC behavior unchanged: --thinking and --tools values
 *       identical with and without FAS; phase still succeeds via the RPC client.
 *   W6. Nested-routing safety: real fasCore.discoverCandidates() excludes
 *       fas-router/auto itself → a workflow child FAS instance can never
 *       re-route through fas-router/auto (no self-recursion).
 *
 * TDD baseline: W1 FAILS on current source (no -e in workflow child argv).
 * Fix: runPhase() appends "-e <FAS path>" (discovered via pi.getCommands() →
 * "fas-router:on" sourceInfo.path) when the EFFECTIVE child model is
 * fas-router/auto.
 */
"use strict";
import { createRequire } from "node:module";
import * as path from "node:path";
import { existsSync, realpathSync } from "node:fs";

const require_ = createRequire(import.meta.url);
const PI = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const HOME = process.env.HOME ?? "/data/data/com.termux/files/home";
const { createJiti } = require_(path.join(PI, "node_modules/jiti/lib/jiti.cjs"));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
  alias: {
    "@earendil-works/pi-ai": path.join(PI, "node_modules/@earendil-works/pi-ai/dist/compat.js"),
    "@earendil-works/pi-coding-agent": path.join(PI, "dist/index.js"),
  },
});
const runnerMod = await jiti.import(path.join(HOME, ".pi/pi-enhanced/extensions/workflow/runner.ts"));
const schemaMod = await jiti.import(path.join(HOME, ".pi/pi-enhanced/extensions/workflow/schema.ts"));
const fasCore = await jiti.import(path.join(HOME, ".pi/extensions/fas/core.ts"));

const FAS_PROVIDER = fasCore.FAS_PROVIDER;
const FAS_MODEL_ID = fasCore.FAS_MODEL_ID;
const FAS_MODEL = `${FAS_PROVIDER}/${FAS_MODEL_ID}`;

// Real on-disk path (required: fix resolves + existsSync).
const FAS_INDEX = realpathSync(path.join(HOME, ".pi/extensions/fas/index.ts"));
if (!existsSync(FAS_INDEX)) {
  console.error("FATAL: FAS extension path missing");
  process.exit(2);
}

let passed = 0, failed = 0;
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}

class FakeClient {
  onEvent;
  async request(command) {
    if (command.type === "prompt" || command.type === "steer") return { success: true };
    if (command.type === "get_messages") return { success: true, data: { messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" }] } };
    if (command.type === "get_state") return { success: true, data: { sessionFile: "/tmp/child.jsonl" } };
    return { success: true };
  }
  async waitForSettled() { this.onEvent?.({ type: "agent_settled" }); }
  getStderr() { return ""; }
  async abort() { await this.stop(); }
  async stop() {}
}

function textMessages(text) {
  return [{ role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }];
}

/** Minimal harness mirroring workflow's own tests/runner.test.ts pattern. */
function harness({ model, fasCommands = true, throwCommands = false, phaseModel, thinking = "off" } = {}) {
  const invocations = [];
  const pi = {
    appendEntry() {},
    sendMessage() {},
    getThinkingLevel: () => thinking,
    getActiveTools: () => ["read", "workflow_run"],
    getCommands: () => {
      if (throwCommands) throw new Error("commands unavailable");
      if (!fasCommands) return [];
      return [
        { name: "fas-router:on", description: "Activate FAS", source: "extension", sourceInfo: { source: "local", path: FAS_INDEX } },
        { name: "fas-router:status", description: "FAS status", source: "extension", sourceInfo: { source: "local", path: FAS_INDEX } },
      ];
    },
  };
  const runner = new runnerMod.WorkflowRunner(pi, {}, {
    getInvocation: (args) => ({ command: "fake-pi", args }),
    createClient: (_command, args, _cwd, _env) => {
      invocations.push({ args: [...args] });
      return new FakeClient();
    },
    writeSystemPrompt: () => {},
  });
  const ctx = {
    cwd: process.cwd(), mode: "tui", hasUI: true,
    model: model ? { provider: model.provider, id: model.id } : undefined,
    isProjectTrusted: () => false,
    sessionManager: { getSessionFile: () => "/tmp/parent.jsonl", getBranch: () => [], getEntries: () => [] },
    ui: { setStatus() {}, setWidget() {}, notify() {}, appendEntry() {} },
  };
  const phases = [{ id: "run", prompt: "Do {{input}}", ...(phaseModel ? { model: phaseModel } : {}) }];
  const workflow = schemaMod.validateWorkflow({ phases }, "/tmp/test.yaml", "global");
  return { runner, ctx, workflow, invocations };
}

function countFlag(args, flag, value) {
  let n = 0;
  for (let i = 0; i < args.length - 1; i++) if (args[i] === flag && args[i + 1] === value) n++;
  return n;
}
function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

console.log("W1. FAS-active parent → child argv has -e <fas> + --model fas-router/auto");
{
  const h = harness({ model: { provider: FAS_PROVIDER, id: FAS_MODEL_ID } });
  const state = await h.runner.run({ workflow: h.workflow, input: "x", ctx: h.ctx, displayPanel: false });
  ok("phase succeeded", state.status === "succeeded", state.status);
  ok("exactly one -e <fas>", countFlag(h.invocations[0].args, "-e", FAS_INDEX) === 1,
    JSON.stringify(h.invocations[0]?.args));
  ok("--model fas-router/auto present", flagValue(h.invocations[0].args, "--model") === FAS_MODEL);
}

console.log("W2. Non-FAS parent → no -e FAS, explicit model preserved");
{
  const h = harness({ model: { provider: "qwen", id: "qwen3-coder" } });
  const state = await h.runner.run({ workflow: h.workflow, input: "x", ctx: h.ctx, displayPanel: false });
  ok("phase succeeded", state.status === "succeeded", state.status);
  const args = h.invocations[0].args;
  ok("no -e at all (today's behavior)", !args.includes("-e"), JSON.stringify(args));
  ok("--model qwen/qwen3-coder preserved", flagValue(args, "--model") === "qwen/qwen3-coder");
}

console.log("W3. FAS-effective + discovery fails → graceful, --model kept");
{
  for (const opts of [{ fasCommands: false }, { throwCommands: true }]) {
    const h = harness({ model: { provider: FAS_PROVIDER, id: FAS_MODEL_ID }, ...opts });
    let threw = false, state;
    try { state = await h.runner.run({ workflow: h.workflow, input: "x", ctx: h.ctx, displayPanel: false }); }
    catch (e) { threw = true; }
    ok(`no throw (${JSON.stringify(opts)})`, !threw);
    ok("phase succeeded", state?.status === "succeeded", state?.status);
    ok("no -e added", !h.invocations[0].args.includes("-e"));
    ok("--model fas-router/auto still present", flagValue(h.invocations[0].args, "--model") === FAS_MODEL);
  }
}

console.log("W4. Phase model override preserved (gated on EFFECTIVE child model)");
{
  const h = harness({ model: { provider: FAS_PROVIDER, id: FAS_MODEL_ID }, phaseModel: "qwen/qwen3-coder" });
  const state = await h.runner.run({ workflow: h.workflow, input: "x", ctx: h.ctx, displayPanel: false });
  ok("phase succeeded", state.status === "succeeded", state.status);
  ok("--model is the override", flagValue(h.invocations[0].args, "--model") === "qwen/qwen3-coder");
  ok("no -e FAS (effective model is not FAS)", !h.invocations[0].args.includes("-e"));
}
{
  const h = harness({ model: { provider: "qwen", id: "qwen3-coder" }, phaseModel: FAS_MODEL });
  const state = await h.runner.run({ workflow: h.workflow, input: "x", ctx: h.ctx, displayPanel: false });
  ok("phase succeeded", state.status === "succeeded", state.status);
  ok("override to FAS honored: -e <fas> exactly once",
    countFlag(h.invocations[0].args, "-e", FAS_INDEX) === 1);
  ok("--model fas-router/auto", flagValue(h.invocations[0].args, "--model") === FAS_MODEL);
}

console.log("W5. Thinking/tools/DAG/RPC unchanged with FAS active");
{
  const h = harness({ model: { provider: FAS_PROVIDER, id: FAS_MODEL_ID }, thinking: "low" });
  const state = await h.runner.run({ workflow: h.workflow, input: "x", ctx: h.ctx, displayPanel: false });
  ok("phase succeeded", state.status === "succeeded", state.status);
  const args = h.invocations[0].args;
  ok("--thinking inherits parent (low)", flagValue(args, "--thinking") === "low", JSON.stringify(args));
  ok("--tools unchanged", flagValue(args, "--tools") === "read", JSON.stringify(args));
}

console.log("W6. Nested-routing safety: discoverCandidates excludes fas-router/auto");
{
  const pool = [
    { provider: FAS_PROVIDER, id: FAS_MODEL_ID },
    { provider: "pteam", id: "good", api: "openai-completions", authConfigured: true },
  ];
  const candidates = fasCore.discoverCandidates(pool, pool);
  ok("fas-router/auto never a candidate (no self-recursion)",
    !candidates.some((c) => c.provider === FAS_PROVIDER), JSON.stringify(candidates));
  ok("real providers remain discoverable",
    candidates.some((c) => c.provider === "pteam" && c.id === "good"));
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
