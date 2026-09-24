"""Autonomous GitHub CI recovery bridge for FAS."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

from fas_git import ensure_fas_excluded
from fas_github import resolve_repository

_FAILED_PATH = re.compile(r"\bFAILED\s+([^\s:]+)(?:::|$)")
_TRACE_PATH = re.compile(r'\bFile "([^"]+)"')


def failed_logs(
    repository: str,
    run_id: int,
    *,
    runner=subprocess.run,
) -> str:
    repository = resolve_repository(repository, runner=runner)
    result = runner(
        ["gh", "run", "view", str(run_id), "--repo", repository, "--log-failed"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def persist_failure_logs(repo: str | Path, logs: str) -> Path:
    root = Path(repo).expanduser().resolve()
    ensure_fas_excluded(str(root))
    target = root / ".fas" / "logs" / "ci-failure.log"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(logs, encoding="utf-8")
    return target


def _resolve_evidence_path(repo: Path, raw_path: str) -> Path | None:
    candidate = Path(raw_path)
    if candidate.is_absolute():
        try:
            candidate.relative_to(repo)
        except ValueError:
            return None
        return candidate
    direct = repo / candidate
    if direct.is_file():
        return direct
    matches = [
        path
        for path in repo.rglob(candidate.name)
        if path.is_file() and ".git" not in path.parts and ".fas" not in path.parts
    ]
    return matches[0] if len(matches) == 1 else None


def recovery_scope(repo: str | Path, logs: str) -> tuple[str, ...]:
    """Infer a conservative file/directory scope from concrete CI paths."""
    root = Path(repo).expanduser().resolve()
    raw_paths = _FAILED_PATH.findall(logs) + _TRACE_PATH.findall(logs)
    resolved = []
    for raw in raw_paths:
        path = _resolve_evidence_path(root, raw)
        if path is not None:
            resolved.append(path)
    unique = []
    seen = set()
    for path in resolved:
        relative = path.relative_to(root).as_posix()
        scope = relative if path.parent == root else f"{path.parent.relative_to(root).as_posix()}/"
        if scope not in seen:
            unique.append(scope)
            seen.add(scope)
    return tuple(unique)


def build_repair_task(log_path: str | Path, allowed_paths: tuple[str, ...] = ()) -> str:
    path = Path(log_path)
    scope_text = ", ".join(allowed_paths) if allowed_paths else "UNKNOWN"
    return (
        "Repair the current repository using the recorded CI failure. "
        "Read the CI log at {log}. Identify the root cause from fresh evidence, "
        "make the smallest YAGNI-compliant fix, preserve existing behavior and "
        "tests, and run the repository test command before finishing. The declared "
        "recovery scope is: {scope}. Do not modify files outside that scope unless "
        "the scope is explicitly expanded by the controller. Do not reset, clean, "
        "force-push, delete unrelated work, or modify secrets."
    ).format(log=path, scope=scope_text)


def recover_once(
    repository: str,
    run_id: int,
    *,
    repair_runner,
) -> int:
    """Persist CI evidence and delegate one bounded repair attempt."""
    logs = failed_logs(repository, run_id)
    log_path = persist_failure_logs(repository, logs)
    allowed_paths = recovery_scope(repository, logs)
    if not allowed_paths:
        return 77
    old_scope = os.environ.get("FAS_ALLOWED_PATHS")
    try:
        os.environ["FAS_ALLOWED_PATHS"] = "\n".join(allowed_paths)
        return repair_runner(build_repair_task(log_path, allowed_paths))
    finally:
        if old_scope is None:
            os.environ.pop("FAS_ALLOWED_PATHS", None)
        else:
            os.environ["FAS_ALLOWED_PATHS"] = old_scope
