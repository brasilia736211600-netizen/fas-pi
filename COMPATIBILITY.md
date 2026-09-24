# Compatibility

- Production baseline: **Pi 0.85.1** (pinned).
- 0.87.1 matrix (real d.ts diff): all 6 FAS event subscriptions exist in
  0.87 `on()` overloads; `shouldStopAfterTurn` migration not needed (zero
  references); modelRegistry surface identical; runner sessionManager calls
  safe. `TurnEndEvent` gains `BoundaryState` (low runtime risk — one live
  0.87 turn still required to confirm).
- Opportunities (adopt only with live proof): `AgentBeforeSettleEvent`,
  `ContextEditEntry`, `context_with_system`.
- Rule: never move the baseline until 0.87 live-turn parity + /compose
  invariance are proven.
