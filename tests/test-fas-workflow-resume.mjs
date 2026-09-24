/**
 * FAS WORKFLOW RESUME-FROM-PHASE SUITE (Phase 2E)
 * (durable: ~/fas-verify/tests/)
 *
 * Proves minimal resume using persisted snapshots (no leases/journaling):
 *   E1. computeResumePoint(): skips leading terminal-succeeded phases, starts
 *       at first non-success (failed/pending/running/interrupted/aborted);
 *       all-succeeded → startId null.
 *   E2. extractResumeOutputs(): only succeeded phases included, structured
 *       output preserved.
 *   E3. Live resume: 2-phase workflow, phase-2 marked failed post-success
 *       (simulated kill-mid-phase) → resume spawns ONLY phase 2
 *       (createClient count), reuses phase-1 output, identical final report.
 *   E4. Running/interrupted snapshot phases restart (never skipped).
 *   E5. restore(): version-mismatched snapshots ignored; current-version
 *       snapshots restored (existing behavior, now locked).
 *
 * TDD baseline: E1 FAILS on current source (workflow/resume.ts absent).
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
  alias: {
    "@earendil-works/pi-ai": path.join(PI_DIST, "node_modules/@earendil-works/pi-ai/dist/compat.js"),
    "@earendil-works/pi-coding-agent": path.join(PI_DIST, "dist/index.js"),
  },
});
const runnerMod = await jiti.import(path.join(HOME, ".pi/pi-enhanced/extensions/workflow/runner.ts"));
const schemaMod = await jiti.import(path.join(HOME, ".pi/pi-enhanced/extensions/workflow/schema.ts"));
const resumeMod = await jiti.import(path.join(HOME, ".pi/pi-enhanced/extensions/workflow/resume.ts"));

let passed = 0, failed = 0;
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`ok: ${name}`); }
  else { failed++; console.log(`FAIL: ${name} ${detail}`); }
}

console.log("E1. computeResumePoint");
{
  const rp = resumeMod.computeResumePoint;
  ok("empty → null start", rp([]).startId === null);
  ok("all succeeded → null", rp([{ id: "a", status: "succeeded" }, { id: "b", status: "succeeded" }]).startId === null);
  let r = rp([{ id: "a", status: "succeeded" }, { id: "b", status: "failed" }, { id: "c", status: "pending" }]);
  ok("starts at first failure", r.startId === "b" && JSON.stringify(r.skippedIds) === '["a"]');
  for (const s of ["running", "interrupted", "aborted", "pending"]) {
    const r2 = rp([{ id: "a", status: "succeeded" }, { id: "b", status: s }]);
    ok(`${s} restarts`, r2.startId === "b");
  }
  ok("first failed → no skips", rp([{ id: "a", status: "failed" }]).skippedIds.length === 0);
}

console.log("E2. extractResumeOutputs");
{
  const st = { runId: "r1", phases: [
    { id: "a", status: "succeeded", output: "OUT-A", structuredOutput: { status: "PASS", report: "r" } },
    { id: "b", status: "failed", output: "OUT-B" },
  ] };
  const { outputs, point } = resumeMod.extractResumeOutputs(st);
  ok("only succeeded extracted", outputs.size === 1 && outputs.get("a").output === "OUT-A");
  ok("structured preserved", outputs.get("a").structured && outputs.get("a").structured.status === "PASS");
  ok("point starts at b", point.startId === "b");
}

console.log("E3+E4. live resume (spawn counting)");
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
  async abort() {}
  async stop() {}
}
function harness(spawns) {
  const pi = {
    appendEntry() {}, sendMessage() {},
    getThinkingLevel: () => "off",
    getActiveTools: () => ["read"],
    getCommands: () => [],
  };
  const runner = new runnerMod.WorkflowRunner(pi, {}, {
    getInvocation: (args) => ({ command: "fake-pi", args }),
    createClient: () => { spawns.count++; return new FakeClient(); },
    writeSystemPrompt: () => {},
  });
  const ctx = {
    cwd: "/data/repo", mode: "tui", hasUI: true, model: undefined,
    isProjectTrusted: () => false,
    sessionManager: { getSessionFile: () => "/tmp/parent.jsonl", getBranch: () => [], getEntries: () => [] },
    ui: { setStatus() {}, setWidget() {}, notify() {}, appendEntry() {} },
  };
  const workflow = schemaMod.validateWorkflow({ phases: [
    { id: "one", prompt: "First {{input}}" },
    { id: "two", prompt: "Second {{input}}" },
  ] }, "/tmp/test.yaml", "global");
  return { runner, ctx, workflow };
}
{
  const s1 = harness({ count: 0 });
  const st1 = await s1.runner.run({ workflow: s1.workflow, input: "go", ctx: s1.ctx, displayPanel: false });
  ok("baseline run succeeds", st1.status === "succeeded");
  // Simulate kill-mid-phase: corrupt phase two to failed in a copy of the state.
  const snap = JSON.parse(JSON.stringify({ runId: st1.runId, phases: st1.phases }));
  const p2 = snap.phases.find((p) => p.id === "two");
  p2.status = "failed"; p2.output = undefined;
  const { outputs } = resumeMod.extractResumeOutputs(snap);
  const spawns = { count: 0 };
  const s2 = harness(spawns);
  const st2 = await s2.runner.run({ workflow: s2.workflow, input: "go", ctx: s2.ctx, displayPanel: false, resume: { outputs } });
  ok("resume spawns only missing phase", spawns.count === 1);
  ok("resume succeeds", st2.status === "succeeded");
  ok("phase one reused (no respawn log)", st2.phases.find((p) => p.id === "one").logs.some((l) => l.text.includes("Resumed")));
  ok("identical final report", st2.report === st1.report);
}

console.log("E5. restore version gate");
{
  const pi = { appendEntry() {}, sendMessage() {}, getThinkingLevel: () => "off", getActiveTools: () => [] };
  const runner = new runnerMod.WorkflowRunner(pi, {}, {});
  const good = { version: 1, state: { runId: "x", phases: [] } };
  const bad = { version: 999, state: { runId: "y", phases: [] } };
  const ctx = { sessionManager: { getBranch: () => [
    { type: "custom", customType: "workflow-run-state", data: bad },
  ] } };
  runner.restore(ctx);
  ok("mismatched version ignored", runner.runStates.size === 0);
  const ctx2 = { sessionManager: { getBranch: () => [
    { type: "custom", customType: "workflow-run-state", data: good },
  ] } };
  runner.restore(ctx2);
  ok("current version restored", runner.runStates.size === 1);
}

console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
