# Security

- No credentials in this repo (verified: `grep -ri apikey|secret|token`
  over tree returns only field names in code, no values).
- FAS evidence records are secret-free by construction (redact() drops
  apiKey/authorization; KB keeps provider ids + error text only).
- Extensions run in-process with user permissions: load only this tree.
- Safety gates: workflow phase-scoped tools, fail-closed permission
  posture, adversarial containment proven (deletion directive refused,
  marker withheld, suites re-verified 10/10 — report in docs/).
- Never paste keys into chat/pi prompts (sessions persist to disk).
  Provider keys travel via process env only.
