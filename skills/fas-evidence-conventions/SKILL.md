---
name: fas-evidence-conventions
description: Structured child-result envelope (fas-result block) and FAS role rules for Pi sub-agent children. Read when spawning role children or validating child evidence.
---

# FAS Evidence Conventions (declarative reference — no executable logic here)

## Child-result envelope

Role-spawned children end the final answer with a fenced block:

````text
```fas-result
{"status": "ok"|"fail"|"blocked", "report": "<markdown>",
 "files_modified": [], "files_created": [], "tests_run": [],
 "problems": [], "conflicts": []}
```
````

- `status`: `ok` (done), `fail` (attempted, did not complete), `blocked` (cannot proceed).
- `report`: required non-empty Markdown summary.
- List fields (`files_modified`, `files_created`, `tests_run`, `problems`,
  `conflicts`): arrays of strings, may be empty. Honest failure uses `fail` /
  `blocked` with `problems` filled — never an empty success.
- Optional `data`: extra object for forward-compatible detail.

The parent validates the block and attaches it to delivery details. Payloads
without the block pass through unchanged as unstructured text.

## Roles

Declared explicitly by the orchestrator (never inferred):

- `explorer`: cheap direct lookup; minimal evidence required.
- `implementer`: general build work; full evidence pool decides routing.
- `tester`: repeatable verification; on `ok` MUST include non-empty `tests_run`.
- `reviewer`: needs large context; reports on `files_modified` / `files_created`.
- `debugger`: diagnostic work on the reasoning path.

Unknown role names are rejected. There is no automatic role classifier.
