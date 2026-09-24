import json
import subprocess

from fas_runtime import init_repository, read_state
from fas_git import status_porcelain


def _git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )


def test_fas_can_bootstrap_an_unrelated_git_repository(tmp_path):
    repo = tmp_path / "unrelated-project"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.email", "fas@test.invalid")
    _git(repo, "config", "user.name", "FAS Test")
    (repo / "app.py").write_text("print('hello')\n", encoding="utf-8")
    _git(repo, "add", "app.py")
    _git(repo, "commit", "-m", "test: unrelated project baseline")

    path = init_repository(repo)
    state = json.loads(path.read_text(encoding="utf-8"))

    assert state["repository"] == str(repo.resolve())
    assert state["schema_version"] == 1
    assert path.exists()
    assert status_porcelain(str(repo)) == ""
    assert read_state(repo)["phase"] == "READ"

    excluded = (repo / ".git" / "info" / "exclude").read_text(encoding="utf-8")
    assert ".fas/" in excluded
