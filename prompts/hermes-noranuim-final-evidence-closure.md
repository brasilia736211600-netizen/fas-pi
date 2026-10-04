# Hermes — Noranuim Final Evidence Closure Mission

## Objective

Continue `brasilia736211600-netizen/Noranuim` from its **actual current GitHub state** and bring the project to a defensible final-completion state.

This is a **final reconciliation, verification, and evidence-closure mission**. Do not restart the project, do not repeat completed work without evidence, and do not merge any pull request.

The goal is not to produce a report that says the project is complete. The goal is to make the repository genuinely satisfy the completion gate and then prove it.

## Authoritative source of truth

Treat the current GitHub repository state as authoritative.

Before trusting any Hermes state, journal, report, old SHA, old branch name, old finding, or old CI claim:

1. Inspect the current `main`.
2. Inspect the current open PR relevant to the security hardening work, currently expected to be PR #27 but verify this rather than assuming it.
3. Resolve its current base SHA, head SHA, branch, mergeability, status, changed files, commits, checks, and latest workflow runs.
4. Compare the actual repository state against:
   - `.hermes/state.json`
   - `.hermes/work_journal.md`
   - `.hermes/error_log.md`
   - `DECISION_LOG.md`
   - `REPOSITORY_ANALYSIS.md`
   - `.hermes/model_catalog.json`
5. Treat stale Hermes state as stale data, not as execution truth.
6. Reconcile durable state before proceeding.

Never act on an old commit merely because an old state file says it is current.

## Current known context — verify, do not blindly trust

At the time this mission was authored:

- `main` was known around `9760784ddb9d42f415036a7304b81b59905d0a73`.
- PR #27 was open and unmerged.
- The latest known PR #27 head was `ea24b75575d631d23883b3e0ac1319a3a64f22ce`.
- PR #27 contained approximately 60 commits and +1819/-36 changes at that point.
- The current Security Profile Runtime workflow was green.
- Other relevant CI workflows were also green.

These are historical starting hints only. **Re-query GitHub and use the current values.**

## Non-negotiable operating rules

- Do not merge PRs.
- Do not ask the user for routine engineering decisions.
- Do not stop at a plan.
- Do not restart completed audits merely because old state is stale.
- Do not trust subagent findings without direct source verification.
- Do not claim runtime verification from static analysis alone.
- Do not claim security closure from a green build alone.
- Do not claim a test proves an invariant until the test itself has been challenged against a deliberate regression.
- Do not introduce architecture rewrites unless directly required by a verified defect.
- Apply YAGNI aggressively.
- Prefer minimal surgical changes.
- Preserve existing security invariants.
- Heavy Android/native builds remain CI work, not local Termux work.
- Use at most 3 concurrent workers/subagents when parallelism materially helps.
- Every material change must be tested and checkpointed.
- If an approach fails, record the failure and do not blindly repeat it.
- If a finding is obsolete, mark it obsolete with evidence rather than silently deleting it.
- If a finding is not applicable, document why.
- If an issue remains unresolved, report it honestly and continue closing everything else that can be closed.

## Phase 1 — Freeze and reconcile reality

Inspect current GitHub state first.

Determine:

- current default branch
- current HEAD
- current working branch used by the security work
- current PR number
- PR base/head
- PR open/closed/merged state
- mergeability
- changed-file count
- commit count
- latest CI status
- latest runtime security status
- latest relevant test/build status

Then reconcile Hermes state.

Update durable state so it records the actual:

- repository
- branch
- HEAD
- PR
- PR head
- phase
- completed work
- verified work
- remaining work
- CI evidence
- runtime evidence
- known risks
- blockers
- exact resume action

Do not merely edit timestamps. Make the state semantically accurate.

## Phase 2 — Understand the current PR before changing anything

Read the complete current PR diff and changed-file list.

For every substantial change, classify it as one or more of:

- security fix
- security invariant
- regression test
- runtime test
- CI infrastructure
- reliability/recovery
- documentation/state
- required support code
- unnecessary/duplicated/YAGNI candidate

Do not reduce code merely because the PR is large. Reduce or redesign only when evidence shows unnecessary complexity, duplication, dead code, generated/debug scaffolding, or an avoidable architectural expansion.

