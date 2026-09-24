import pytest

from fas_github import WorkflowRun
from fas_git import PUSH_FAILED_CODE, SCOPE_VIOLATION_CODE
from fas_watch import RecoveryBudgetExceeded, watch_and_recover


def test_watch_returns_success_for_completed_run(monkeypatch):
    monkeypatch.setattr("fas_watch.current_sha", lambda repository, runner=None: "abc")
    monkeypatch.setattr(
        "fas_watch.find_run",
        lambda repository, sha, runner=None: WorkflowRun(1, "completed", "success", sha, "FAS CI"),
    )
    assert watch_and_recover("owner/repo", repair_runner=lambda task: 0, runner=lambda *a, **k: None) == "success"


def test_watch_recovers_and_then_accepts_new_passing_commit(monkeypatch):
    shas = iter(["abc", "def"])
    monkeypatch.setattr("fas_watch.current_sha", lambda repository, runner=None: next(shas))
    runs = iter([
        WorkflowRun(7, "completed", "failure", "abc", "FAS CI"),
        WorkflowRun(8, "completed", "success", "def", "FAS CI"),
    ])
    monkeypatch.setattr("fas_watch.find_run", lambda repository, sha, runner=None: next(runs))
    seen = []
    monkeypatch.setattr(
        "fas_watch.recover_once",
        lambda repository, run_id, repair_runner: seen.append((repository, run_id)) or 0,
    )
    assert watch_and_recover("owner/repo", repair_runner=lambda task: 0, runner=lambda *a, **k: None) == "success"
    assert seen == [("owner/repo", 7)]


def test_watch_stops_when_repair_fails(monkeypatch):
    monkeypatch.setattr("fas_watch.current_sha", lambda repository, runner=None: "abc")
    monkeypatch.setattr(
        "fas_watch.find_run",
        lambda repository, sha, runner=None: WorkflowRun(7, "completed", "failure", sha, "FAS CI"),
    )
    monkeypatch.setattr("fas_watch.recover_once", lambda *args, **kwargs: 1)
    assert watch_and_recover("owner/repo", repair_runner=lambda task: 1, runner=lambda *a, **k: None) == "repair_failed"


def test_watch_stops_on_scope_violation(monkeypatch):
    monkeypatch.setattr("fas_watch.current_sha", lambda repository, runner=None: "abc")
    monkeypatch.setattr(
        "fas_watch.find_run",
        lambda repository, sha, runner=None: WorkflowRun(7, "completed", "failure", sha, "FAS CI"),
    )
    monkeypatch.setattr("fas_watch.recover_once", lambda *args, **kwargs: SCOPE_VIOLATION_CODE)
    assert watch_and_recover("owner/repo", repair_runner=lambda task: 77, runner=lambda *a, **k: None) == "scope_violation"


def test_watch_stops_on_push_failure(monkeypatch):
    monkeypatch.setattr("fas_watch.current_sha", lambda repository, runner=None: "abc")
    monkeypatch.setattr(
        "fas_watch.find_run",
        lambda repository, sha, runner=None: WorkflowRun(7, "completed", "failure", sha, "FAS CI"),
    )
    monkeypatch.setattr("fas_watch.recover_once", lambda *args, **kwargs: PUSH_FAILED_CODE)
    assert watch_and_recover("owner/repo", repair_runner=lambda task: 78, runner=lambda *a, **k: None) == "push_failed"


def test_watch_rejects_repair_without_new_commit(monkeypatch):
    monkeypatch.setattr("fas_watch.current_sha", lambda repository, runner=None: "abc")
    monkeypatch.setattr(
        "fas_watch.find_run",
        lambda repository, sha, runner=None: WorkflowRun(7, "completed", "failure", sha, "FAS CI"),
    )
    monkeypatch.setattr("fas_watch.recover_once", lambda *args, **kwargs: 0)
    assert watch_and_recover("owner/repo", repair_runner=lambda task: 0, runner=lambda *a, **k: None) == "repair_not_pushed"


def test_watch_never_repairs_non_actionable_runs(monkeypatch):
    monkeypatch.setattr("fas_watch.current_sha", lambda repository, runner=None: "abc")
    monkeypatch.setattr(
        "fas_watch.find_run",
        lambda repository, sha, runner=None: WorkflowRun(7, "completed", "timed_out", sha, "FAS CI"),
    )
    called = []
    monkeypatch.setattr("fas_watch.recover_once", lambda *args, **kwargs: called.append(1) or 0)
    assert watch_and_recover("owner/repo", repair_runner=lambda task: 0, runner=lambda *a, **k: None) == "non_actionable"
    assert called == []


def test_watch_rejects_zero_budget():
    with pytest.raises(ValueError, match="positive"):
        watch_and_recover("owner/repo", max_attempts=0, repair_runner=lambda task: 0)


def test_watch_allows_up_to_three_recovery_attempts(monkeypatch):
    shas = iter(["abc", "def", "ghi", "jkl"])
    monkeypatch.setattr("fas_watch.current_sha", lambda repository, runner=None: next(shas))
    monkeypatch.setattr("fas_watch.recover_once", lambda *args, **kwargs: 0)
    runs = iter([
        WorkflowRun(7, "completed", "failure", "abc", "FAS CI"),
        WorkflowRun(8, "completed", "failure", "def", "FAS CI"),
        WorkflowRun(9, "completed", "failure", "ghi", "FAS CI"),
        WorkflowRun(10, "completed", "failure", "jkl", "FAS CI"),
    ])
    monkeypatch.setattr("fas_watch.find_run", lambda repository, sha, runner=None: next(runs))
    with pytest.raises(RecoveryBudgetExceeded):
        watch_and_recover("owner/repo", max_attempts=3, repair_runner=lambda task: 0, runner=lambda *a, **k: None)
