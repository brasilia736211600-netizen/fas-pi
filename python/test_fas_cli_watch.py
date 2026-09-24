import fas_cli


def test_cli_watch_delegates_to_bounded_watch(monkeypatch, tmp_path, capsys):
    captured = {}

    def fake_watch(repo, **kwargs):
        captured["repo"] = repo
        captured.update(kwargs)
        return "success"

    monkeypatch.setattr(fas_cli, "watch_and_recover", fake_watch)
    assert fas_cli.main([
        "watch",
        "--repo",
        str(tmp_path),
        "--max-attempts",
        "2",
        "--poll-limit",
        "4",
        "--poll-seconds",
        "0.1",
        "--test-cmd",
        "pytest -q",
    ]) == 0
    assert captured["repo"] == str(tmp_path.resolve())
    assert captured["max_attempts"] == 2
    assert captured["poll_limit"] == 4
    assert captured["poll_seconds"] == 0.1
    assert capsys.readouterr().out.strip() == "success"
