# Noranuim — Hermes Full Autonomous Completion Mission

## Mission

Continue the Noranuim project from the **actual current GitHub state** and bring the security, profile-isolation, performance, CI, testing, and Hermes execution state to a verified completion state. Do not restart the project and do not repeat completed work without evidence.

## Source of truth

- Repository: `brasilia736211600-netizen/Noranuim`
- GitHub is authoritative over stale local/Hermes state.
- Current known `main`: `9760784ddb9d42f415036a7304b81b59905d0a73`
- PR #27 is open and must **not** be merged without explicit user authorization.
- PR #27 head: `b27a09b4aebde580e62e829b68dffe544ba9e6c8`
- Preserve the already-landed permission work on `main`.

## Mandatory first phase: reconcile state

1. Inspect the current GitHub `main`, branches, open PRs, PR #27, CI/workflows, and changed files.
2. Read and reconcile `.hermes/state.json`, `.hermes/work_journal.md`, `.hermes/error_log.md`, `DECISION_LOG.md`, `REPOSITORY_ANALYSIS.md`, and `.hermes/model_catalog.json` when present.
3. Treat GitHub code/history/CI as authoritative if Hermes state is stale.
4. Update Hermes durable state before and after every major checkpoint.
5. Classify existing findings as fixed, verified, partially verified, unverified, obsolete, or still open. Do not redo completed work blindly.

## Non-negotiable profile-isolation invariant

For every browser profile, Profile X must resolve to **exactly Profile X's storage/session state or fail closed**.

There must be no fallback from a requested non-default profile to:
- global/default `CookieManager`;
- another profile's Chromium/WebView storage;
- implicit singleton state;
- silently created substitute state that can expose another profile's data.

Verify cookies, DOM storage, IndexedDB, Cache API, service workers, permissions, popups, recreation/restoration, repeated switching, invalid/missing profiles, and fail-closed behavior. Preserve this invariant permanently so future features cannot bypass it.

## PR #27 completion

PR #27 addresses profile-isolation hardening and the broken runtime instrumentation gate. Complete the work rather than assuming the PR body is proof.

Required evidence:
- static guards;
- unit/instrumentation tests;
- actual runtime tests on the intended Android environment;
- build success;
- CI success;
- non-vacuous failure-injection tests.

Build success alone is not runtime proof.

Also verify the CI shell semantics already discovered: do not rely on multiline control flow if the action executes each `script:` line independently.

## Security re-audit

Re-audit the current source after reconciling GitHub state, especially:

- WebView/JavaScript execution and message boundaries;
- Android permissions and manifest declarations;
- iOS permission behavior;
- desktop security configuration;
- cleartext/network policy;
- debugging/inspectable exposure;
- proxy credential handling;
- blocklist refresh/failure behavior;
- notification permissions;
- CORP/header handling;
- JavaScript windows/popups;
- clipboard URL rewriting;
- profile isolation and storage ownership.

Re-verify historical high/critical findings instead of trusting old reports.

Security tests must be non-vacuous: deliberately inject the previously dangerous behavior where practical and prove the guard/test fails, then restore the correct implementation and prove it passes.

## Performance

Inspect and fix only evidence-backed performance problems. In particular verify:

- `CookieManager.flush` is not unnecessarily performed on the main/UI path;
- blocklist persistence/reads do not introduce avoidable synchronous I/O;
- bridge calls such as synchronous `setBlocklist` do not create unnecessary UI-thread stalls;
- no new regression was introduced by the security hardening.

Use minimal surgical fixes. No architecture rewrite.

## Engineering rules

- YAGNI and minimal scope.
- Security invariants must be centralized/reusable so future features inherit them rather than requiring ad-hoc security review each time.
- TDD for substantive fixes: reproduce/failing test → minimal fix → regression test → verification.
- Prefer GitHub Actions/CI for heavy Android builds and runtime validation rather than unnecessary local phone builds.
- Parallelize only genuinely independent work; use clear ownership and a maximum of 3 concurrent workers when applicable.
- Use the strongest verified free model for security/architecture decisions; cheaper models may handle mechanical work. Never treat unsupported model claims as evidence.
- Never weaken tests merely to make CI green.

## Failure injection and recovery

Where supported, deliberately test and recover from:

- missing/invalid profile;
- profile creation failure;
- storage initialization failure;
- WebView creation/recreation failure;
- navigation/popup failure;
- cookie/storage access failure;
- activity recreation/configuration change;
- permission denial;
- process death;
- profile switching interruption;
- CI/emulator delay;
- APK installation failure;
- transient network failure.

After each failure, verify fail-closed behavior, durable state, correct recovery, and absence of cross-profile leakage.

## Verification ladder

Use this order as applicable:

1. static analysis;
2. unit/security tests;
3. build validation;
4. runtime instrumentation;
5. failure injection;
6. recovery/resume verification;
7. CI validation;
8. independent final review.

Do not declare completion when a required layer is merely assumed.

## Hermes state and resumability

Maintain exact durable progress in Hermes state/journal. Record:

- current Git SHA/branch/PR;
- completed work;
- evidence and test commands/results;
- unresolved risks;
- next action;
- recovery instructions.

The mission must survive Termux/Android process death, interruption, model failure, network loss, and resumed execution without losing task state.

## PR policy

You may inspect, modify, test, document, and update PR #27. Do **not** merge PR #27 or any other PR without explicit user authorization.

## Final independent review

Before completion, independently challenge the result for:

- fake/vacuous security evidence;
- profile data leakage;
- permission bypass;
- stale Hermes state;
- tests that do not exercise production paths;
- CI script/runtime-environment mistakes;
- unverified runtime claims;
- performance regressions;
- race conditions;
- failure recovery gaps;
- accidental architecture expansion;
- false completion.

## Completion gate

Finish only when the remaining state is explicitly classified as `VERIFIED`, `PARTIALLY VERIFIED`, `UNVERIFIED`, `FAILED`, or `NOT APPLICABLE`, with evidence for every important claim.

Completion requires:

- no known Critical security issue;
- no known profile-isolation violation;
- PR #27 runtime proof completed or the exact blocker is documented;
- required CI/build/test gates verified;
- security regression tests non-vacuous;
- performance findings addressed or evidence-backed as acceptable;
- Hermes state synchronized with GitHub;
- exact resume path documented;
- final report written as `HERMES_FINAL_COMPLETION_REPORT.md`.

## Execution directive

Start immediately. Do not ask the user for routine decisions. Diagnose → implement → test → break deliberately where useful → recover → review → learn → verify → continue. Do not stop at a plan or progress report. Continue autonomously until the completion gate is satisfied or a genuinely external blocker makes further progress impossible.

**Execution sequence:**

`VERIFY CURRENT GITHUB STATE → RECONCILE HERMES STATE → RECONCILE PR #27 → COMPLETE PROFILE-ISOLATION RUNTIME PROOF → RE-AUDIT SECURITY → FIX REAL FINDINGS → VERIFY PERFORMANCE → RUN CI → FAILURE-INJECT → RECOVER → INDEPENDENT REVIEW → UPDATE DURABLE STATE → FINAL REPORT`
