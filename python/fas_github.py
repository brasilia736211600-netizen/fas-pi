"""Minimal GitHub Actions bridge for FAS running on Termux/Linux."""
from __future__ import annotations

from builtins import TimeoutError

import json
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence
from urllib.parse import urlparse


@dataclass(frozen=True)
class WorkflowRun:
    database_id: int
    status: str
    conclusion: str | None
    head_sha: str
    workflow_name: str


def _run_json(
    command: Sequence[str],
    *,
    runner=subprocess.run,
) -> object:
    completed = runner(command, check=True, capture_output=True, text=True)
    return json.loads(completed.stdout)


def resolve_repository(
    repository: str,
    *,
    runner=subprocess.run,
) -> str:
    """Return an OWNER/REPO GitHub identity for a local path or explicit repo."""
    candidate = Path(repository).expanduser()
    if not candidate.exists() and re.fullmatch(r"[^/\s]+/[^/\s]+", repository):
        return repository

    root = candidate.resolve()
    remote = runner(
        ["git", "-C", str(root), "remote", "get-url", "origin"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not remote:
        raise ValueError(f"repository has no origin remote: {root}")

    if remote.startswith("git@github.com:"):
        path = remote.removeprefix("git@github.com:")
        host = "github.com"
    else:
        parsed = urlparse(remote)
        host = parsed.hostname or ""
        path = parsed.path.lstrip("/")

    if host.lower() != "github.com":
        raise ValueError(f"origin is not a GitHub repository: {remote}")

    path = path.removesuffix(".git").strip("/")
    if not re.fullmatch(r"[^/]+/[^/]+", path):
        raise ValueError(f"could not resolve GitHub OWNER/REPO from origin: {remote}")
    return path


def find_run(
    repository: str,
    sha: str,
    *,
    runner=subprocess.run,
) -> WorkflowRun | None:
    """Find the newest GitHub Actions run for a pushed commit."""
    repository = resolve_repository(repository, runner=runner)
    data = _run_json(
        [
            "gh",
            "run",
            "list",
            "--repo",
            repository,
            "--commit",
            sha,
            "--json",
            "databaseId,status,conclusion,headSha,workflowName",
            "--limit",
            "10",
        ],
        runner=runner,
    )
    if not isinstance(data, list):
        raise ValueError("gh returned an invalid workflow run payload")
    for item in data:
        if item.get("headSha") == sha:
            return WorkflowRun(
                database_id=int(item["databaseId"]),
                status=str(item["status"]),
                conclusion=item.get("conclusion"),
                head_sha=str(item["headSha"]),
                workflow_name=str(item["workflowName"]),
            )
    return None


def view_run(
    repository: str,
    run_id: int,
    *,
    runner=subprocess.run,
) -> WorkflowRun:
    repository = resolve_repository(repository, runner=runner)
    data = _run_json(
        [
            "gh",
            "run",
            "view",
            str(run_id),
            "--repo",
            repository,
            "--json",
            "databaseId,status,conclusion,headSha,workflowName",
        ],
        runner=runner,
    )
    return WorkflowRun(
        database_id=int(data["databaseId"]),
        status=str(data["status"]),
        conclusion=data.get("conclusion"),
        head_sha=str(data["headSha"]),
        workflow_name=str(data["workflowName"]),
    )


def classify_run(run: WorkflowRun) -> str:
    if run.status in {"queued", "in_progress"}:
        return "pending"
    if run.conclusion == "success":
        return "success"
    if run.conclusion == "failure":
        return "failure"
    if run.conclusion in {"cancelled", "timed_out"}:
        return "non_actionable"
    return "unknown"


def dispatch_workflow(
    repository: str,
    workflow: str,
    *,
    ref: str = "main",
    fields: dict | None = None,
    runner=subprocess.run,
) -> int:
    """Trigger a workflow_dispatch run, return the newest run id for it."""
    repository = resolve_repository(repository, runner=runner)
    command = ["gh", "workflow", "run", workflow, "--repo", repository, "--ref", ref]
    for key, value in (fields or {}).items():
        command += ["-f", f"{key}={value}"]
    runner(command, check=True, capture_output=True, text=True)
    data = _run_json(
        [
            "gh",
            "run",
            "list",
            "--repo",
            repository,
            "--workflow",
            workflow,
            "--limit",
            "1",
            "--json",
            "databaseId",
        ],
        runner=runner,
    )
    if not isinstance(data, list) or not data:
        raise ValueError("no run found after dispatch")
    return int(data[0]["databaseId"])


def wait_run(
    repository: str,
    run_id: int,
    *,
    runner=subprocess.run,
    sleeper: Callable[[float], None] = time.sleep,
    interval_s: float = 15.0,
    timeout_s: float = 600.0,
) -> WorkflowRun:
    """Poll until the run completes; bounded attempts, raise TimeoutError."""
    attempts = 0
    while True:
        run = view_run(repository, run_id, runner=runner)
        if run.status == "completed":
            return run
        attempts += 1
        if attempts * interval_s >= timeout_s:
            raise TimeoutError(f"run {run_id} still {run.status} after {timeout_s}s")
        sleeper(interval_s)


def download_artifacts(
    repository: str,
    run_id: int,
    dest: str,
    *,
    runner=subprocess.run,
) -> str:
    """Download all artifacts of a run into dest, return dest."""
    import sys

    repository = resolve_repository(repository, runner=runner)
    try:
        runner(
            ["gh", "run", "download", str(run_id), "--repo", repository, "--dir", dest],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        print(f"warning: artifact download skipped: {exc.stderr.strip() or exc}", file=sys.stderr)
    Path(dest).mkdir(parents=True, exist_ok=True)
    return dest
