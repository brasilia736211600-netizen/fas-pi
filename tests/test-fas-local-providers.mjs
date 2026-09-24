/**
 * FAS LOCAL-PROVIDER DISCOVERY SUITE (Phase 2D)
 * (durable: ~/fas-verify/tests/)
 *
 * Proves discovery-first local-provider probing to the extent the environment
 * supports (no local daemon here — live verification BLOCKED, never fabricated):
 *   D1. Unavailable endpoints (refused/timeout) → [] (pool unchanged), no throw.
 *   D2. Ollama + LM-Studio response dialects parsed to registry-shape candidates.
 *   D3. Malformed/unknown-dialect payloads skipped, others kept.
 *   D4. Capability validation: accepts well-formed local candidates, rejects
 *       empty ids / unknown providers; quality stays UNKNOWN (never assumed).
 *   D5. Mock-fetch injection only — zero real network in tests.
 *
 * TDD baseline: D1 FAILS on current source (fas/local-providers.ts absent).
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
  alias: { "@earendil-works/pi-ai": path.join(PI_DIST, "node_modules/@earendil-works/pi-ai/dist/compat.js") },
});
const local = await jiti.import(path.join(HOME, ".pi/extensions/fas/local-providers.ts"));

let passed = 0, failed = 0;
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`ok: ${name}`); }
  else { failed++; console.log(`FAIL: ${name} ${detail}`); }
}
const refusal = () => { throw new Error("ECONNREFUSED"); };
const json = (obj) => async () => ({ ok: true, json: async () => obj, text: async () => JSON.stringify(obj) });
const EPS = [
  { name: "ollama", url: "http://127.0.0.1:11434/api/tags" },
  { name: "lm-studio", url: "http://127.0.0.1:1234/v1/models" },
];

console.log("D1. unavailable → []");
{
  const r = await local.probeLocalProviders({ fetchFn: refusal, endpoints: EPS, timeoutMs: 50 });
  ok("empty array, no throw", Array.isArray(r) && r.length === 0);
}

console.log("D2. dialects parsed");
{
  const fetchFn = async (url) =>
    url.includes("11434")
      ? json({ models: [{ name: "llama3.1:8b" }, { name: "qwen2.5:7b" }] })()
      : json({ data: [{ id: "local-model" }] })();
  const r = await local.probeLocalProviders({ fetchFn, endpoints: EPS, timeoutMs: 500 });
  ok("3 candidates", r.length === 3);
  ok("ollama shaped", r.some((c) => c.provider === "ollama" && c.id === "llama3.1:8b" && c.local === true));
  ok("lm-studio shaped", r.some((c) => c.provider === "lmstudio" && c.id === "local-model" && c.local === true));
}

console.log("D3. malformed skipped, others kept");
{
  const fetchFn = async (url) =>
    url.includes("11434") ? json({ garbage: true })() : json({ data: [{ id: "m" }] })();
  const r = await local.probeLocalProviders({ fetchFn, endpoints: EPS, timeoutMs: 500 });
  ok("only valid kept", r.length === 1 && r[0].id === "m");
  const fetchFn2 = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" });
  ok("http-error → []", (await local.probeLocalProviders({ fetchFn: fetchFn2, endpoints: EPS, timeoutMs: 500 })).length === 0);
}

console.log("D4. capability validation");
{
  ok("accepts good", local.validateLocalCandidate({ provider: "ollama", id: "x", local: true }).valid === true);
  ok("rejects empty id", local.validateLocalCandidate({ provider: "ollama", id: "  " }).valid === false);
  ok("rejects unknown provider", local.validateLocalCandidate({ provider: "cloudx", id: "x" }).valid === false);
  ok("quality unknown", local.validateLocalCandidate({ provider: "lmstudio", id: "x", local: true }).quality === "unknown");
}

console.log("D5. no real network");
{
  let called = [];
  const fetchFn = async (url, opts) => { called.push(String(url)); throw new Error("net-off"); };
  await local.probeLocalProviders({ fetchFn, endpoints: EPS, timeoutMs: 50 });
  ok("only loopback probed", called.length === 2 && called.every((u) => u.includes("127.0.0.1")));
}

console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
