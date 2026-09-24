/**
 * FAS PI SKILLS SUITE (Phase 2A)
 * (durable: ~/fas-verify/tests/)
 *
 * Proves minimal progressive-disclosure Skills for declarative FAS policy:
 *   A1. Pi discovers exactly the minimum set (2): fas-evidence-conventions,
 *       fas-routing-policy — zero loader diagnostics.
 *   A2. Progressive disclosure: prompt carries metadata only; body text loads
 *       on demand (distinctive body lines absent from formatted prompt).
 *   A3. Measured leverage: body bytes >> metadata bytes (reported numbers).
 *   A4. Declarative-only guard: bodies contain no executable routing/fallback
 *       logic markers (scoreCandidate/planFallback/decideThinking/function().
 *   A5. Valid Agent-Skills names/descriptions (loader-enforced).
 *
 * TDD baseline: A1 FAILS on current env (no ~/.pi/agent/skills/ dir).
 * NOTE: FAS injects zero policy text into prompts today (verified in
 * fas/index.ts: provider + streamSimple only), so the measured win is
 * avoided-future-prompt-cost, not removed bytes — reported honestly.
 */
"use strict";
import * as path from "node:path";
import * as fs from "node:fs";

const HOME = process.env.HOME ?? "/data/data/com.termux/files/home";
const PI_DIST = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const skills = await import(path.join(PI_DIST, "dist/core/skills.js"));

const SKILLS_DIR = path.join(HOME, ".pi/agent/skills");
const EXPECTED = ["fas-evidence-conventions", "fas-routing-policy"];

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`ok: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}`); }
}

console.log("A1. discovery: minimum set only");
const loaded = skills.loadSkillsFromDir({ dir: SKILLS_DIR, source: "user" });
const names = (loaded.skills ?? []).map((s) => s.name).sort();
ok("exactly 2 fas skills", JSON.stringify(names) === JSON.stringify(EXPECTED));
ok("zero diagnostics", (loaded.diagnostics ?? []).length === 0);

console.log("A2. progressive disclosure");
const prompt = skills.formatSkillsForPrompt(loaded.skills ?? []);
for (const n of EXPECTED) ok(`metadata lists ${n}`, prompt.includes(n));
const bodies = EXPECTED.map((n) =>
  fs.readFileSync(path.join(SKILLS_DIR, n, "SKILL.md"), "utf8"));
const markers = ["\"files_modified\"", "consecutiveFailures", "needsReasoning"];
for (const m of markers) ok(`body-only marker not in prompt: ${m}`, !prompt.includes(m));

console.log("A3. measured leverage");
const metaBytes = Buffer.byteLength(prompt, "utf8");
const bodyBytes = bodies.reduce((a, b) => a + Buffer.byteLength(b, "utf8"), 0);
console.log(`META-BYTES=${metaBytes} BODY-BYTES=${bodyBytes} RATIO=${(bodyBytes / metaBytes).toFixed(2)}x`);
ok("deferred body exceeds always-on metadata", bodyBytes > metaBytes);

console.log("A4. declarative-only");
const FORBIDDEN = ["scoreCandidate", "planFallback", "decideThinking", "rankCandidates", "function ", "=>"];
for (const [i, b] of bodies.entries())
  for (const f of FORBIDDEN) ok(`${EXPECTED[i]} has no "${f}"`, !b.includes(f));

console.log("A5. names/descriptions valid");
for (const s of loaded.skills ?? []) {
  ok(`${s.name} name valid`, /^[a-z0-9-]+$/.test(s.name));
  ok(`${s.name} description non-empty`, typeof s.description === "string" && s.description.trim().length > 0);
}

console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
