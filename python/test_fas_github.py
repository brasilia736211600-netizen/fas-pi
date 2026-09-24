import json
import subprocess

import pytest

from fas_github import WorkflowRun, classify_run, find_run, resolve_repository, view_run


def _runner_with(payload):
    def runner(command, **kwargs):
        return subprocess.CompletedProcess(command, 0, json.dumps(payload), "")

    return runner


def test_resolve_repository_preserves_owner_repo():
    assert resolve_repository("owner/repo") == "owner/repo"


def test_resolve_repository_from_https_origin(tmp_path):
    commands = []

    def runner(command, **kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(
            command,
            0,
            "https://github.com/brasilia736211600-netizen/FAS-Auto-Test.git\n",
            "",
        )

    assert resolve_repository(str(tmp_path), runner=runner) == (
        "brasilia736211600-netizen/FAS-Auto-Test"
    )
    assert commands == [
        ["git", "-C", str(tmp_path.resolve()), "remote", "get-url", "origin"]
    ]


def test_resolve_repository_from_ssh_origin(tmp_path):
    def runner(command, **kwargs):
        return subprocess.CompletedProcess(
            command,
            0,
            "git@github.com:brasilia736211600-netizen/FAS-Auto-Test.git\n",
            "",
        )

    assert resolve_repository(str(tmp_path), runner=runner) == (
        "brasilia736211600-netizen/FAS-Auto-Test"
    )


def test_resolve_repository_rejects_non_github_origin(tmp_path):
    def runner(command, **kwargs):
        return subprocess.CompletedProcess(
            command, 0, "https://gitlab.com/example/repo.git\n", ""
        )

    with pytest.raises(ValueError, match="not a GitHub repository"):
        resolve_repository(str(tmp_path), runner=runner)


def test_find_run_matches_commit_sha():
    payload = [
        {
            "databaseId": 12,
            "status": "completed",
            "conclusion": "success",
            "headSha": "abc",
            "workflowName": "FAS CI",
        }
    ]
    run = find_run("owner/repo", "abc", runner=_runner_with(payload))
    assert run == WorkflowRun(12, "completed", "success", "abc", "FAS CI")


def test_find_run_returns_none_for_missing_commit():
    assert find_run("owner/repo", "abc", runner=_runner_with([])) is None


def test_view_run_parses_machine_payload():
    payload = {
        "databaseId": 8,
        "status": "in_progress",
        "conclusion": None,
        "headSha": "def",
        "workflowName": "FAS CI",
    }
    run = view_run("owner/repo", 8, runner=_runner_with(payload))
    assert classify_run(run) == "pending"


def test_classify_terminal_states():
    assert classify_run(WorkflowRun(1, "completed", "success", "a", "ci")) == "success"
    assert classify_run(WorkflowRun(2, "completed", "failure", "a", "ci")) == "failure"
    assert classify_run(WorkflowRun(3, "completed", "timed_out", "a", "ci")) == "non_actionable"


def _runner_script(responses):
    calls = []

    def runner(command, **kwargs):
        calls.append(command)
        payload = responses[min(len(calls) - 1, len(responses) - 1)]
        return subprocess.CompletedProcess(command, 0, json.dumps(payload), "")

    return runner, calls


def test_dispatch_workflow_triggers_and_returns_newest_run():
    from fas_github import dispatch_workflow

    runner, calls = _runner_script([{}, [{"databaseId": 77}]])
    run_id = dispatch_workflow(
        "owner/repo",
        "cloud-offload.yml",
        ref="main",
        fields={"task": "build"},
        runner=runner,
    )
    assert run_id == 77
    assert calls[0][:4] == ["gh", "workflow", "run", "cloud-offload.yml"]
    assert "--repo" in calls[0] and "owner/repo" in calls[0]
    assert "task=build" in calls[0]


def test_wait_run_polls_until_completed():
    from fas_github import wait_run

    sleeps = []
    runner, calls = _runner_script(
        [
            {"databaseId": 7, "status": "queued", "conclusion": None, "headSha": "a", "workflowName": "w"},
            {"databaseId": 7, "status": "in_progress", "conclusion": None, "headSha": "a", "workflowName": "w"},
            {"databaseId": 7, "status": "completed", "conclusion": "success", "headSha": "a", "workflowName": "w"},
        ]
    )
    run = wait_run("owner/repo", 7, runner=runner, sleeper=sleeps.append, interval_s=1, timeout_s=60)
    assert (run.status, run.conclusion) == ("completed", "success")
    assert len(calls) == 3 and len(sleeps) == 2


def test_wait_run_times_out_bounded():
    import pytest

    from fas_github import TimeoutError, wait_run

    payload = {"databaseId": 7, "status": "in_progress", "conclusion": None, "headSha": "a", "workflowName": "w"}
    runner, calls = _runner_script([payload])
    with pytest.raises(TimeoutError):
        wait_run("owner/repo", 7, runner=runner, sleeper=lambda s: None, interval_s=5, timeout_s=12)
    assert len(calls) <= 3


def test_download_artifacts_builds_command(tmp_path):
    from fas_github import download_artifacts

    runner, calls = _runner_script([{}])
    dest = download_artifacts("owner/repo", 9, str(tmp_path), runner=runner)
    assert dest == str(tmp_path)
    assert calls[0][:4] == ["gh", "run", "download", "9"]


def test_resolve_repository_allows_letter_s():
    assert (
        resolve_repository("brasilia736211600-netizen/FAS-Auto-Test")
        == "brasilia736211600-netizen/FAS-Auto-Test"
    )


def test_download_artifacts_tolerates_empty_run(tmp_path, capsys):
    from fas_github import download_artifacts

    def runner(command, **kwargs):
        raise subprocess.CalledProcessError(1, command, "", "no artifacts found")

    dest = download_artifacts("owner/repo", 9, str(tmp_path / "out"), runner=runner)
    assert dest == str(tmp_path / "out")
    assert (tmp_path / "out").is_dir()
    assert "no artifacts" in capsys.readouterr().err
