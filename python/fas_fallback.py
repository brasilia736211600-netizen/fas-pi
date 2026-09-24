"""Bounded model fallback for portable FAS execution."""
from __future__ import annotations

import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from model_router import RouteDecision


@dataclass(frozen=True)
class ModelAttempt:
    model: str
    returncode: int
    duration_seconds: float


@dataclass(frozen=True)
class FallbackResult:
    success: bool
    selected_model: str | None
    attempts: tuple[ModelAttempt, ...]


def run_with_fallback(
    command_factory: Callable[[str], Sequence[str]],
    candidates: Sequence[str],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
    cwd: str | None = None,
    max_attempts: int = 3,
    should_retry: Callable[[ModelAttempt], bool] | None = None,
) -> FallbackResult:
    """Try distinct model candidates with a hard attempt bound.

    ``should_retry`` can veto a retry after a failed attempt. FAS uses this to
    prevent another model from starting when the failed model left repository
    changes behind.
    """
    if not candidates:
        raise ValueError("at least one model candidate is required")
    if max_attempts < 1:
        raise ValueError("max_attempts must be positive")

    actual_runner = runner or subprocess.run
    retry_policy = should_retry or (lambda attempt: attempt.returncode != 0)
    attempts: list[ModelAttempt] = []
    seen: set[str] = set()
    for model in candidates:
        if model in seen:
            continue
        seen.add(model)
        if len(attempts) >= max_attempts:
            break
        start = time.monotonic()
        completed = actual_runner(command_factory(model), cwd=cwd, check=False, text=True)
        attempt = ModelAttempt(model, completed.returncode, time.monotonic() - start)
        attempts.append(attempt)
        if completed.returncode == 0:
            return FallbackResult(True, model, tuple(attempts))
        if not retry_policy(attempt):
            break

    return FallbackResult(False, None, tuple(attempts))


def candidate_models(decision: RouteDecision, fallback_models: Sequence[str]) -> tuple[str, ...]:
    """Put the routed model first, then unique configured fallbacks."""
    return tuple(dict.fromkeys((decision.model, *fallback_models)))
