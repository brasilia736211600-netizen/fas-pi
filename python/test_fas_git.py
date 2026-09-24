import subprocess

import pytest

from fas_git import (
    PUSH_FAILED_CODE,
    PushFailedError,
    ScopeViolationError,
    assert_clean,
    changed_after,
    commit_if_changed,
    ensure_fas_excluded,
    safe_push,
    status_porcelain,
)


def _run_status(monkeypatch, output=""):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda command, **kwargs: subprocess.CompletedProcess(command, 0, output, ""),
    )


def test_status_porcelain_reads_machine_git_state(monkeypatch):
    _run_status(monkeypatch, " M file.py\n")
    assert status_porcelain(".") == " M file.py\n"


def test_assert_clean_rejects_changes(monkeypatch):
    _run_status(monkeypatch, " M file.py\n")
    with pytest.raises(RuntimeError, match="not clean"):
        assert_clean(".")


def test_changed_after_detects_new_changes(monkeypatch):
    _run_status(monkeypatch, " M file.py\n")
    assert changed_after(".", "") is True


def test_safe_push_never_uses_force(monkeypatch):
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        if command[:4] == ["git", "-C", ".", "status"]:
            return subprocess.CompletedProcess(command, 0, "", "")
        if command[-2:] == ["branch", "--show-current"]:
            return subprocess.CompletedProcess(command, 0, "main\n", "")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    safe_push(".")
    push = calls[-1]
    assert "--force" not in push
    assert "-f" not in push
    assert push[-2:] == ["origin", "main"]


def test_safe_push_classifies_push_failure(monkeypatch):
    def fake_run(command, **kwargs):
        if command[:4] == ["git", "-C", ".", "status"]:
            return subprocess.CompletedProcess(command, 0, "", "")
        if command[-2:] == ["branch", "--show-current"]:
            return subprocess.CompletedProcess(command, 0, "main\n", "")
        raise subprocess.CalledProcessError(128, command)

    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(PushFailedError, match="git push failed"):
        safe_push(".")
    assert PUSH_FAILED_CODE == 78


def test_commit_if_changed_does_nothing_on_clean_tree(monkeypatch):
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    assert commit_if_changed(".", "test commit") is None
    assert len(calls) == 1


def test_commit_if_changed_uses_normal_commit(monkeypatch):
    calls = []
    responses = iter([
        subprocess.CompletedProcess(["git"], 0, " M file.py\n", ""),
        subprocess.CompletedProcess(["git"], 0, "", ""),
        subprocess.CompletedProcess(["git"], 0, "", ""),
        subprocess.CompletedProcess(["git"], 0, "abc123\n", ""),
    ])

    def fake_run(command, **kwargs):
        calls.append(command)
        return next(responses)

    monkeypatch.setattr(subprocess, "run", fake_run)
    assert commit_if_changed(".", "feat: test") == "abc123"
    assert calls[1][3:5] == ["add", "-A"]
    assert calls[2][3:5] == ["commit", "-m"]
    assert "--force" not in calls[2]


def test_commit_if_changed_rejects_out_of_scope_changes(monkeypatch):
    calls = []
    responses = iter([
        subprocess.CompletedProcess(["git"], 0, " M e2e/live_fixture.py\n?? model-bench/result.txt\n", ""),
        subprocess.CompletedProcess(["git"], 0, "e2e/live_fixture.py\nmodel-bench/result.txt\n", ""),
        subprocess.CompletedProcess(["git"], 0, "", ""),
        subprocess.CompletedProcess(["git"], 0, "", ""),
    ])

    def fake_run(command, **kwargs):
        calls.append(command)
        return next(responses)

    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(ScopeViolationError, match="model-bench/result.txt"):
        commit_if_changed(".", "fix: live fixture", allowed_paths=("e2e/",))
    assert not any("commit" in call for call in calls)


def test_commit_if_changed_stages_only_declared_scope(monkeypatch):
    calls = []
    responses = iter([
        subprocess.CompletedProcess(["git"], 0, " M e2e/live_fixture.py\n", ""),
        subprocess.CompletedProcess(["git"], 0, "e2e/live_fixture.py\n", ""),
        subprocess.CompletedProcess(["git"], 0, "", ""),
        subprocess.CompletedProcess(["git"], 0, "e2e/live_fixture.py\n", ""),
        subprocess.CompletedProcess(["git"], 0, "", ""),
        subprocess.CompletedProcess(["git"], 0, "abc123\n", ""),
    ])

    def fake_run(command, **kwargs):
        calls.append(command)
        return next(responses)

    monkeypatch.setattr(subprocess, "run", fake_run)
    assert commit_if_changed(".", "fix: live fixture", allowed_paths=("e2e/",)) == "abc123"
    assert calls[3][-3:] == ["-A", "--", "e2e/"]
    assert calls[4][3:5] == ["commit", "-m"]


def test_ensure_fas_excluded_adds_common_python_runtime_artifacts(tmp_path):
    repo = tmp_path / "repo"
    git_dir = repo / ".git"
    (git_dir / "info").mkdir(parents=True)

    def fake_run(command, **kwargs):
        return subprocess.CompletedProcess(command, 0, ".git\n", "")

    original = subprocess.run
    subprocess.run = fake_run
    try:
        ensure_fas_excluded(repo)
    finally:
        subprocess.run = original

    exclude = (git_dir / "info" / "exclude").read_text(encoding="utf-8")
    for marker in (".fas/", "__pycache__/", ".pytest_cache/", "*.pyc"):
        assert marker in exclude
