import json

from fas_ci import classify, write_ci_evidence


def test_classify_success():
    assert classify("success") == "success"


def test_classify_known_failure():
    assert classify("failure") == "unknown_failure"
    assert classify("timed_out") == "environment_or_toolchain_failure"


def test_ci_evidence_is_durable_and_machine_readable(tmp_path, monkeypatch):
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/repo")
    monkeypatch.setenv("GITHUB_WORKFLOW", "FAS CI")
    monkeypatch.setenv("GITHUB_SHA", "abc123")
    monkeypatch.setenv("GITHUB_REF_NAME", "main")
    path = write_ci_evidence(tmp_path, run_id="42", conclusion="success")
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 1
    assert payload["provider"] == "github_actions"
    assert payload["run_id"] == "42"
    assert payload["conclusion"] == "success"
    assert payload["failure_class"] == "success"
