/**
 * COMPOSE RELEASE SUITE (durable: ~/fas-verify/tests/) — derived from the
 * CURRENT implementation (compose/index.ts, 2658 B) + real pi-tui behavior.
 * Read-only: never modifies the compose extension.
 *
 * Covers: key matching (real matchesKey) · command registration ·
 * custom(overlay) invocation · exactly-once send · empty/cancel notify ·
 * factory wiring with stub tui (Enter→newline, Ctrl+Enter→submit,
 * Esc/Ctrl+C→cancel, disableSubmit).
 */
"use strict";
import { createRequire } from "node:module";
import * as path from "node:path";

const require_ = createRequire(import.meta.url);
const PI = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const TUIPATH = PI + "/node_modules/@earendil-works/pi-tui/dist/index.js";
const { createJiti } = require_(path.join(PI, "node_modules/jiti/lib/jiti.cjs"));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
  alias: { "@earendil-works/pi-tui": TUIPATH },
});
const composeMod = await jiti.import("/data/data/com.termux/files/home/.pi/extensions/compose/index.ts");
const tui = await import(TUIPATH);
const { matchesKey, Editor } = tui;

let passed = 0, failed = 0;
const failures = [];
function assert(c, msg) { if (c) passed++; else { failed++; failures.push(msg); console.error(`  FAIL: ${msg}`); } }
async function runTest(name, fn) {
  console.log(`\n--- ${name} ---`);
  try { await fn(); } catch (e) { failed++; failures.push(`${name}: ${e.message}`); console.error(`  FAIL: ${e.message}`); }
}

// K1: real key matching for every id compose uses
async function K1() {
  assert(matchesKey("\r", "enter") === true, "enter: CR matches");
  assert(matchesKey("\n", "enter") === true, "enter: LF matches (legacy)");
  assert(matchesKey("x", "enter") === false, "enter: text does not match");
  assert(matchesKey("\x1b[27;5;13~", "ctrl+enter") === true, "ctrl+enter: modifyOtherKeys matches");
  assert(matchesKey("\r", "ctrl+enter") === false, "ctrl+enter: plain CR does not match");
  assert(matchesKey("\x1b", "escape") === true, "escape matches");
  assert(matchesKey("\x03", "ctrl+c") === true, "ctrl+c matches");
  assert(matchesKey("\x03", "enter") === false, "ctrl+c is not enter");
}

// K2: command registration + custom(overlay) + send semantics
async function K2() {
  const sent = [];
  const notified = [];
  let captured = null;
  const pi = {
    commands: [],
    registerCommand(name, opts) { this.commands.push({ name, ...opts }); },
    async sendUserMessage(text) { sent.push(text); return true; },
    on() {},
  };
  composeMod.default(pi);
  const cmd = pi.commands.find((c) => c.name === "compose");
  assert(!!cmd, "compose command registered");
  const mkCtx = (resolveWith) => ({
    ui: {
      custom: async (factory, opts) => { captured = { factory, opts }; return resolveWith; },
      notify: (msg) => notified.push(msg),
    },
  });
  await cmd.handler("", mkCtx("hello world"));
  assert(captured && captured.opts && captured.opts.overlay === true, "custom invoked with overlay:true");
  assert(sent.length === 1 && sent[0] === "hello world", "non-empty text sent exactly once");
  sent.length = 0;
  await cmd.handler("", mkCtx(undefined));
  assert(sent.length === 0 && notified.length === 1, "cancel → notify, nothing sent");
  await cmd.handler("", mkCtx("   "));
  assert(sent.length === 0 && notified.length === 2, "whitespace-only → notify, nothing sent");
}

// K3: factory wiring with stub tui (no terminal needed)
async function K3() {
  const sent = [];
  const pi = {
    commands: [],
    registerCommand(name, opts) { this.commands.push({ name, ...opts }); },
    async sendUserMessage(text) { sent.push(text); return true; },
    on() {},
  };
  composeMod.default(pi);
  const cmd = pi.commands.find((c) => c.name === "compose");
  let doneArg = "unset";
  let factory = null;
  const ctx = {
    ui: {
      custom: async (f) => { factory = f; return new Promise((resolve) => { f.__done = (v) => { doneArg = v; resolve(v); }; }); },
      notify: () => {},
    },
  };
  const pending = cmd.handler("", ctx);
  assert(typeof factory === "function", "factory passed to custom");
  const stubTui = { requestRender() {}, on() {}, off() {}, columns: 80, rows: 24 };
  const theme = { borderColor: "x" };
  const editor = factory(stubTui, theme, {}, factory.__done);
  assert(editor.disableSubmit === true, "disableSubmit set (Enter=newline)");
  editor.handleInput("\r");
  const afterEnter = editor.getText();
  assert(afterEnter.includes("\n"), `Enter inserts newline (got ${JSON.stringify(afterEnter)})`);
  assert(doneArg === "unset", "Enter does not submit");
  editor.handleInput("\x1b");
  const submitted = await pending;
  assert(doneArg === undefined, "Esc cancels via done(undefined)");
  assert(submitted === undefined, "handler resolves undefined on cancel");
  // fresh instance: Ctrl+Enter submits
  let done2 = "unset";
  const ctx2 = { ui: { custom: async (f) => { factory = f; return new Promise((resolve) => { f.__done2 = (v) => { done2 = v; resolve(v); }; }); }, }, notify: () => {} };
  const pending2 = cmd.handler("", ctx2);
  const editor2 = factory(stubTui, theme, {}, factory.__done2);
  editor2.handleInput("h");
  editor2.handleInput("\x1b[27;5;13~");
  const out2 = await pending2;
  assert(typeof done2 === "string" && done2.includes("h"), `Ctrl+Enter submits composed text (got ${JSON.stringify(done2)})`);
  assert(sent.length === 1 && sent[0] === done2, "submitted text sent exactly once via sendUserMessage");
  void out2;
}

await runTest("K1. real key matching", K1);
await runTest("K2. registration + send semantics", K2);
await runTest("K3. factory wiring (stub tui)", K3);

console.log(`\n=== Compose Release Suite ===`);
console.log(`Passed: ${passed}/${passed + failed}`);
if (failed) { console.error(`Failed: ${failed}`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log("ALL COMPOSE RELEASE TESTS PASSED");
