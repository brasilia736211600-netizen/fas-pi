"""Deterministic bounded control loop for FAS."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from fas_github import WorkflowRun, classify_run


@dataclass(frozen=True)
class CycleResult:
    status: str
    attempts: int
    last_run: WorkflowRun | None


def bounded_ci_cycle(
    *,
    max_attempts: int,
    wait_for_run: Callable[[int], WorkflowRun | None],
    repair: Callable[[WorkflowRun], bool],
) -> CycleResult:
    """Evaluate CI and invoke repair only for actionable failures.

    ``wait_for_run`` is responsible for obtaining the workflow result for each
    attempt. The controller itself never loops past ``max_attempts``.
    """
    if max_attempts < 1:
        raise ValueError("max_attempts must be positive")

    last_run = None
    for attempt in range(1, max_attempts + 1):
        run = wait_for_run(attempt)
        last_run = run
        if run is None:
            return CycleResult("unknown", attempt, None)
        outcome = classify_run(run)
        if outcome == "success":
            return CycleResult("success", attempt, run)
        if outcome == "non_actionable":
            return CycleResult("stopped_non_actionable", attempt, run)
        if outcome == "failure":
            if attempt == max_attempts:
                return CycleResult("retry_budget_exhausted", attempt, run)
            if not repair(run):
                return CycleResult("repair_rejected", attempt, run)
            continue
        if outcome == "pending":
            return CycleResult("pending", attempt, run)
        return CycleResult("unknown", attempt, run)

    return CycleResult("retry_budget_exhausted", max_attempts, last_run)
