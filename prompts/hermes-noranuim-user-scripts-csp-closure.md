# Hermes — Noranuim USER-SCRIPTS-CSP-01 Closure Mission

## Objective

Continue `brasilia736211600-netizen/Noranuim` from the actual current GitHub state and resolve the single remaining security item from the completed final evidence-closure mission: `USER-SCRIPTS-CSP-01` in `NoraTab.tsx:371-376`.

This is a **targeted closure mission**, not a new security audit. Preserve all already-verified work. Do not restart completed work, do not merge PR #27, and do not introduce unrelated changes.

## Authoritative state

Treat current GitHub state as authoritative. Before changing anything:

1. Inspect current `main`.
2. Inspect the current PR #27 and its actual current head/base, branch, checks, changed files, and status.
3. Inspect the current `NoraTab.tsx` implementation around the reported user-script/style injection.
4. Read the current `.hermes/state.json`, `.hermes/work_journal.md`, `HERMES_FINAL_COMPLETION_REPORT.md`, and relevant decision/audit records.
5. Verify that `USER-SCRIPTS-CSP-01` is genuinely still `UNVERIFIED`; do not assume the previous report is current.

## Non-negotiable rules

- Do not merge any PR.
- Do not restart the entire Noranuim audit.
- Do not repeat already-proven work unless a changed dependency makes it necessary.
- Do not ask the user routine engineering questions.
- Do not stop at a plan: investigate, implement if justified, test, challenge, verify, and document.
- Do not invent a vulnerability or fix merely to make the report green.
- Preserve existing profile-isolation and security invariants.
- Prefer the smallest evidence-backed surgical change.
- Apply YAGNI: no new framework, architecture, abstraction, dependency, or generalized security subsystem unless the actual code requires it.
- Do not weaken existing functionality merely to satisfy a superficial CSP check.
- Heavy Android/native validation belongs in CI/runtime workflows rather than local Termux.
- Maximum 3 concurrent workers/subagents.

## Phase 1 — Verify the finding

Directly inspect the production path around `NoraTab.tsx:371-376` and determine exactly:

- what user-controlled or extension-controlled data becomes script/style content;
- where it is injected;
- whether it executes in the page's main world, isolated world, WebView document, or another context;
- whether it can reach page-origin privileges, DOM, cookies, storage, Web APIs, or privileged bridges;
- whether the content is actually trusted by design;
- whether an existing CSP, sandbox, isolated-world boundary, nonce/hash, escaping, sanitization, or equivalent control already constrains it;
- whether the reported issue is a real exploitable security boundary violation, a defense-in-depth concern, or a false/obsolete finding.

Use direct source evidence. Do not rely on line numbers from old reports if code moved.

## Phase 2 — Choose the minimum correct disposition

Classify the finding as exactly one of:

- `FIXED`
- `VERIFIED_REMAINING`
- `OBSOLETE`
- `NOT_APPLICABLE`
- `UNVERIFIED`
- `FAILED`

If the finding is real and materially security-relevant, implement the smallest safe fix.

If a CSP/sandbox boundary is genuinely required, use the narrowest mechanism compatible with Noranuim's existing architecture and supported platform behavior. Do not add a broad/global CSP that breaks unrelated pages or browser functionality.

If CSP is not technically the correct control because the injection occurs in an isolated/privileged context where CSP does not provide the intended protection, do not add a fake CSP. Instead, establish the actual security boundary and document why it is sufficient.

If the finding is not exploitable under the real execution model, prove that with source/runtime evidence and mark it accordingly rather than manufacturing a change.

## Phase 3 — Regression tests

Add or strengthen only the tests necessary to prove the chosen security invariant.

Tests must exercise the real production path, not a duplicated implementation or a string-only fixture.

At minimum, where applicable:

