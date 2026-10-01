# Hermes Autonomous Mission — 1M Context First

Continue the existing Hermes Autonomous Engineering Intelligence mission from the exact current state. Do not restart completed work, do not ask the user what to do next, and do not stop at a plan. Execute autonomously until the completion gate is genuinely satisfied.

## FIRST PRIORITY — RAISE CONTEXT TOWARD 1M

Before expensive benchmarking or remaining implementation, inspect Hermes context handling and model/provider configuration.

Target **1M tokens wherever the actual model/provider genuinely supports it**.

Determine and distinguish:
- advertised context
- configured context
- verified context
- usable context
- effective context
- safety limits

If 1M is genuinely supported:
1. remove unnecessary lower artificial ceilings;
2. configure Hermes to use the verified 1M ceiling;
3. preserve provider/model safety limits;
4. verify the effective usable context;
5. persist the verified result.

If 1M is advertised but blocked by Hermes, identify and fix the actual limiting layer, then verify again.

If 1M is genuinely unsupported, do NOT fabricate support. Use the highest safely verified context and record the reason.

Context must be stored per model family/deployment with verification method, confidence, and timestamp. Never treat an advertised value as verified.

Targeting 1M is mandatory; claiming 1M without evidence is forbidden.

## CONTINUE FROM CURRENT IMPLEMENTATION

The previous implementation reported:
- provider_discovery.py
- capability_probes.py
- engine.py
- model_intelligence package exports
- autonomous_loop.py
- Dahl excluded
- TOP-5 family ranking
- deployment→deployment→family fallback
- Model Council
- profiles/session portability
- transactional backup/restore
- resource-aware execution

Known gaps:
1. automated test execution/CI
2. Mission J automatic context compaction
3. capability probes not connected to real model callers
4. incomplete empirical benchmarking
5. ruamel.yaml may be required

Re-inspect the actual repository first and preserve working architecture. Use YAGNI and surgical changes.

## REAL MODEL CALLER BENCHMARKING

If ruamel.yaml is genuinely required, install it safely and continue.

Connect capability probes to the real Hermes model/provider execution path. Do not create a fake benchmark path.

Use bounded, resource-aware probes covering where applicable:
- capability
- coding
- reasoning
- tool use
- structured output
- reliability
- latency
- context capability

Persist provider, deployment, family, task, result, latency, error class, context evidence, confidence, and timestamp.

Verify the complete chain:

benchmark result → evidence storage → scoring → family aggregation → reputation → freshness → adaptive weighting → TOP-5 → deployment fallback.

The same underlying model family across providers/accounts must occupy one TOP-5 position. All deployments within a family are fallback candidates before moving to another family.

Verified Hermes performance must outweigh unsupported reputation. Never manufacture evidence.

## MISSION J — AUTOMATIC CONTEXT COMPACTION

Implement compaction around **40% of verified usable context**, adapted to the active model's verified capacity.

Preserve at minimum:
- objective
- requirements
- decisions
- implementation state
- unresolved failures
- important paths
- tests
- benchmark evidence
- recovery information
- current phase

Validate state after compaction and resume automatically.

Test normal, heavy-context, failed, interrupted, process-death, and recovery scenarios. A failed compaction must never silently destroy the last safe state.

## AUTOMATED TESTING

Establish the smallest correct automated test execution path using existing project conventions.

Cover applicable:
- unit tests
- model-intelligence tests
- fallback/recovery
- profiles/session
- backup/restore
- autonomous loop
- context compaction

Never report an unexecuted test as passing.

## FAILURE INJECTION

Perform deterministic tests for:
- provider timeout
- HTTP failure
- rate limit
- deployment failure
- all deployments of a family failing
- family fallback
- model-call interruption
- autonomous-loop interruption
- compaction interruption
- profile-switch interruption
- backup interruption
- restore interruption
- process restart

Verify durable state, correct fallback, non-duplication, failure recording, and automatic continuation.

## RESOURCE-AWARE AUTONOMY

Hermes runs on constrained Android/Termux hardware. Keep verification bounded.

