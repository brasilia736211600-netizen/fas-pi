"""Portable FAS runtime primitives."""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Any

from fas_git import ensure_fas_excluded
from model_router import TaskSignals, route

STATE_VERSION = 1
DEFAULT_MAX_ATTEMPTS = 3


def repo_root(path: str | Path) -> Path:
    candidate = Path(path).expanduser().resolve()
    completed = subprocess.run(
        ["git", "-C", str(candidate), "rev-parse", "--show-toplevel"],
        check=True,
        capture_output=True,
        text=True,
    )
    return Path(completed.stdout.strip()).resolve()


def state_path(repo: str | Path) -> Path:
    return repo_root(repo) / ".fas" / "state.json"


def initial_state(repo: str | Path) -> dict[str, Any]:
    root = repo_root(repo)
    now = int(time.time())
    return {
        "schema_version": STATE_VERSION,
        "repository": str(root),
        "task_id": None,
        "phase": "READ",
        "attempt": 0,
        "max_attempts": DEFAULT_MAX_ATTEMPTS,
        "route": None,
        "artifacts": [],
        "test": {"command": None, "result": None, "duration_seconds": None},
        "verification": {"status": "pending", "evidence": []},
        "git": {"branch": None, "commit_sha": None},
        "ci": {"run_id": None, "result": None},
        "failure": {"class": None, "message": None},
        "timestamps": {"created": now, "updated": now},
    }


def write_state(repo: str | Path, state: dict[str, Any]) -> Path:
    path = state_path(repo)
    path.parent.mkdir(parents=True, exist_ok=True)
    timestamps = state.setdefault("timestamps", {})
    timestamps.setdefault("created", int(time.time()))
    timestamps["updated"] = int(time.time())
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(path)
    return path


def read_state(repo: str | Path) -> dict[str, Any]:
    path = state_path(repo)
    if not path.exists():
        return initial_state(repo)
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != STATE_VERSION:
        raise ValueError("unsupported FAS state schema version")
    return data


def init_repository(repo: str | Path) -> Path:
    root = repo_root(repo)
    ensure_fas_excluded(str(root))
    state = initial_state(root)
    try:
        branch = subprocess.run(
            ["git", "-C", state["repository"], "branch", "--show-current"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        state["git"]["branch"] = branch or None
    except subprocess.CalledProcessError:
        pass
    return write_state(root, state)


def select_route(repo: str | Path, signals: TaskSignals) -> dict[str, str]:
    state = read_state(repo)
    decision = route(signals)
    state["route"] = {
        "capability": decision.capability.value,
        "model": decision.model,
        "reason": decision.reason,
    }
    write_state(repo, state)
    return state["route"]


def record_test(repo: str | Path, command: str, result: str, duration_seconds: float) -> Path:
    state = read_state(repo)
    state["test"] = {
        "command": command,
        "result": result,
        "duration_seconds": round(duration_seconds, 3),
    }
    state["phase"] = "TEST"
    return write_state(repo, state)
