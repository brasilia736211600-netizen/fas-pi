---
description: FAS router health from local knowledge (no live quota)
argument-hint: "[provider]"
---
Read `~/.pi/agent/fas-knowledge.json` with bash/python (never print raw keys or secrets — it holds none, but summarize only). Report: (1) top-5 lanes by successes with consecutive-failure counts, (2) lanes at consec>=1 grouped by provider with last error/reason (include lastError/lastStatus when present), (3) whether any lane reached the verified-failure threshold (consec>=3), (4) one-line verdict: ROUTER-HEALTHY, DEGRADED (some lanes failing), or BURNING (fresh lanes failing every turn). If a provider argument is given (e.g. `/fas-status kilo`), scope the report to that provider. Keep it under 25 lines.