Dynamically reduce parallelism, Council size, benchmark depth, and background work under memory pressure. Critical work must be able to continue serially. Avoid unnecessary large builds and parallel model calls.

## MODEL COUNCIL

Verify bounded rounds, family diversity where actually available, seat recovery, evidence preservation, synthesis, and resource-aware execution.

If only one independent family is available, do not pretend Council independence exists; record the limitation.

## PROFILES / SESSION PORTABILITY

Verify end-to-end isolation:
A unique state → B unique state → switching back restores only the correct state.

Verify:
- new profile behaves like first-use Hermes
- clone initially matches source but becomes independent
- transactional switching
- restart recovery
- dual persistence in global session index and profile store
- interruption recovery

## BACKUP / RESTORE

Verify backup creation, manifest, integrity, interrupted backup, restore validation, atomic restore, rollback, and interrupted restore.

## COMMANDS

Verify:
- /models
- /council
- /backup
- /profile

including invalid subcommands. In particular, /council bogus must produce a clear unknown-subcommand error.

## AUTONOMOUS LOOP

Verify the real lifecycle:

DISCOVER → UNDERSTAND → PLAN → SELECT → IMPLEMENT → TEST → REVIEW → VERIFY → REPAIR → RE-TEST → LEARN → REASSESS → COMPLETE

It must use durable checkpoints and recover automatically from normal failures.

## SELF-LEARNING

Persist bounded evidence about model performance, routing, confidence, provider health, and failure patterns.

Learning must never disable safety gates, delete verification, silently rewrite core logic, or manufacture evidence. Fresh verified evidence supersedes stale evidence.

## INDEPENDENT FINAL REVIEW

After implementation, independently inspect for:
- fake benchmarks
- ranking that ignores empirical evidence
- unverified context claims
- duplicate families
- fallback bypass
- lost state
- profile leakage
- backup corruption
- silent command failures
- races
- resource exhaustion
- false completion

Fix every discovered defect autonomously and re-test.

## COMPLETION GATE

Classify every applicable requirement as VERIFIED, PARTIALLY VERIFIED, UNVERIFIED, FAILED, or NOT APPLICABLE.

Full completion requires, where applicable:
- context raised toward 1M and genuinely verified
- real callers connected to probes
- empirical evidence collected and consumed by ranking
- TOP-5 family ranking verified
- deployment and family fallback verified
- context capability verified
- ~40% automatic compaction implemented/tested
- automated tests executed
- failure injection and interruption recovery verified
- resource-aware behavior verified
- Council verified
- profiles/session portability verified
- backup/restore verified
- commands verified
- autonomous loop verified
- evidence-based self-learning verified
- independent final review completed

Do not equate test count with completion.

## ZERO MANUAL INTERVENTION

Do not ask the user what to do next. Do not stop after analysis or planning. For normal failures: diagnose → repair → retry → verify. For provider failures: classify → fallback → continue. For weak models: update evidence → route appropriately → continue. For unsafe context: compact → validate → continue. For interruption: recover → continue.

Only stop for a genuine external blocker Hermes cannot safely resolve itself.

## DURABLE REPORT

Update AUTONOMOUS_FINAL_REPORT.md with:
1. completed work
2. changed files
3. actual provider/model inventory
4. empirical benchmark evidence
5. ranking evidence
6. context verification
7. compaction verification
8. fallback evidence
9. automated tests
10. failure injection
11. recovery results
12. Council results
13. profile/session results
14. backup/restore results
15. resource measurements
16. self-learning evidence
17. independent-review findings
18. remaining limitations
19. exact final git state
20. exact resume point if anything remains

Clearly distinguish VERIFIED from UNVERIFIED.

## FINAL RULE

Own the entire mission.

**ONE HIGH-LEVEL PROMPT → HERMES TAKES OWNERSHIP → AUTONOMOUS ENGINEERING → VERIFIED COMPLETION**

Start immediately from the current state.

**First raise the context ceiling toward 1M and verify it. Then complete every remaining gap autonomously.**

Implement → test → inject failures → recover → review → learn → verify → continue until the completion gate is genuinely satisfied.
