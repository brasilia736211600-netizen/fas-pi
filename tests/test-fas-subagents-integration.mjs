/**
 * FAS ↔ SUBAGENTS INTEGRATION REGRESSION SUITE
 * (durable: ~/fas-verify/tests/)
 *
 * Proves:
 *   T1. When FAS is active (parent model = fas-router/auto), child
 *       processes spawned via spawn_agent/delegate/broker-reload must load
 *       the FAS extension (-e fas path in child argv) so that the
 *       inherited "--model fas-router/auto" resolves in the child and the
 *       child is routed through FAS (independent per-process context).
 *       TODAY: extensionSourcesForSpawn() collects ONLY tool-providing
 *       extensions; FAS registers no tools → child never loads FAS →
 *       "--model fas-router/auto" is unresolvable in the child and it
 *       silently falls back to an arbitrary static model (FAS bypass).
 *   T2. FAS inactive → child extension paths unchanged (existing behavior
 *       preserved; explicit model selection untouched).
 *   T3. FAS active but command discovery fails (defensive) → graceful,
 *       no throw, no FAS path added (falls back to today's behavior).
 *   T4. FAS path discovered via command registry is deduplicated against
 *       tool-derived paths.
 *   T5. Nested-routing safety: real fasCore.discoverCandidates() excludes
 *       fas-router/auto from its own candidate pool → a child FAS instance
 *       can never re-route through fas-router/auto (no self-recursion).
 *   T6. Explicit model selection is preserved: with a user-selected
 *       non-FAS model, child tool inheritance and paths are untouched.
 *
 * TDD baseline: T1 FAILS on current source (FAS path absent from child -e).
 * Fix: extensionSourcesForSpawn() appends the FAS extension path (discovered
 * via pi.getCommands() → "fas-router:on" sourceInfo.path) when the parent's
 * model is fas-router/auto.
 */
"use strict";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as fs from "node:fs";
import { existsSync, realpathSync } from "node:fs";

const require_ = createRequire(import.meta.url);
const PI = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const HOME = process.env.HOME ?? "/data/data/com.termux/files/home";
const { createJiti } = require_(path.join(PI, "node_modules/jiti/lib/jiti.cjs"));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
  alias: { "@earendil-works/pi-ai": path.join(PI, "node_modules/@earendil-works/pi-ai/dist/compat.js") },
});
const toolList = await jiti.import(path.join(HOME, ".pi/pi-enhanced/extensions/subagents/runtime/tool-list.ts"));
const fasCore = await jiti.import(path.join(HOME, ".pi/extensions/fas/core.ts"));

const FAS_PROVIDER = fasCore.FAS_PROVIDER;
const FAS_MODEL_ID = fasCore.FAS_MODEL_ID;

// Real on-disk paths (required: extensionSourcesForSpawn resolves + existsSync).
const SUBAGENTS_INDEX = realpathSync(path.join(HOME, ".pi/pi-enhanced/extensions/subagents/index.ts"));
const FAS_INDEX = realpathSync(path.join(HOME, ".pi/extensions/fas/index.ts"));
const COMPOSE_INDEX = realpathSync(path.join(HOME, ".pi/extensions/compose/index.ts"));
if (!existsSync(FAS_INDEX) || !existsSync(COMPOSE_INDEX)) {
  console.error("FATAL: fixture extension paths missing");
  process.exit(2);
}

let passed = 0, failed = 0;
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}

