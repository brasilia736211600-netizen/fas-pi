"""Small, non-destructive Git safety primitives for FAS."""
from __future__ import annotations

import fnmatch
import subprocess
from pathlib import Path

FORBIDDEN_GIT_OPERATIONS = {
    "reset --hard",
    "clean",
    "push --force",
    "push -f",
}

SCOPE_VIOLATION_CODE = 77
PUSH_FAILED_CODE = 78


class ScopeViolationError(RuntimeError):
    """Raised when autonomous changes exceed the declared recovery scope."""


class PushFailedError(RuntimeError):
    """Raised when a non-forced Git push fails."""


def status_porcelain(repo: str) -> str:
    return subprocess.run(
        ["git", "-C", repo, "status", "--porcelain"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def changed_paths(repo: str) -> set[str]:
    """Return tracked and untracked project paths changed from HEAD."""
    tracked = subprocess.run(
        ["git", "-C", repo, "diff", "--name-only", "HEAD", "--"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    untracked = subprocess.run(
        ["git", "-C", repo, "ls-files", "--others", "--exclude-standard"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    return {path for path in tracked + untracked if path}


def _path_allowed(path: str, allowed_paths: tuple[str, ...]) -> bool:
    normalized = path.replace("\\", "/")
    for allowed in allowed_paths:
        pattern = allowed.replace("\\", "/").lstrip("./")
        if pattern.endswith("/"):
            if normalized.startswith(pattern):
                return True
        elif fnmatch.fnmatchcase(normalized, pattern):
            return True
    return False


def assert_scope(repo: str, allowed_paths: tuple[str, ...] | list[str]) -> None:
    """Reject any changed path outside the explicitly declared scope."""
    allowed = tuple(path for path in allowed_paths if path)
    if not allowed:
        raise ScopeViolationError("autonomous commit requires an explicit recovery scope")
    changed = changed_paths(repo)
    violations = sorted(path for path in changed if not _path_allowed(path, allowed))
    if violations:
        raise ScopeViolationError(
            "changes outside recovery scope: " + ", ".join(violations)
        )


def assert_clean(repo: str) -> None:
    status = status_porcelain(repo)
    if status:
        raise RuntimeError("working tree is not clean")


def changed_after(repo: str, before: str) -> bool:
    return status_porcelain(repo) != before


def ensure_fas_excluded(repo: str) -> None:
    """Keep FAS and common Python runtime artifacts local without changing tracked files."""
    root = Path(repo).resolve()
    git_dir = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--git-dir"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    git_path = Path(git_dir)
    if not git_path.is_absolute():
        git_path = root / git_path
    exclude = git_path / "info" / "exclude"
    exclude.parent.mkdir(parents=True, exist_ok=True)
    markers = (".fas/", "__pycache__/", ".pytest_cache/", "*.pyc")
    existing = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
    lines = {line.strip() for line in existing.splitlines() if line.strip()}
    missing = [marker for marker in markers if marker not in lines]
    if missing:
        prefix = "" if not existing or existing.endswith("\n") else "\n"
        exclude.write_text(existing + prefix + "\n".join(missing) + "\n", encoding="utf-8")


def commit_if_changed(
    repo: str,
    message: str,
    *,
    allowed_paths: tuple[str, ...] | list[str] | None = None,
) -> str | None:
    """Create a normal commit, optionally enforcing a declared scope."""
    current = status_porcelain(repo)
    if not current:
        return None
    if allowed_paths is not None:
        assert_scope(repo, allowed_paths)
        pathspecs = list(allowed_paths)
        subprocess.run(["git", "-C", repo, "add", "-A", "--", *pathspecs], check=True)
    else:
        subprocess.run(["git", "-C", repo, "add", "-A"], check=True)
    subprocess.run(["git", "-C", repo, "commit", "-m", message], check=True)
    return subprocess.run(
        ["git", "-C", repo, "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def safe_push(repo: str, *, remote: str = "origin", branch: str | None = None) -> None:
    """Push without force and only from a clean tree."""
    assert_clean(repo)
    target = branch
    if not target:
        target = subprocess.run(
            ["git", "-C", repo, "branch", "--show-current"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    if not target:
        raise RuntimeError("cannot push from detached HEAD without an explicit branch")
    try:
        subprocess.run(["git", "-C", repo, "push", remote, target], check=True)
    except subprocess.CalledProcessError as exc:
        raise PushFailedError(f"git push failed with exit code {exc.returncode}") from exc
