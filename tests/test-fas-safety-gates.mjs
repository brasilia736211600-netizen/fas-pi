/**
 * FAS SAFETY GATES SUITE (Phase 2F)
 * (durable: ~/fas-verify/tests/)
 *
 * Proves minimal deterministic safety gates (no second permission framework,
 * no interactive approval loop, no in-execution veto — Pi 0.85.1 tool events
 * are observational only, VERIFIED in ExtensionAPI types):
 *   F1. scanTaskText() flags destructive git ops (reset --hard, clean -fd*,
 *       push --force/-f) mirroring proven fas_git.py FORBIDDEN list; legit
 *       git verbs pass.
 *   F2. scanTaskText() flags absolute paths outside cwd + parent escapes;
 *       relative/in-cwd paths pass. Never throws (null-safe).
 *   F3. runPhase() denies gated tasks with a "safety gate" phase failure
 *       BEFORE spawning (no child argv produced); clean tasks unaffected.
 *   F4. redact() kills credential-shaped VALUES (sk-or-v1-, sk-ant-, ghp_)
 *       even under neutral keys; numeric telemetry + normal strings survive.
 *
 * TDD baseline: F1 FAILS on current source (workflow/safety.ts absent).
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
const safety = await jiti.import(path.join(HOME, ".pi/pi-enhanced/extensions/workflow/safety.ts"));
const fasCore = await jiti.import(path.join(HOME, ".pi/extensions/fas/core.ts"));

let passed = 0, failed = 0;
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`ok: ${name}`); }
  else { failed++; console.log(`FAIL: ${name} ${detail}`); }
}
const CWD = "/data/repo";

console.log("F1. destructive git scan");
{
  const bad = [
    "please git reset --hard HEAD to clean up",
    "run git clean -fdx now",
    "git push --force origin main",
    "git push -f origin main",
  ];
  for (const t of bad) {
    const v = safety.scanTaskText(t, CWD);
    ok(`flags: ${t.slice(0, 30)}`, v.length > 0 && v[0].rule === "forbidden-git-op");
  }
  for (const t of ["git push origin main", "git status --porcelain", "commit the changes"]) {
    ok(`passes: ${t}`, safety.scanTaskText(t, CWD).length === 0);
  }
}

console.log("F2. scope scan + null-safety");
{
  ok("outside absolute flagged", safety.scanTaskText("read /etc/passwd", CWD).some((v) => v.rule === "outside-scope"));
  ok("parent escape flagged", safety.scanTaskText("open ../secret.txt", CWD).some((v) => v.rule === "outside-scope"));
  ok("relative passes", safety.scanTaskText("read src/a.ts", CWD).length === 0);
  ok("in-cwd absolute passes", safety.scanTaskText(`read ${CWD}/src/a.ts`, CWD).length === 0);
  ok("null-safe", Array.isArray(safety.scanTaskText(null, CWD)) && safety.scanTaskText(undefined, CWD).length === 0);
}

console.log("F3. runPhase gate");
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
function harness() {
  const pi = {
    appendEntry() {}, sendMessage() {},
    getThinkingLevel: () => "off",
    getActiveTools: () => ["read", "bash"],
    getCommands: () => [],
  };
  const runner = new runnerMod.WorkflowRunner(pi, {}, {
    getInvocation: (args) => ({ command: "fake-pi", args }),
    createClient: () => new FakeClient(),
    writeSystemPrompt: () => {},
  });
  const ctx = {
    cwd: CWD, mode: "tui", hasUI: true, model: undefined,
    isProjectTrusted: () => false,
    sessionManager: { getSessionFile: () => "/tmp/parent.jsonl", getBranch: () => [], getEntries: () => [] },
    ui: { setStatus() {}, setWidget() {}, notify() {}, appendEntry() {} },
  };
  const workflow = schemaMod.validateWorkflow({ phases: [{ id: "run", prompt: "Do {{input}}" }] }, "/tmp/test.yaml", "global");
  return { runner, ctx, workflow };
}
{
  const h = harness();
  const state = await h.runner.run({ workflow: h.workflow, input: "please git reset --hard HEAD", ctx: h.ctx, displayPanel: false });
  ok("gated task fails", state.status === "failed");
  ok("gate error names rule", JSON.stringify(state).includes("safety gate"));
  const h2 = harness();
  const okState = await h2.runner.run({ workflow: h2.workflow, input: "list the files", ctx: h2.ctx, displayPanel: false });
  ok("clean task succeeds", okState.status === "succeeded");
}

console.log("F4. value-shape redaction");
{
  ok("sk-or-v1 redacted", fasCore.redact({ k: "sk-or-v1-abc123XYZ4567890abcdef" })["k"] === "[REDACTED]");
  ok("sk-ant redacted", fasCore.redact({ k: "sk-ant-api03-abc123XYZ456" })["k"] === "[REDACTED]");
  ok("ghp redacted", fasCore.redact({ k: "ghp_abc123XYZ4567890abcdef12" })["k"] === "[REDACTED]");
  ok("telemetry survives", fasCore.redact({ tokens: 123, ok: true })["tokens"] === 123);
  ok("normal string survives", fasCore.redact({ note: "hello world" })["note"] === "hello world");
}

console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
