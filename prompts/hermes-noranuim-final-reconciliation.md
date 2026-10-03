# Hermes — Noranuim Final Reconciliation & Completion Mission

## Objective

Continue `brasilia736211600-netizen/Noranuim` from its actual current GitHub state and finish the remaining verification/reconciliation work. Do NOT restart the project, repeat completed work without evidence, or merge any PR.

## Authoritative state

Treat GitHub as the source of truth. Before acting, inspect the current `main`, PR #27, its current head, CI status, changed files, and relevant Hermes state/journal/decision files. Reconcile stale Hermes state with the actual Git SHA/branch/PR state.

Known context at mission creation:
- `main`: `9760784ddb9d42f415036a7304b81b59905d0a73`
- PR #27: open, mergeable, must remain unmerged without explicit user authorization
- PR #27 purpose: profile-isolation hardening + Android runtime instrumentation
- The latest known Security Profile Runtime workflow completed successfully; independently verify this against the current GitHub state rather than trusting this statement blindly.

## Phase 1 — Freeze, inspect, reconcile

1. Inspect current GitHub state first.
2. Read `.hermes/state.json`, `.hermes/work_journal.md`, `.hermes/error_log.md`, `DECISION_LOG.md`, `REPOSITORY_ANALYSIS.md`, and `.hermes/model_catalog.json` when present.
3. Reconcile stale state against the actual repository HEAD, branch, PR, CI, and completed work.
4. Do not redo verified work merely because an old state file says it is pending.
5. Update durable Hermes state after each major checkpoint.

## Phase 2 — PR #27 final verification

Verify the CURRENT PR #27, not an older SHA.

Confirm:
- profile isolation implementation is still present;
- non-default profiles can resolve only their own storage or fail closed;
- no global/default `CookieManager` fallback exists for non-default profiles;
- `MULTI_PROFILE` unsupported paths fail closed;
- WebView recreation/restoration cannot reuse the wrong profile;
- repeated profile switching cannot leak state;
- invalid/missing profiles fail safely;
- cookies, DOM storage, IndexedDB, Cache API, service workers, permissions and popups remain isolated as applicable.

Verify both static/structural guards and production runtime instrumentation. Build success alone is not runtime proof.

## Phase 3 — Test the tests

Keep security tests non-vacuous.

Where practical, deliberately introduce the dangerous regression (especially global CookieManager fallback and profile-gate bypass), prove the test fails, then restore the implementation and prove it passes.

Confirm tests exercise production paths rather than only testing duplicated strings or fixtures.

## Phase 4 — Security final audit

Re-check current source and reclassify every historical security finding as:

`VERIFIED | PARTIALLY VERIFIED | UNVERIFIED | FIXED | OBSOLETE | FAILED | NOT APPLICABLE`

Pay particular attention to:
- WebView/JavaScript bridge boundaries;
- JavaScript windows/popups;
- permissions and manifest/uses-feature declarations;
- cleartext/network policy;
- inspectable/debug exposure;
- proxy credential handling and profile secrets;
- clipboard rewriting consent;
- blocklist failure/partial-refresh behavior;
- CORP/header handling;
- profile storage isolation.

Do not invent findings. Every finding must have direct source/runtime evidence.

## Phase 5 — Performance final verification

Explicitly verify the previously identified performance concerns, especially:
- `CookieManager.flush` on UI/main paths;
- synchronous blocklist persistence/read operations;
- synchronous `setBlocklist` bridge work;
- any regression introduced by security hardening.

Fix only evidence-backed problems. Preserve YAGNI and minimal surgical scope.

## Phase 6 — Full verification ladder

Run or verify, using CI where heavy Android tooling is required:

1. static checks;
2. unit/security tests;
3. build validation;
4. Android runtime instrumentation;
5. failure injection;
6. recovery/resume validation;
7. complete relevant CI workflows;
8. independent final review.

Do not weaken tests to obtain green CI.

## Phase 7 — Failure and recovery testing

Test applicable failures including:
- invalid/missing profile;
- profile creation/storage initialization failure;
- WebView creation/recreation failure;
- navigation/popup failure;
- permission denial;
- process death/activity recreation/configuration change;
- profile-switch interruption;
- emulator/CI delays;
- APK installation failure;
- transient network failure.

After recovery, verify fail-closed behavior, durable state, correct profile ownership, and absence of cross-profile leakage.

## Phase 8 — Diff and scope audit

Review the COMPLETE current PR #27 diff.

For every substantial addition ask:
- Is it required by the mission?
- Is it security/test infrastructure that provides durable value?
- Is it duplicated?
- Is it generated/debug-only scaffolding?
- Does it violate YAGNI or create unnecessary architectural complexity?

Do not rewrite working code merely to reduce line count. Remove only demonstrably unnecessary material.

## Phase 9 — Hermes state integrity

Before completion, make Hermes state accurately represent reality:
- actual Git SHA;
- actual branch and PR;
- completed phases;
- exact test/CI evidence;
- remaining risks;
- unresolved blockers;
- exact next/resume action.

Synchronize the journal/decision log where appropriate. The project must be safely resumable after Termux/Android process death, interruption, model failure, or network loss.

## Phase 10 — Independent final challenge

Perform a fresh adversarial review before declaring completion. Specifically challenge:
- fake/vacuous security evidence;
- tests not reaching production code;
- profile leakage;
- permission bypass;
- stale state;
- wrong Git SHA assumptions;
- unverified runtime claims;
- CI shell/emulator assumptions;
- performance regressions;
- race conditions;
- unnecessary architecture changes;
- false completion.

## Completion gate

Do not declare the mission complete until all important claims have explicit evidence and are classified.

Required final conditions:
- no known Critical security issue;
- no known profile-isolation violation;
- current PR #27 runtime evidence independently verified;
- relevant CI/build/test gates verified;
- security regression tests demonstrated non-vacuous behavior;
- performance findings verified and fixed or explicitly accepted with evidence;
- Hermes state synchronized with GitHub;
- exact resume path documented;
- `HERMES_FINAL_COMPLETION_REPORT.md` written and updated with the final evidence.

If a genuinely external blocker remains, isolate it precisely, prove it, document what was completed, and leave an exact resumable next step. Do not manufacture completion.

## Operating rules

- Autonomous execution: diagnose → implement → test → failure-inject → recover → review → verify → continue.
- Do not ask the user for routine decisions.
- Do not stop at a plan or progress report.
- Do not repeat completed work without evidence that it needs revalidation.
- Do not merge PR #27 or any PR without explicit user authorization.
- Prefer CI for heavy Android builds/tests; avoid unnecessary resource-heavy local work.
- Use at most 3 concurrent workers for genuinely independent tasks.
- Keep security invariants reusable so future features inherit them.

## Final sequence

`CURRENT GITHUB STATE → HERMES STATE RECONCILIATION → PR #27 VERIFICATION → TEST-THE-TESTS → SECURITY RE-AUDIT → PERFORMANCE VERIFICATION → FULL CI/RUNTIME → FAILURE/RECOVERY → DIFF/SCOPE REVIEW → INDEPENDENT CHALLENGE → STATE SYNCHRONIZATION → FINAL REPORT`

Start immediately and continue until the completion gate is satisfied or a proven external blocker prevents further progress.