Preserve working security fixes.

## Phase 3 — Final profile-isolation proof

Treat profile isolation as a hard security invariant:

> A request for Profile X must resolve to Profile X's storage/security context, or fail closed. It must never silently fall back to the default/global profile or another profile.

Verify the complete current production path.

Verify at minimum:

- cookies
- DOM storage
- IndexedDB
- Cache API
- service workers
- WebView permissions
- popups/windows
- WebView recreation
- activity recreation
- restoration
- repeated profile switching
- invalid profile
- missing profile
- unsupported multi-profile mode
- initialization failure
- profile-switch interruption
- process/activity lifecycle transitions

Verify that no non-default profile can fall back to global/default `CookieManager` or another profile's storage.

Use both:

1. structural/static evidence
2. actual Android runtime evidence

The runtime test must execute meaningful profile-isolation assertions. A suite that merely skips because the environment lacks a required capability must fail the security gate, not silently pass.

## Phase 4 — Test the tests

Deliberately introduce a temporary dangerous regression in a controlled working state.

Examples:

- reintroduce global CookieManager fallback
- bypass a fail-closed branch
- weaken the profile resolution condition
- re-enable a known dangerous fallback

Run the relevant guard/test and prove it fails.

Restore the correct implementation.

Run the same guard/test again and prove it passes.

Do not leave the intentional regression in the repository.

This phase is mandatory because a green test suite is not sufficient evidence if the test can be vacuous.

## Phase 5 — Reconcile the historical security audit

The historical repository analysis identified multiple security findings, including critical/high/medium/low issues. Do not assume their old status is still valid.

For every historical finding that can be identified, assign exactly one current status:

- `FIXED`
- `VERIFIED_REMAINING`
- `PARTIALLY_VERIFIED`
- `OBSOLETE`
- `NOT_APPLICABLE`
- `UNVERIFIED`
- `FAILED`

Every status must have current source evidence.

Re-check at least:

### WebView / script security

- user-script execution model
- script injection boundaries
- message parsing/validation
- WebView-to-native bridge validation
- popup/window behavior
- navigation restrictions
- unsafe JavaScript configuration

### Android

- runtime camera/microphone permission ordering
- file chooser behavior
- WebView permissions
- profile storage selection
- profile fail-closed behavior
- inspectable/debugging configuration
- cleartext traffic policy
- manifest permissions and optional hardware features

### iOS

- JavaScript window behavior
- inspectable/debugging configuration
- clipboard behavior
- permission behavior

### Desktop

- sandbox configuration
- node integration
- subframe node integration
- notification permissions
- CORP/header handling
- preload isolation

### Secrets/settings

- proxy credentials
- cloud sync payloads
- local persistence
- profile-specific secrets

### Privacy

- clipboard handling
- cloud settings leakage
- profile data leakage

Do not invent new vulnerabilities merely to increase the finding count.

## Phase 6 — Final performance verification

Revalidate the historical performance findings against the current source before changing anything.

Pay particular attention to:

- `CookieManager.flush()` threading
- blocklist snapshot read/write on the RN JS thread
- synchronous blocklist bridge decoding
- uncoalesced layout requests
- repeated cookie database copies
- repeated host/URI processing
- popup WebView lifecycle cleanup
- uncancelled coroutine scopes
- repeated blocklist parsing
- unnecessary host-set rebuilding

For each finding:

1. verify it still exists
2. determine actual impact
3. determine whether it is user-visible/material
4. fix only if justified
5. add a regression test where practical
6. verify performance-sensitive behavior

Do not perform speculative micro-optimizations.

## Phase 7 — Full verification ladder

Execute the strongest feasible verification sequence:

1. source/static verification
2. unit tests
3. security tests
4. regression tests
5. TypeScript/lint checks where configured
6. Android build in CI
7. Android instrumentation/runtime tests
8. profile-isolation runtime tests
9. failure-injection tests
10. recovery/resume tests
11. relevant GitHub Actions workflows
12. independent review/challenge

If a layer cannot run, document the exact reason and do not falsely mark it verified.

## Phase 8 — Failure and recovery validation

