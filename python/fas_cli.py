"""Minimal portable command-line entry point for FAS."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

from fas_fallback import candidate_models, run_with_fallback
from fas_git import (
    PUSH_FAILED_CODE,
    SCOPE_VIOLATION_CODE,
    PushFailedError,
    ScopeViolationError,
    changed_after,
    commit_if_changed,
    safe_push,
    status_porcelain,
)
from fas_runtime import init_repository, read_state, record_test, select_route, write_state
from fas_watch import watch_and_recover
from model_router import TaskSignals, available_models


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fas")
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="initialize durable FAS state")
    init.add_argument("repo", nargs="?", default=".")
    run = sub.add_parser("run", help="run one task through OpenCode")
    run.add_argument("task")
    run.add_argument("--repo", default=".")
    run.add_argument("--files-changed", type=int, default=1)
    run.add_argument("--ambiguity", type=int, default=0)
    run.add_argument("--architecture-impact", action="store_true")
    run.add_argument("--recovery", action="store_true")
    run.add_argument("--exploration", action="store_true")
    run.add_argument("--critical-review", action="store_true")
    run.add_argument("--latency-sensitive", action="store_true")
    run.add_argument("--test-cmd")
    watch = sub.add_parser("watch", help="watch CI for HEAD and perform bounded recovery")
    watch.add_argument("--repo", default=".")
    watch.add_argument("--max-attempts", type=int, default=3)
    watch.add_argument("--poll-limit", type=int, default=60)
    watch.add_argument("--poll-seconds", type=float, default=5.0)
    watch.add_argument("--test-cmd")
    offload = sub.add_parser("offload", help="run a heavy job on GitHub Actions instead of this phone")
    offload.add_argument("--repo", default=".")
    offload.add_argument("--workflow", default="cloud-offload.yml")
    offload.add_argument("--ref", default="main")
    offload.add_argument("--field", action="append", default=[], metavar="KEY=VALUE")
    offload.add_argument("--timeout", type=float, default=1800.0)
    offload.add_argument("--poll-seconds", type=float, default=30.0)
    offload.add_argument("--download", default=None, metavar="DIR")
    return parser


def _run_task(args: argparse.Namespace) -> int:
    repo = Path(args.repo).expanduser().resolve()
    state_file = repo / ".fas" / "state.json"
    if not state_file.exists():
        init_repository(repo)
    state = read_state(repo)

    signals = TaskSignals(
        files_changed=args.files_changed,
        ambiguity=args.ambiguity,
        architecture_impact=args.architecture_impact,
        recovery=args.recovery,
        exploration=args.exploration,
        critical_review=args.critical_review,
        latency_sensitive=args.latency_sensitive,
    )
    planned_route = select_route(repo, signals)
    configured = available_models()[planned_route["capability"]]
    override = os.environ.get("FAS_MODEL")
    candidates = tuple(
        dict.fromkeys(
            ((override,) if override else ())
            + candidate_models(_route_decision(planned_route), configured)
        )
    )
    baseline = status_porcelain(str(repo))

    def retry_only_if_repository_unchanged(_attempt: object) -> bool:
        return not changed_after(str(repo), baseline)

    result = run_with_fallback(
        lambda model: ["opencode", "run", "--auto", "--model", model, "--agent", "build", args.task],
        candidates,
        cwd=str(repo),
        max_attempts=state.get("max_attempts", 3),
        should_retry=retry_only_if_repository_unchanged,
    )

    state = read_state(repo)
    state["phase"] = "EXECUTE"
    state["attempt"] = len(result.attempts)
    state["route"] = dict(planned_route)
    state["route"]["effective_model"] = result.selected_model
    state["route"]["attempts"] = [
        {
            "model": attempt.model,
            "returncode": attempt.returncode,
            "duration_seconds": round(attempt.duration_seconds, 3),
        }
        for attempt in result.attempts
    ]
    write_state(repo, state)

    if not result.success:
        return result.attempts[-1].returncode if result.attempts else 1

    test_cmd = args.test_cmd or os.environ.get("FAS_TEST_CMD")
    if test_cmd:
        test_start = time.monotonic()
        test = subprocess.run(test_cmd, cwd=repo, shell=True, check=False)
        record_test(
            repo,
            test_cmd,
            "PASS" if test.returncode == 0 else f"FAIL:{test.returncode}",
            time.monotonic() - test_start,
        )
        if test.returncode != 0:
            return test.returncode

    if os.environ.get("FAS_COMMIT") == "1":
        allowed_paths = None
        if args.recovery:
            allowed_paths = tuple(
                path.strip()
                for path in os.environ.get("FAS_ALLOWED_PATHS", "").splitlines()
                if path.strip()
            )
            if not allowed_paths:
                state = read_state(repo)
                state.setdefault("failure", {})["class"] = "scope_unknown"
                write_state(repo, state)
                return SCOPE_VIOLATION_CODE
        try:
            commit_sha = commit_if_changed(
                str(repo),
                os.environ.get("FAS_COMMIT_MESSAGE", "chore: FAS autonomous change"),
                allowed_paths=allowed_paths,
            )
        except ScopeViolationError:
            state = read_state(repo)
            state.setdefault("failure", {})["class"] = "scope_violation"
            write_state(repo, state)
            return SCOPE_VIOLATION_CODE
        state = read_state(repo)
        state["git"]["commit_sha"] = commit_sha
        write_state(repo, state)

    if os.environ.get("FAS_PUSH") == "1":
        try:
            safe_push(str(repo))
        except PushFailedError:
            state = read_state(repo)
            state.setdefault("failure", {})["class"] = "push_failed"
            write_state(repo, state)
            return PUSH_FAILED_CODE

    return 0


def _watch(args: argparse.Namespace) -> int:
    repo = str(Path(args.repo).expanduser().resolve())
    test_cmd = args.test_cmd or os.environ.get("FAS_TEST_CMD")

    def repair_runner(task: str) -> int:
        old_commit = os.environ.get("FAS_COMMIT")
        old_push = os.environ.get("FAS_PUSH")
        try:
            os.environ["FAS_COMMIT"] = "1"
            os.environ["FAS_PUSH"] = "1"
            argv = ["run", task, "--repo", repo, "--recovery"]
            if test_cmd:
                argv.extend(["--test-cmd", test_cmd])
            return main(argv)
        finally:
            if old_commit is None:
                os.environ.pop("FAS_COMMIT", None)
            else:
                os.environ["FAS_COMMIT"] = old_commit
            if old_push is None:
                os.environ.pop("FAS_PUSH", None)
            else:
                os.environ["FAS_PUSH"] = old_push

    result = watch_and_recover(
        repo,
        max_attempts=args.max_attempts,
        poll_limit=args.poll_limit,
        poll_seconds=args.poll_seconds,
        repair_runner=repair_runner,
    )
    print(result)
    return 0


def _offload(args: argparse.Namespace) -> int:
    from fas_github import classify_run, dispatch_workflow, download_artifacts, wait_run

    fields: dict[str, str] = {}
    for item in args.field or []:
        if "=" not in item:
            print(f"bad --field (want KEY=VALUE): {item}", file=sys.stderr)
            return 2
        key, value = item.split("=", 1)
        fields[key.strip()] = value
    run_id = dispatch_workflow(args.repo, args.workflow, ref=args.ref, fields=fields)
    print(f"dispatched run {run_id}")
    try:
        run = wait_run(
            args.repo,
            run_id,
            interval_s=args.poll_seconds,
            timeout_s=args.timeout,
        )
    except TimeoutError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    print(f"conclusion: {classify_run(run)}")
    if args.download:
        print(download_artifacts(args.repo, run_id, args.download))
    return 0 if run.conclusion == "success" else 1


def _route_decision(route: dict[str, str]):
    from model_router import Capability, RouteDecision

    return RouteDecision(Capability(route["capability"]), route["model"], route["reason"])


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "init":
        print(init_repository(args.repo))
        return 0
    if args.command == "watch":
        return _watch(args)
    if args.command == "offload":
        return _offload(args)
    return _run_task(args)


if __name__ == "__main__":
    sys.exit(main())