/**
 * FAS AUTOPILOT CHECKPOINT SAFETY SUITE (Queue 2 audit finding)
 * (durable: ~/fas-verify/tests/)
 *
 * Finding (VERIFIED source read): autopilot checkpointIfRepo() ran
 * `git add -A` — auto-committing UNTRACKED files (the usual secret carriers:
 * .env, key files,ほか) into the user's git history without review.
 * Fix: stage tracked modifications only (`git add -u`); untracked files stay
 * for human review. Beweis via fixture repo, no model, no network.
 *   G1. checkpointIfRepo is importable (exported for testability).
 *   G2. Tracked modification IS checkpointed (feature preserved).
 *   G3. Untracked .env-style file is NOT committed (the fix).
 *   G4. Non-repo dir is a safe no-op (existing behavior preserved).
 *
 * TDD baseline: G1 FAILS on current source (not exported).
 */
"use strict";
import { createRequire } from "node:module";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";

const require_ = createRequire(import.meta.url);
const HOME = process.env.HOME ?? "/data/data/com.termux/files/home";
const PI_DIST = "/data/data/com.termux/files/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const { createJiti } = require_(path.join(PI_DIST, "node_modules/jiti/lib/jiti.cjs"));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
  alias: { "@earendil-works/pi-ai": path.join(PI_DIST, "node_modules/@earendil-works/pi-ai/dist/compat.js") },
});
const autopilot = await jiti.import(path.join(HOME, ".pi/agent/extensions/autopilot/index.ts"));

let passed = 0, failed = 0;
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`ok: ${name}`); }
  else { failed++; console.log(`FAIL: ${name} ${detail}`); }
}
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: "ignore", timeout: 15000 });

console.log("G1. importable");
ok("checkpointIfRepo exported", typeof autopilot.checkpointIfRepo === "function");

console.log("G2+G3. fixture repo");
const dir = fs.mkdtempSync(path.join(HOME, "apfix-"));
try {
  sh("git init -q . && git config user.email t@t && git config user.name t", dir);
  fs.writeFileSync(path.join(dir, "tracked.txt"), "v1");
  sh("git add tracked.txt && git commit -qm init", dir);
  fs.writeFileSync(path.join(dir, "tracked.txt"), "v2-work");
  fs.writeFileSync(path.join(dir, ".env"), "OPENROUTER_API_KEY=sk-or-v1-SECRET");
  autopilot.checkpointIfRepo({ cwd: dir }, 1);
  const files = execSync("git ls-files", { cwd: dir, encoding: "utf8" });
  const log = execSync("git log --oneline", { cwd: dir, encoding: "utf8" });
  ok("tracked work checkpointed", log.includes("autopilot checkpoint r1"));
  ok("untracked .env NOT committed", !files.includes(".env"));
  ok(".env still on disk for review", fs.existsSync(path.join(dir, ".env")));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("G4. non-repo no-op");
{
  const dir2 = fs.mkdtempSync(path.join(HOME, "apfix-"));
  try {
    autopilot.checkpointIfRepo({ cwd: dir2 }, 1);
    ok("no throw outside repo", true);
  } catch { ok("no throw outside repo", false); }
  finally { fs.rmSync(dir2, { recursive: true, force: true }); }
}

console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
