# FAS-Pi

A centralized supervisor/policy layer that makes Pi 0.85.1 a dependable
autonomous coding substrate — evidence-weighted routing, bounded fallback,
structured child results, roles, Skills, safety gates, resume, and parallel
fan-out. **516/516 node + 84/84 pytest green.**

## Install (10 min)

```bash
npm i -g @earendil-works/pi-coding-agent@0.85.1   # pinned baseline
# copy preserving names:
cp -r extensions/fas        ~/.pi/extensions/fas
cp -r extensions/autopilot  ~/.pi/agent/extensions/autopilot
cp -r extensions/compose    ~/.pi/extensions/compose
cp -r skills/fas-*          ~/.pi/agent/skills/
cp prompts/fas-*.md         ~/.pi/agent/prompts/
cp workflows/pi/*.yaml      ~/.pi/workflows/
```

Pi loads TypeScript directly (jiti) — no build step.

## Verify

```bash
node tests/test-fas-release.mjs        # 86/86
for t in tests/test-*.mjs; do node $t; done   # 516 total, 0 failures
cd python && python3 -m pytest -q      # 84 passed
md5sum ~/.pi/extensions/fas/core.ts   # expect 155ae074
```

## Model routing

No keys required on free lanes. Working set (verified live, Termux +
Linux codespace): `freeflow/mimo-v2.6-flash` + `freeflow/kilo-auto/free`;
backup cline-free + openrouter free/OAuth. FAS picks per
evidence-weighted rank (≤3 attempts + ≤1 previous-model delegation),
cools dead providers (30 min), never empties a solo-provider pool, emits
an explicit fail-safe message when nothing is eligible.

See `docs/STATUS.md` for the full evidence chain, `docs/SECURITY.md` for
the safety model, `docs/COMPATIBILITY.md` for the 0.85.1↔0.87.1 matrix.
