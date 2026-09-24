---
name: fas-routing-policy
description: How the FAS central router picks models, bounds fallback, and budgets thinking. Read when debugging route choices or fallback behavior.
---

# FAS Routing Policy (declarative reference — no executable logic here)

## Decision order

1. Candidates come from Pi's model registry (the `fas-router` entry itself excluded).
2. Task constraints filter the pool: required inputs (for example text+image),
   minimum context window, and whether reasoning is needed (`needsReasoning`).
3. Remaining candidates are ordered by accumulated evidence: past successes raise
   a candidate, past failures lower it, repeated consecutive failures
   (`consecutiveFailures` reaching the verified-failure threshold) remove it
   from this round, and lower latency and lower cost break near-ties.
4. The order is deterministic: identical evidence plus identical task always
   yields the identical route.

## Fallback bounds

At most three candidates are attempted per turn, plus at most one delegation to
the previously active model. When every candidate is penalized, the pool is
still returned (bounded retries prevent loops) rather than routing nothing.
When no candidate is eligible and no previous model exists, the turn completes
with an explicit message instead of crashing.

## Thinking budget

Thinking level follows the routed model with a minimum-sufficient rule:
non-reasoning tasks prefer cheaper non-reasoning models; reasoning-flagged tasks
take the reasoning path with a higher level. Output tokens are capped per turn;
high context usage triggers compaction-friendly trimming.
