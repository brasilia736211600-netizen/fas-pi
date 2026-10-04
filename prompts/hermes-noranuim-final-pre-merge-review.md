# Hermes — Noranuim Final Pre-Merge Review & User Authorization Gate

## Objective
Perform the final, narrowly scoped review of Noranuim PR #27 after USER-SCRIPTS-CSP-01 was resolved. Do not redesign or restart audits. Establish whether PR #27 is genuinely safe and ready for explicit user authorization to merge.

## Authoritative state
Treat current GitHub state as authoritative. Verify current:
- main/base SHA
- PR #27 head SHA, mergeability, checks, changed files, commits
- current PR diff
- current Hermes state/journal/report
- latest CI/runtime evidence

Do not trust old SHAs or old reports without reconciling them.

## Non-negotiable
- Do NOT merge PR #27.
- Do NOT close PR #27.
- Do NOT ask routine engineering questions.
- Do NOT restart completed security audits.
- Do NOT make unrelated changes.
- Prefer minimal surgical fixes only if a real defect is found.
- Apply YAGNI.
- Heavy Android validation belongs in CI.
- If a fix is made, rerun only the verification layers materially affected by it.
- Never label something verified when the relevant evidence was skipped.

## Phase 1 — Verify final diff
Inspect the complete current PR #27 diff from base to head.

Classify every changed file as:
SECURITY FIX / SECURITY TEST / RUNTIME TEST / CI INFRA / STATE-DOCUMENTATION / REQUIRED SUPPORT / UNNECESSARY.

Look specifically for:
- accidental unrelated changes
- dead/debug/generated scaffolding
- duplicated guards
- weakened security invariants
- test-only implementation that does not exercise production behavior
- stale documentation
- unnecessary dependencies/architecture

Do not reduce code merely because the PR is large; change scope only where evidence demonstrates unnecessary or unsafe material.

## Phase 2 — Final user-script consent verification
Verify the implemented userScriptExecutionConsent design in the actual production path.

Prove:
1. default is false;
2. global and per-profile semantics are deterministic;
3. consent is checked before user scripts execute;
4. there is no alternate execution path that bypasses the gate;
5. legitimate enabled behavior still works;
6. disabling consent actually prevents execution;
7. profile isolation remains intact;
8. the consent gate does not silently become an authorization bypass.

Confirm that the conclusion from the previous mission remains technically valid: CSP is not being falsely claimed as an Android/iOS control where it is ineffective.

## Phase 3 — Final profile-isolation sanity check
Do not rerun the entire historical audit. Verify only that the final user-script changes did not weaken:
- exact Profile X → Profile X storage/context or fail closed;
- no global/default CookieManager fallback;
- no cross-profile WebView reuse;
- popup/profile handling;
- recreation/restoration;
- unsupported MULTI_PROFILE fail-closed behavior.

Use existing passing runtime evidence plus targeted regression tests as appropriate.

## Phase 4 — CI/runtime evidence freshness
Verify that the evidence corresponds to the current PR head or determine exactly what commit it proves.

If current head changed after the successful runtime run, do not claim that the old run proves the new head. Trigger the minimum required current-head validation through the existing workflow if possible.

Verify:
- all required checks green;
- Security Profile Runtime genuinely executed the tests;
- no security gate passed only because tests skipped;
- no stale-run evidence is being presented as current.

## Phase 5 — Adversarial final challenge
Attempt to falsify the readiness claim.

Challenge:
- consent default accidentally true;
- per-profile consent bypass;
- alternate script execution path;
- static test that can pass while production behavior is unsafe;
- stale CI evidence;
- stale Hermes state;
- profile leakage;
- hidden fallback;
- unrelated PR changes;
- false READY_FOR_USER_REVIEW;
- mergeability mistaken for security approval.

If a challenge succeeds, fix the underlying defect and rerun the relevant verification.

## Phase 6 — Durable state and report
Synchronize:
- .hermes/state.json
- .hermes/work_journal.md
- HERMES_FINAL_COMPLETION_REPORT.md

Record actual SHA/branch/PR/checks and the final security disposition.

Use explicit verification states:
IMPLEMENTED
UNIT_VERIFIED
STATIC_VERIFIED
RUNTIME_VERIFIED
CI_VERIFIED
INDEPENDENTLY_REVIEWED
READY_FOR_USER_REVIEW

Do not mark MERGED or MERGE_COMPLETE.

## Phase 7 — Final decision
Return exactly one of:

### READY_FOR_USER_AUTHORIZATION
Use only if:
- current PR head is verified;
- required CI/runtime evidence is current;
- final diff is scoped and justified;
- user-script consent boundary is proven;
- profile isolation remains proven;
- adversarial challenge passes;
- no known Critical/High security defect remains;
- durable state/report are synchronized.

### NOT_READY
Use if any required condition is not satisfied. Continue fixing evidence-backed issues where possible.

## Final output/report requirements
Write/update HERMES_FINAL_PRE_MERGE_REVIEW.md with:
- actual PR/base/head;
- current checks;
- final diff/scope assessment;
- user-script consent proof;
- profile-isolation sanity proof;
- CI/runtime freshness;
- adversarial challenge;
- unresolved risks;
- exact final status.

## Critical rule
Even if the result is READY_FOR_USER_AUTHORIZATION, STOP WITHOUT MERGING.

The user must explicitly authorize the merge in a subsequent instruction.

## Final sequence
CURRENT GITHUB → CURRENT PR HEAD → COMPLETE DIFF → USER-SCRIPT CONSENT PROOF → PROFILE SANITY → CURRENT CI/RUNTIME → ADVERSARIAL CHALLENGE → STATE SYNC → FINAL REPORT → READY_FOR_USER_AUTHORIZATION OR NOT_READY → STOP WITHOUT MERGE
