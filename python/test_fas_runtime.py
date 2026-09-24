import json
import subprocess

import pytest

import fas_runtime
from model_router import Capability, TaskSignals


@pytest.fixture()
def git_repo(tmp_path, monkeypatch):
    root = tmp_path / "project"
    root.mkdir()

    def fake_run(command, **kwargs):
        if command[0:4] == ["git", "-C", str(root), "rev-parse"]:
            return subprocess.CompletedProcess(command, 0, f"{root}\n", "")
        if command[0:4] == ["git", "-C", str(root), "branch"]:
            return subprocess.CompletedProcess(command, 0, "main\n", "")
        raise AssertionError(f"unexpected command: {command}")

    monkeypatch.setattr(fas_runtime.subprocess, "run", fake_run)
    return root


def test_init_creates_portable_machine_readable_state(git_repo):
    path = fas_runtime.init_repository(git_repo)
    state = json.loads(path.read_text(encoding="utf-8"))
    assert path == git_repo / ".fas" / "state.json"
    assert state["schema_version"] == 1
    assert state["repository"] == str(git_repo.resolve())
    assert state["phase"] == "READ"
    assert state["git"]["branch"] == "main"
    assert state["max_attempts"] == 3


def test_state_round_trip_survives_process_boundaries(git_repo):
    fas_runtime.init_repository(git_repo)
    fas_runtime.select_route(
        git_repo,
        TaskSignals(files_changed=7, architecture_impact=True),
    )
    state = fas_runtime.read_state(git_repo)
    assert state["route"]["capability"] == Capability.COMPLEX_AMBIGUOUS.value
    assert state["route"]["model"] == "opencode/big-pickle"


def test_test_result_records_external_duration(git_repo):
    fas_runtime.init_repository(git_repo)
    path = fas_runtime.record_test(git_repo, "pytest -q", "PASS", 1.23456)
    state = json.loads(path.read_text(encoding="utf-8"))
    assert state["phase"] == "TEST"
    assert state["test"] == {
        "command": "pytest -q",
        "result": "PASS",
        "duration_seconds": 1.235,
    }


def test_corrupt_or_unknown_schema_is_rejected(git_repo):
    path = fas_runtime.init_repository(git_repo)
    state = json.loads(path.read_text(encoding="utf-8"))
    state["schema_version"] = 99
    path.write_text(json.dumps(state), encoding="utf-8")
    with pytest.raises(ValueError, match="unsupported FAS state schema"):
        fas_runtime.read_state(git_repo)
