---
description: Capture a FAS bare-parent router probe and classify the failure
argument-hint: "[probe words]"
---
Run exactly one bounded probe (timeout <= 110s): `pi --no-approve --no-session --model fas-router/auto -e ~/.pi/extensions/fas/index.ts -p "<probe words or 'Reply with the single word PARENT-OK'>"`. Then read the last 4 entries of `~/.pi/agent/fas-knowledge.json` recent list and report: (1) the probe's verdict line, (2) which provider/id lanes were burned with kind/reason/lastError/lastStatus, (3) classification: AUTH (401/no-auth), CREDIT (402/paid/add-credits), NETWORK (timeouts, 000, connection), THROWN (execution:unknown with a lastError message — quote it), or UNKNOWN (execution:unknown, no lastError — flag as observability gap). Do not retry more than once; do not modify any source, test, or state file.