Exercise realistic failure modes:

- invalid profile
- missing profile
- profile creation failure
- profile storage initialization failure
- WebView creation failure
- WebView recreation
- navigation failure
- popup failure
- permission denial
- Activity recreation
- process death
- configuration change
- profile-switch interruption
- emulator startup delay
- CI script/environment failure
- APK install failure
- network failure
- partial blocklist refresh failure

For each applicable scenario verify:

- no cross-profile leakage
- fail-closed behavior
- no silent fallback
- no corrupted durable state
- safe recovery
- resumability

## Phase 9 — State integrity and resumability

Make `.hermes/state.json` and `.hermes/work_journal.md` reflect reality.

The state model should distinguish at least:

- `IMPLEMENTED`
- `UNIT_VERIFIED`
- `STATIC_VERIFIED`
- `RUNTIME_VERIFIED`
- `CI_VERIFIED`
- `INDEPENDENTLY_REVIEWED`
- `ACCEPTED`

Do not use a single `done` flag to imply every verification level.

Record:

- actual SHA
- actual branch
- actual PR
- exact verification evidence
- unresolved risks
- remaining blockers
- next resume action

Ensure another Hermes process can resume without relying on this prompt or conversational memory.

## Phase 10 — Independent adversarial challenge

Before declaring completion, challenge the result as if trying to reject it.

Look specifically for:

- stale SHA claims
- stale Hermes state
- stale analysis documents
- tests that do not execute production code
- tests that can pass through skipping
- false runtime claims
- static-only security claims
- profile leakage
- global/default storage fallback
- permission bypass
- security regression after refactoring
- CI shell assumptions
- emulator assumptions
- races
- lifecycle bugs
- state corruption
- unnecessary PR complexity
- duplicated guards
- dead code
- false “done” status

If any challenge succeeds, fix it and repeat the relevant verification.

## Phase 11 — Final completion report

Create or update:

`HERMES_FINAL_COMPLETION_REPORT.md`

The report must contain:

1. actual GitHub state
2. actual PR/head/base
3. implementation summary
4. profile-isolation proof
5. security finding reconciliation table
6. performance finding reconciliation table
7. test-the-tests evidence
8. CI evidence
9. Android runtime evidence
10. failure/recovery evidence
11. complete PR scope/YAGNI review
12. unresolved risks
13. exact verification limitations
14. Hermes state synchronization status
15. final readiness decision

Use an explicit final status:

`READY_FOR_USER_REVIEW`

or

`NOT_READY`

Never use `COMPLETE` merely because the agent ran out of tasks.

## Completion gate

You may declare `READY_FOR_USER_REVIEW` only when all applicable conditions are true:

- current GitHub state has been reconciled
- Hermes state is synchronized with GitHub
- current PR/head has been verified
- profile isolation is proven by meaningful runtime evidence
- profile isolation guards have survived test-the-tests regression
- no known Critical profile-isolation/security defect remains
- historical security findings have current evidence-backed statuses
- performance findings have been revalidated and material issues addressed or explicitly documented
- relevant CI gates are green
- Android runtime security gate is green
- failure/recovery behavior has been exercised
- complete PR diff has received YAGNI/scope review
- an independent adversarial challenge has been completed
- final report exists and is internally consistent
- another Hermes process can resume from durable state without conversational context

If any condition is false, remain in execution mode and continue.

## Final execution sequence

```text
CURRENT GITHUB STATE
→ HERMES STATE RECONCILIATION
→ CURRENT PR/DIFF INSPECTION
→ PROFILE ISOLATION PROOF
→ TEST-THE-TESTS
→ SECURITY RECONCILIATION
→ PERFORMANCE REVALIDATION
→ FULL CI/RUNTIME VERIFICATION
→ FAILURE/RECOVERY
→ YAGNI/SCOPE REVIEW
→ ADVERSARIAL CHALLENGE
→ STATE SYNCHRONIZATION
→ FINAL COMPLETION REPORT
→ READY_FOR_USER_REVIEW
```

Do not merge anything. Do not stop at a plan. Continue autonomously until the completion gate is genuinely satisfied or a real external blocker is proven and precisely documented.
