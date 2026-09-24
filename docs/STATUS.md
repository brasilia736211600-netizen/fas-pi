# Status (publish-time evidence, 2026-09-24)

- Regression: **516/516 node + 84/84 pytest, 0 failures.**
- Router: F1 observability (T16), F3 within-turn breaker (T17),
  status-from-text (T18), provider cooldown (F7), breaker fail-safe (F8),
  extension-lane visibility (D8).
- Live E2E chain (all PASS): Termux, purist parent-routed, cloud Linux,
  mimo rotation, Q8-trial Termux, Q8-trial cloud; practical autopilot
  trial 10/10 incl. held-out suite + adversarial containment.
- Working lanes: freeflow/mimo-v2.6-flash + freeflow/kilo-auto/free
  (no key); backup cline-free + openrouter; omniroute PARKED.
- Fingerprints: core `155ae074`, index `73239dde`, roles `8395d510`,
  runner `c20f921d`, schema `f95a471c`.
- Full evidence: FAS-Auto-Test `docs/FAS_PI/reports/` (30 reports) +
  checkpoints/LIVE.md.