- prove untrusted/user-provided content cannot escape its intended execution boundary;
- prove scripts/styles cannot gain unintended privileged/page-origin access;
- prove existing legitimate user-script/style functionality remains intact;
- prove the fix does not weaken profile isolation, WebView security, permissions, navigation, or existing browser behavior.

If a static guard is appropriate, make it structural/semantic enough that trivial reformatting cannot bypass it. If runtime proof is required, run the real Android path in CI.

## Phase 4 — Test the test

Perform a temporary deliberate regression against the new/updated security invariant.

Examples, depending on the actual implementation:
- remove/bypass the security boundary;
- restore the unsafe injection path;
- weaken the relevant guard;
- bypass the intended sanitization/isolation.

Prove the relevant test/guard fails, then restore the correct implementation and prove it passes.

Do not leave the repository in the intentionally vulnerable state.

## Phase 5 — Targeted verification

Run the smallest complete verification set that is justified by the change:

1. affected unit/static/security tests;
2. TypeScript/lint/type checks relevant to touched code;
3. relevant Android build/CI validation;
4. relevant Android runtime/instrumentation validation if the execution boundary requires it;
5. existing profile-isolation/security gates if the changed path can affect them;
6. failure/recovery check if the change touches lifecycle or persistence.

Do not rerun the entire historical audit unless evidence shows the change affects a previously closed security invariant.

## Phase 6 — Adversarial review

Challenge the result specifically for:

- fake CSP that does not actually constrain the execution context;
- CSP added where it is ineffective;
- security-by-string-check rather than actual boundary enforcement;
- bypass through alternate injection path;
- privilege escalation through WebView/bridge/page-origin APIs;
- breakage of legitimate user scripts/styles;
- profile leakage;
- race/lifecycle/recreation bypass;
- test that passes without executing the production path;
- new unnecessary dependency/architecture.

If the challenge exposes a problem, fix it and repeat the relevant verification.

## Phase 7 — Reconcile durable Hermes state

Update `.hermes/state.json` and `.hermes/work_journal.md` with factual current state, including:

- actual Git SHA and branch;
- PR #27 current head/base/status;
- exact disposition of `USER-SCRIPTS-CSP-01`;
- files changed;
- tests and CI/runtime evidence;
- failed approaches, if any;
- remaining risks/blockers;
- exact resume action for another Hermes process.

Do not mark the entire project complete unless the actual completion gate supports it.

## Phase 8 — Update final evidence report

Update `HERMES_FINAL_COMPLETION_REPORT.md` so it no longer claims `USER-SCRIPTS-CSP-01` is merely pending if the evidence now supports closure.

Record:
- original finding;
- current source evidence;
- disposition;
- implementation, if any;
- regression test evidence;
- test-the-test evidence;
- CI/runtime evidence;
- adversarial review result;
- residual risk, if any.

The report must remain evidence-based. Do not change the status merely to obtain `READY_FOR_USER_REVIEW`.

## Completion gate

The mission is complete only when:

- `USER-SCRIPTS-CSP-01` has a defensible evidence-backed disposition;
- any real defect is fixed with the minimum necessary change;
- the relevant regression test proves the invariant;
- the test itself has been challenged with a deliberate regression;
- relevant CI/runtime verification is green where required;
- no existing profile-isolation/security invariant is weakened;
- Hermes durable state is synchronized;
- `HERMES_FINAL_COMPLETION_REPORT.md` is synchronized;
- PR #27 remains unmerged;
- final readiness is honestly reported as `READY_FOR_USER_REVIEW` or `NOT_READY`.

## Final sequence

`VERIFY CURRENT GITHUB → VERIFY USER-SCRIPTS-CSP-01 → DETERMINE REAL SECURITY BOUNDARY → MINIMAL FIX OR EVIDENCE-BACKED ACCEPTANCE → REGRESSION TEST → TEST-THE-TEST → TARGETED CI/RUNTIME → ADVERSARIAL REVIEW → STATE SYNC → FINAL REPORT`

Do not merge. Do not restart completed work. Do not stop at a plan.