"""Persist GitHub Actions outcome as durable FAS evidence."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

FAILURE_CLASSES = {
    "failure": "unknown_failure",
    "cancelled": "workflow_configuration_failure",
    "timed_out": "environment_or_toolchain_failure",
}


def classify(conclusion: str | None) -> str:
    normalized = (conclusion or "").lower()
    if normalized == "success":
        return "success"
    return FAILURE_CLASSES.get(normalized, "unknown_failure")


def _default_conclusion() -> str:
    explicit = os.environ.get("JOB_CONCLUSION")
    if explicit:
        return explicit
    test_status = os.environ.get("TEST_STATUS")
    if test_status is not None:
        return "success" if test_status == "0" else "failure"
    return "failure"


def write_ci_evidence(
    repo: str | Path,
    *,
    run_id: str | None = None,
    conclusion: str | None = None,
) -> Path:
    root = Path(repo).expanduser().resolve()
    target = root / ".fas" / "verification" / "ci_result.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    resolved_conclusion = conclusion or _default_conclusion()
    payload = {
        "schema_version": 1,
        "provider": "github_actions",
        "repository": os.environ.get("GITHUB_REPOSITORY"),
        "workflow": os.environ.get("GITHUB_WORKFLOW"),
        "run_id": run_id or os.environ.get("GITHUB_RUN_ID"),
        "sha": os.environ.get("GITHUB_SHA"),
        "ref": os.environ.get("GITHUB_REF_NAME"),
        "conclusion": resolved_conclusion,
        "failure_class": classify(resolved_conclusion),
        "recorded_at": int(time.time()),
    }
    temp = target.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(target)
    return target