/** Minimal SubagentRuntimeState fixture used by extensionSourcesForSpawn(). */
function makeState(model, { fasCommands = true, activeToolNames = ["compose_probe", "read"], getAllToolsOverride } = {}) {
  const tools = [
    { name: "compose_probe", sourceInfo: { source: "local", path: COMPOSE_INDEX } },
    { name: "read", sourceInfo: { source: "builtin" } },
  ];
  const pi = {
    getActiveTools: () => [...activeToolNames],
    getAllTools: () => getAllToolsOverride ?? tools,
    getCommands: () => {
      if (!fasCommands) return [];
      return [
        { name: "fas-router:on", description: "Activate FAS", source: "extension", sourceInfo: { source: "local", path: FAS_INDEX } },
        { name: "fas-router:status", description: "FAS status", source: "extension", sourceInfo: { source: "local", path: FAS_INDEX } },
      ];
    },
  };
  return {
    pi,
    extensionPath: SUBAGENTS_INDEX,
    currentDepth: 0,
    settings: { allowChildSubagents: true, maxDepth: 3 },
    latestCtx: model ? { model: { provider: model.provider, id: model.id } } : undefined,
  };
}

console.log("T1. FAS active → child -e paths must include the FAS extension");
{
  const s = makeState({ provider: FAS_PROVIDER, id: FAS_MODEL_ID });
  const paths = toolList.extensionSourcesForSpawn(s).paths;
  ok("FAS path present in child extension sources",
    paths.includes(FAS_INDEX),
    `paths=${JSON.stringify(paths)}`);
}

console.log("T2. FAS inactive → paths unchanged (no FAS path)");
{
  const s = makeState({ provider: "qwen", id: "qwen3-coder" });
  const paths = toolList.extensionSourcesForSpawn(s).paths;
  ok("no FAS path when model is not fas-router/auto",
    !paths.includes(FAS_INDEX) && !paths.some((p) => p.includes("extensions/fas")),
    `paths=${JSON.stringify(paths)}`);
  ok("compose tool path still resolved", paths.includes(COMPOSE_INDEX));
  ok("builtin tools excluded", !paths.includes("read"));
}

console.log("T3. FAS active + command discovery fails → graceful (no throw)");
{
  const s = makeState({ provider: FAS_PROVIDER, id: FAS_MODEL_ID }, { fasCommands: false });
  let threw = false, paths = [];
  try {
    paths = toolList.extensionSourcesForSpawn(s).paths;
  } catch (e) { threw = true; }
  ok("no throw", !threw);
  ok("no FAS path (defensive fallback = today's behavior)", !paths.includes(FAS_INDEX));
}

console.log("T4. FAS path deduplicated against tool-derived paths");
{
  const s = makeState({ provider: FAS_PROVIDER, id: FAS_MODEL_ID }, {
    activeToolNames: ["fas_tool_probe"],
    getAllToolsOverride: [
      { name: "fas_tool_probe", sourceInfo: { source: "local", path: FAS_INDEX } },
    ],
  });
  const paths = toolList.extensionSourcesForSpawn(s).paths;
  ok("FAS path appears exactly once", paths.filter((p) => p === FAS_INDEX).length === 1,
    `paths=${JSON.stringify(paths)}`);
}

console.log("T5. Nested-routing safety: discoverCandidates excludes fas-router/auto itself");
{
  const pool = [
    { provider: FAS_PROVIDER, id: FAS_MODEL_ID },
    { provider: "pteam", id: "good", api: "openai-completions", authConfigured: true },
    { provider: "pteam", id: "other" },
  ];
  const candidates = fasCore.discoverCandidates(pool, pool);
  ok("fas-router/auto is never a FAS candidate (no self-recursion)",
    !candidates.some((c) => c.provider === FAS_PROVIDER),
    JSON.stringify(candidates));
  ok("real providers remain discoverable",
    candidates.some((c) => c.provider === "pteam" && c.id === "good"));
}

console.log("T6. Explicit model selection preserved (non-FAS) → child tools unchanged");
{
  const s = makeState({ provider: "qwen", id: "qwen3-coder" });
  const out = toolList.extensionSourcesForSpawn(s);
  ok("active tools inherited (minus collab tools)", out.childTools.includes("compose_probe"));
  ok("spawn_agent granted to child at depth 1", out.childTools.includes("spawn_agent"));
  ok("fatalOmittedTools empty", out.fatalOmittedTools.length === 0,
    `fatal=${JSON.stringify(out.fatalOmittedTools)}`);
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);