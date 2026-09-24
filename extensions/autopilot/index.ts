/**
 * /ap — Autopilot coding for pi
 *
 * Combines the two strongest autopilot methods:
 *   #1 Strong reasoning model + full tool loop (Devin/OpenHands pattern)
 *   #5 Test-driven self-repair loop (SWE-agent pattern)
 *
 * Usage:
 *   /ap <task>              — run the task end-to-end
 *   /ap --tests "pytest -q" — override the test command
 *
 * The test command is also picked from the AP_TEST env var, or auto-detected
 * from the project (npm test / pytest / go test / cargo test / make test / vitest / jest).
 *
 * Flow:
 *   1. Scan the live model catalog and pick the strongest available reasoning model.
 *   2. Enable every tool and crank thinking to max.
 *   3. Send the task, then repeatedly:
 *        wait for the agent to idle → run tests → if failing, steer the model
 *        with the failure output → repeat until tests pass or rounds run out.
 *   4. Git-checkpoint each round (when inside a repo) for safe iteration.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const MAX_ROUNDS = 8;

// Substrings matched against the live model ID to pick a strong reasoning
// model. Works regardless of `:free` suffixes or provider prefixes.
const REASONING_MODEL_HINTS = [
  "deepseek-v4-pro",
  "deepseek-v4.1-flash",
  "deepseek-v4-flash",
  "qwen3-coder",
  "qwen3.8-27b",
  "claude-sonnet-4-5",
  "claude-sonnet-4.5",
  "claude-sonnet-4",
  "gemma-4-31b",
  "gemma-4-26b",
  "glm-4.7",
  "glm-5.3",
  "glm-5.2",
  "nemotron-3-ultra",
  "nemotron-3.5",
  "kimi-k3",
  "kimi-k2.6",
  "laguna",
  "north-mini-code",
];

const TEST_CANDIDATES = [
  "npm test",
  "npx vitest run",
  "npx jest --silent",
  "pytest -q",
  "python -m pytest -q",
  "go test ./...",
  "cargo test",
  "make test",
  "dotnet test",
  "mix test",
];

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ap", {
    description:
      "Autopilot: reasoning model + tools + test-driven self-repair loop",
    handler: async (args, ctx) => {
      // ---- Parse args -------------------------------------------------------
      let task = "";
      let testCmd = process.env.AP_TEST || "";
      const rest = (args || "").trim();
      const testsFlag = rest.match(/--tests\s+"?([^"\s]+)/);
      if (testsFlag) {
        testCmd = testsFlag[1];
        task = rest.replace(testsFlag[0], "").trim();
      } else {
        task = rest;
      }

      if (!task) {
        ctx.ui.notify("/ap <task>  —  give the autopilot a coding task", "info");
        ctx.ui.notify(
          `Test command: ${testCmd || "(auto-detect)"}  ·  rounds: ${MAX_ROUNDS}`,
          "info",
        );
        return;
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify("Agent busy — wait or use /steer first", "warning");
        return;
      }

      // ---- Method #1 setup ---------------------------------------------------
      const picked = await setupReasoningModel(pi, ctx);
      enableAllTools(pi);
      // Only force max thinking when FAS is NOT active — FAS controls
      // thinking level dynamically via model_select/turn_end when active.
      const fasActive = ctx?.model?.provider === "fas-router" && ctx?.model?.id === "auto";
      if (!fasActive) {
        try {
          pi.setThinkingLevel("max");
        } catch {
          // non-reasoning models clamp to highest available — fine
        }
      }

      ctx.ui.setStatus("ap", "🛸 autopilot: " + short(task));
      ctx.ui.setWidget("ap", autopilotBanner(task, testCmd || "(auto)"));

      if (isGitRepo(ctx.cwd)) {
        ctx.ui.notify("Git repo detected — auto-checkpoint each round", "info");
      }

      // ---- Method #5 self-repair loop ----------------------------------------
      const resolvedTest = testCmd || detectTest(ctx.cwd);
      let lastFailure = "";
      let round = 0;
      let success = false;

      try {
        for (round = 1; round <= MAX_ROUNDS; round++) {
          ctx.ui.setStatus(
            "ap",
            `🛸 autopilot r${round}/${MAX_ROUNDS}: ${short(task)}`,
          );
          ctx.ui.setWidget("ap", roundBanner(round, MAX_ROUNDS, task, resolvedTest, lastFailure));

          // Kick / steer the model
          if (round === 1) {
            pi.sendUserMessage(task);
          } else {
            pi.sendUserMessage(
              `Previous run failed tests:\n\n${lastFailure}\n\nFix the failures and rerun the tests.\nTask: ${task}`,
              { deliverAs: "steer" },
            );
          }

          // Wait for the agent to finish its turn(s)
          await ctx.waitForIdle();

          // Run tests
          const result = runTests(resolvedTest, ctx.cwd);
          if (result.pass) {
            success = true;
            ctx.ui.setStatus("ap", "✅ ap: tests green");
            ctx.ui.setWidget("ap", successBanner(round, result.output));
            ctx.ui.notify(`✅ Tests green in round ${round}`, "success");
            // Final wrap-up
            pi.sendUserMessage(
              "Done. Summarize what you built, key decisions, and any remaining caveats in 3–5 bullets.",
            );
            await ctx.waitForIdle();
            break;
          } else {
            lastFailure = result.output;
            checkpointIfRepo(ctx, round);
            ctx.ui.notify(
              `❌ Round ${round} failed (${result.exitCode}) — steering with errors`,
              "error",
            );
          }
        }
      } catch (err: any) {
        ctx.ui.notify(`Autopilot error: ${err?.message || err}`, "error");
      }

      if (!success) {
        ctx.ui.setStatus("ap", "⚠️ ap: exhausted");
        ctx.ui.setWidget("ap", exhaustedBanner(round - 1, lastFailure));
        ctx.ui.notify(`⚠️ Exhausted ${MAX_ROUNDS} rounds — last error above`, "error");
        pi.sendUserMessage(
          `I'm stuck after ${round - 1} rounds. Last failure:\n\n${lastFailure}\n\nSummarize what you tried, what failed, and what would help unblock you.`,
        );
        await ctx.waitForIdle();
      }

      ctx.ui.setStatus("ap", undefined);
      ctx.ui.setWidget("ap", undefined);
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyModel = { id?: string; provider?: string; reasoning?: boolean; [k: string]: any };

async function setupReasoningModel(pi: ExtensionAPI, ctx: any): Promise<AnyModel | null> {
  // If FAS is active (fas-router/auto), delegate model selection to FAS.
  // Do NOT override with a catalog-scanned reasoning model — FAS owns
  // the execution candidate decision when fas-router/auto is active.
  if (ctx?.model?.provider === "fas-router" && ctx?.model?.id === "auto") {
    ctx.ui.notify("🤖 Autopilot: delegated to FAS router (fas-router/auto)", "info");
    return null;
  }
  // Scan the live catalog instead of hardcoding IDs — free models ship with
  // a `:free` suffix in some stores, and IDs differ across providers.
  let all: AnyModel[] = [];
  try {
    const fn = ctx.modelRegistry?.getAvailable || ctx.modelRegistry?.getAll;
    if (typeof fn === "function") all = (fn.call(ctx.modelRegistry) as AnyModel[]) || [];
  } catch {
    // fall through to empty
  }

  const ranked = all
    .filter((m) => m && m.id && !String(m.id).endsWith(":disabled"))
    .map((m) => {
      const id = String(m.id);
      const reasoning = !!m.reasoning || REASONING_MODEL_HINTS.some((h) => id.includes(h));
      return { model: m, score: reasoning ? 1 : 0, id };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.id.length - a.id.length || a.id.localeCompare(b.id));

  for (const hint of REASONING_MODEL_HINTS) {
    const pick = ranked.find((r) => r.id.includes(hint));
    if (!pick) continue;
    try {
      const ok = await pi.setModel(pick.model);
      if (ok) {
        ctx.ui.notify(`🤖 Reasoning model: ${pick.model.provider || "?"}/${pick.model.id}`, "info");
        return pick.model;
      }
    } catch {
      // no auth / not loadable — keep scanning
    }
  }

  // Last resort: first reasoning-tagged model that has auth.
  for (const r of ranked) {
    try {
      const ok = await pi.setModel(r.model);
      if (ok) {
        ctx.ui.notify(`🤖 Reasoning model: ${r.model.provider || "?"}/${r.model.id}`, "info");
        return r.model;
      }
    } catch {
      // no auth
    }
  }

  ctx.ui.notify(
    `No reasoning model available (catalog: ${all.length} models, ${ranked.length} strong) — keeping current`,
    "warning",
  );
  return null;
}

function enableAllTools(pi: ExtensionAPI) {
  const all = pi.getAllTools().map((t: any) => t.name);
  const current = pi.getActiveTools();
  pi.setActiveTools([...new Set([...current, ...all])]);
}

function runTests(cmd: string, cwd: string): { pass: boolean; exitCode: number; output: string } {
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 180_000,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    });
    return { pass: true, exitCode: 0, output: String(output).trim() };
  } catch (e: any) {
    return {
      pass: false,
      exitCode: e.status ?? 1,
      output: (e.stdout || "") + "\n" + (e.stderr || ""),
    };
  }
}

function isGitRepo(cwd: string) {
  return existsSync(join(cwd, ".git"));
}

// Exported for the durable regression suite (Queue 2 audit hardening).
// Stages TRACKED modifications only (-u): untracked files (the usual secret
// carriers: .env, keys) stay out of auto-commits for human review.
export function checkpointIfRepo(ctx: any, round: number) {
  if (!isGitRepo(ctx.cwd)) return;
  try {
    execSync("git add -u", { cwd: ctx.cwd, stdio: "ignore", timeout: 30_000 });
    execSync(
      `git commit -m "autopilot checkpoint r${round}" --no-gpg-sign`,
      { cwd: ctx.cwd, stdio: "ignore", timeout: 30_000 },
    );
  } catch {
    // not staged / nothing to commit / not a git repo — silently skip
  }
}

function detectTest(cwd: string): string {
  for (const cmd of TEST_CANDIDATES) {
    const bin = cmd.split(" ")[0];
    try {
      execSync(`command -v ${bin}`, { stdio: "ignore", timeout: 5_000, cwd });
      return cmd;
    } catch {
      // not present
    }
  }
  return "echo 'No test command auto-detected; set AP_TEST or pass --tests \"<cmd>\"'";
}

function short(s: string, n = 48) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---------------------------------------------------------------------------
// Widget banners
// ---------------------------------------------------------------------------

function autopilotBanner(task: string, test: string) {
  return [
    "🛸 AUTOPILOT ON",
    "Task: " + task,
    "Tests: " + test,
    `Rounds: 1/${MAX_ROUNDS} (self-repair on failure)`,
    "Method: reasoning model + all tools + test loop",
  ];
}

function roundBanner(
  round: number,
  max: number,
  task: string,
  test: string,
  failure: string,
) {
  const lines = [
    `🔄 Round ${round}/${max}`,
    "Task: " + short(task, 60),
    "Tests: " + test,
  ];
  if (failure) lines.push("Last failure excerpt:\n" + short(failure, 400));
  return lines;
}

function successBanner(round: number, output: string) {
  return [
    "✅ TESTS GREEN",
    `Passed in round ${round}`,
    output ? "Output excerpt:\n" + short(output, 600) : "",
  ].filter(Boolean);
}

function exhaustedBanner(rounds: number, failure: string) {
  return [
    "⚠️ AUTOPILOT EXHAUSTED",
    `Rounds run: ${rounds}`,
    failure ? "Last failure:\n" + short(failure, 800) : "",
    "Tip: give more context, split the task, or try /model to a stronger one.",
  ].filter(Boolean);
}
