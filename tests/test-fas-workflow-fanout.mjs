/**
 * FAS WORKFLOW FAN-OUT/FAN-IN SUITE (parallel-work feature)
 * (durable: ~/fas-verify/tests/)
 *
 * Proves bounded parallel phase execution (the missing pi-FAS parallel-work
 * primitive; workflow was strictly sequential, FAS fallback is sequential by
 * output-stream safety, subagents guidance advisory-only):
 *   P1. Schema: fanout accepts id lists; rejects unknown/self/duplicate;
 *       rejects fanout+next on the same phase; rejects next/fanout on targets.
 *   P2. Overlap: forked phases truly overlap (rendezvous: neither completes
 *       until both started — sequential execution would time out and fail).
 *   P3. Join: all succeed → outputs merged, run continues AFTER the last
 *       target (targets never re-run), report contains all outputs.
 *   P4. Failure: one fork fails → run fails naming the phase; error surfaces.
 *   P5. No-fanout runs byte-identical (spawn count == phase count).
 *
 * TDD baseline: P1 FAILS on current source (fanout rejected as unknown field).
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

let passed = 0, failed = 0;
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`ok: ${name}`); }
  else { failed++; console.log(`FAIL: ${name} ${detail}`); }
}
const wf = (phases) => schemaMod.validateWorkflow({ phases }, "/tmp/test.yaml", "global");

console.log("P1. schema fanout validation");
{
  const good = wf([
    { id: "a", prompt: "A {{input}}", fanout: ["b", "c"] },
    { id: "b", prompt: "B" },
    { id: "c", prompt: "C" },
    { id: "d", prompt: "D" },
  ]);
  ok("accepts fanout list", good.phases[0].fanout.join() === "b,c");
  for (const [name, phases] of [
    ["unknown target", [{ id: "a", prompt: "A", fanout: ["zz"] }, { id: "b", prompt: "B" }]],
    ["self target", [{ id: "a", prompt: "A", fanout: ["a"] }, { id: "b", prompt: "B" }]],
    ["duplicate", [{ id: "a", prompt: "A", fanout: ["b", "b"] }, { id: "b", prompt: "B" }]],
    ["fanout+next", [{ id: "a", prompt: "A", fanout: ["b"], next: [{ end: true }] }, { id: "b", prompt: "B" }]],
    ["target with next", [{ id: "a", prompt: "A", fanout: ["b"] }, { id: "b", prompt: "B", next: [{ end: true }] }]],
  ]) {
    let threw = false;
    try { wf(phases); } catch { threw = true; }
    ok(`rejects ${name}`, threw);
  }
}

console.log("P2+P3+P4. live fan-out (FakeClient rendezvous)");
function harness(spawns, gate) {
  const pi = {
    appendEntry() {}, sendMessage() {},
    getThinkingLevel: () => "off",
    getActiveTools: () => ["read"],
    getCommands: () => [],
  };
  const runner = new runnerMod.WorkflowRunner(pi, {}, {
    getInvocation: (args) => ({ command: "fake-pi", args }),
    createClient: (_c, args) => {
      const m = /workflow:([^:]+):([^:]+):/.exec(args.join(" "));
      spawns.push(m ? m[2] : "?");
      return new GateClient(gate);
    },
    writeSystemPrompt: () => {},
  });
  const ctx = {
    cwd: "/data/repo", mode: "tui", hasUI: true, model: undefined,
    isProjectTrusted: () => false,
    sessionManager: { getSessionFile: () => "/tmp/parent.jsonl", getBranch: () => [], getEntries: () => [] },
    ui: { setStatus() {}, setWidget() {}, notify() {}, appendEntry() {} },
  };
  return { runner, ctx };
}
class GateClient {
  constructor(gate) { this.gate = gate; }
  onEvent;
  async request(command) {
    if (command.type === "prompt" || command.type === "steer") {
      if (this.gate) await this.gate.enter();
      if (this.gate && this.gate.failIds && this.gate.current) {
        const id = this.gate.current;
        if (this.gate.failIds.has(id)) return { success: false, error: `gatefail:${id}` };
      }
      return { success: true };
    }
    if (command.type === "get_messages") return { success: true, data: { messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" }] } };
    if (command.type === "get_state") return { success: true, data: { sessionFile: "/tmp/child.jsonl" } };
    return { success: true };
  }
  async waitForSettled() { this.onEvent?.({ type: "agent_settled" }); }
  getStderr() { return ""; }
  async abort() {}
  async stop() {}
}
{
  // Overlap proof: runPhase calls are concurrent iff both prompt-requests are
  // in flight simultaneously. Track via invocation order + pending count.
  const spawns = [];
  const inFlight = new Set();
  let maxInFlight = 0;
  const pi = {
    appendEntry() {}, sendMessage() {},
    getThinkingLevel: () => "off",
    getActiveTools: () => ["read"],
    getCommands: () => [],
  };
  class RendezClient {
    onEvent;
    async request(command) {
      if (command.type === "prompt" || command.type === "steer") {
        const token = Symbol();
        inFlight.add(token);
        maxInFlight = Math.max(maxInFlight, inFlight.size);
        for (let i = 0; i < 5000 && inFlight.size < 2; i++) await new Promise((r) => setImmediate(r));
        inFlight.delete(token);
        return { success: true };
      }
      if (command.type === "get_messages") return { success: true, data: { messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" }] } };
      if (command.type === "get_state") return { success: true, data: { sessionFile: "/tmp/child.jsonl" } };
      return { success: true };
    }
    async waitForSettled() { this.onEvent?.({ type: "agent_settled" }); }
    getStderr() { return ""; }
    async abort() {}
    async stop() {}
  }
  const runner = new runnerMod.WorkflowRunner(pi, {}, {
    getInvocation: (args) => ({ command: "fake-pi", args }),
    createClient: (_c, args) => {
      const m = /workflow:([^:]+):([^:]+):/.exec(args.join(" "));
      spawns.push(m ? m[2] : "?");
      return new RendezClient();
    },
    writeSystemPrompt: () => {},
  });
  const ctx = {
    cwd: "/data/repo", mode: "tui", hasUI: true, model: undefined,
    isProjectTrusted: () => false,
    sessionManager: { getSessionFile: () => "/tmp/parent.jsonl", getBranch: () => [], getEntries: () => [] },
    ui: { setStatus() {}, setWidget() {}, notify() {}, appendEntry() {} },
  };
  const workflow = wf([
    { id: "a", prompt: "A {{input}}", fanout: ["b", "c"] },
    { id: "b", prompt: "B" },
    { id: "c", prompt: "C" },
    { id: "d", prompt: "D {{input}}" },
  ]);
  const state = await runner.run({ workflow, input: "go", ctx, displayPanel: false });
  ok("overlap (max in-flight 2)", maxInFlight === 2);
  ok("run succeeds", state.status === "succeeded");
  ok("spawn order: a first, d last", spawns[0] === "a" && spawns[spawns.length - 1] === "d");
  ok("all four spawned once", spawns.length === 4 && new Set(spawns).size === 4);
  ok("report merges all outputs", state.report.includes("## b") && state.report.includes("## c") && state.report.includes("## d"));
}

console.log("P4. fan-out failure propagates");
{
  const spawns = [];
  const failIds = new Set(["c"]);
  const pi = {
    appendEntry() {}, sendMessage() {},
    getThinkingLevel: () => "off",
    getActiveTools: () => ["read"],
    getCommands: () => [],
  };
  const runner = new runnerMod.WorkflowRunner(pi, {}, {
    getInvocation: (args) => ({ command: "fake-pi", args }),
    createClient: (_c, args) => {
      const m = /workflow:([^:]+):([^:]+):/.exec(args.join(" "));
      const id = m ? m[2] : "?";
      spawns.push(id);
      const c = new GateClient(null);
      const orig = c.request.bind(c);
      c.request = async (command) => {
        if ((command.type === "prompt" || command.type === "steer") && failIds.has(id)) {
          throw new Error("gatefail:c");
        }
        return orig(command);
      };
      return c;
    },
    writeSystemPrompt: () => {},
  });
  const ctx = {
    cwd: "/data/repo", mode: "tui", hasUI: true, model: undefined,
    isProjectTrusted: () => false,
    sessionManager: { getSessionFile: () => "/tmp/parent.jsonl", getBranch: () => [], getEntries: () => [] },
    ui: { setStatus() {}, setWidget() {}, notify() {}, appendEntry() {} },
  };
  const workflow = wf([
    { id: "a", prompt: "A {{input}}", fanout: ["b", "c"] },
    { id: "b", prompt: "B" },
    { id: "c", prompt: "C" },
  ]);
  const state = await runner.run({ workflow, input: "go", ctx, displayPanel: false });
  ok("run fails", state.status === "failed");
  ok("both forks attempted", spawns.includes("b") && spawns.includes("c"));
}

console.log("P5. no-fanout unchanged");
{
  const spawns = [];
  const h = harness(spawns, null);
  const workflow = wf([{ id: "a", prompt: "A {{input}}" }, { id: "b", prompt: "B" }]);
  const state = await h.runner.run({ workflow, input: "go", ctx: h.ctx, displayPanel: false });
  ok("sequential still succeeds", state.status === "succeeded");
  ok("spawn count == phases", spawns.length === 2);
}

console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
