from fas_github import WorkflowRun
from fas_orchestrator import bounded_ci_cycle


def _run(status, conclusion):
    return WorkflowRun(1, status, conclusion, "abc", "FAS CI")


def test_success_stops_without_repair():
    repairs = []
    result = bounded_ci_cycle(
        max_attempts=3,
        wait_for_run=lambda attempt: _run("completed", "success"),
        repair=lambda run: repairs.append(run) or True,
    )
    assert result.status == "success"
    assert result.attempts == 1
    assert repairs == []


def test_actionable_failure_gets_bounded_repair_attempts():
    repairs = []
    result = bounded_ci_cycle(
        max_attempts=3,
        wait_for_run=lambda attempt: _run("completed", "failure"),
        repair=lambda run: repairs.append(run) or True,
    )
    assert result.status == "retry_budget_exhausted"
    assert result.attempts == 3
    assert len(repairs) == 2


def test_repair_veto_stops_loop():
    result = bounded_ci_cycle(
        max_attempts=3,
        wait_for_run=lambda attempt: _run("completed", "failure"),
        repair=lambda run: False,
    )
    assert result.status == "repair_rejected"
    assert result.attempts == 1


def test_non_actionable_failure_stops_immediately():
    result = bounded_ci_cycle(
        max_attempts=3,
        wait_for_run=lambda attempt: _run("completed", "timed_out"),
        repair=lambda run: True,
    )
    assert result.status == "stopped_non_actionable"
    assert result.attempts == 1


def test_pending_does_not_trigger_repair():
    repairs = []
    result = bounded_ci_cycle(
        max_attempts=3,
        wait_for_run=lambda attempt: _run("in_progress", None),
        repair=lambda run: repairs.append(run) or True,
    )
    assert result.status == "pending"
    assert repairs == []
