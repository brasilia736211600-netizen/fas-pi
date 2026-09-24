# Install

Requirements: Pi **0.85.1**, Node 26, no API keys (free lanes).

```bash
npm i -g @earendil-works/pi-coding-agent@0.85.1
git clone <this-repo> fas-pi && cd fas-pi
./python/install_fas.sh   # or copy dirs manually per README
```

Manual copy (preserving names):

| Repo path | Target |
|---|---|
| `extensions/fas/` | `~/.pi/extensions/fas/` |
| `extensions/autopilot/` | `~/.pi/agent/extensions/autopilot/` |
| `extensions/compose/` | `~/.pi/extensions/compose/` |
| `skills/fas-*/` | `~/.pi/agent/skills/` |
| `prompts/fas-*.md` | `~/.pi/agent/prompts/` |
| `workflows/pi/*.yaml` | `~/.pi/workflows/` |

Workflow/subagents seams live in the pi-enhanced checkout (2E/2F/B/E/F/P
fingerprints in docs/STATUS.md) — upstream h4ni0/pi + local edits, not
vendored here.

Verify: `for t in tests/test-*.mjs; do node $t; done` (516/516),
`python3 -m pytest -q` in `python/` (84/84), fingerprints in README.
