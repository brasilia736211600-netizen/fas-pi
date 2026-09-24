import subprocess

import pytest

from fas_fallback import candidate_models, run_with_fallback
from model_router import ModelProfile, RouteDecision, Capability


def test_first_candidate_success_stops_immediately():
    seen = []

    def runner(command, **kwargs):
        seen.append(command[-1])
        return subprocess.CompletedProcess(command, 0)

    result = run_with_fallback(lambda model: ["opencode", model], ["a", "b"], runner=runner)
    assert result.success is True
    assert result.selected_model == "a"
    assert [attempt.model for attempt in result.attempts] == ["a"]
    assert seen == ["a"]


def test_failure_falls_back_and_is_bounded():
    seen = []

    def runner(command, **kwargs):
        model = command[-1]
        seen.append(model)
        code = 0 if model == "c" else 1
        return subprocess.CompletedProcess(command, code)

    result = run_with_fallback(
        lambda model: ["opencode", model],
        ["a", "b", "c", "d"],
        runner=runner,
        max_attempts=3,
    )
    assert result.success is True
    assert result.selected_model == "c"
    assert seen == ["a", "b", "c"]
    assert len(result.attempts) == 3


def test_duplicate_candidates_do_not_consume_attempt_budget():
    def runner(command, **kwargs):
        return subprocess.CompletedProcess(command, 1)

    result = run_with_fallback(
        lambda model: ["opencode", model],
        ["a", "a", "b"],
        runner=runner,
        max_attempts=2,
    )
    assert [attempt.model for attempt in result.attempts] == ["a", "b"]
    assert result.success is False


def test_invalid_fallback_configuration_is_rejected():
    with pytest.raises(ValueError, match="at least one"):
        run_with_fallback(lambda model: ["opencode", model], [])
    with pytest.raises(ValueError, match="positive"):
        run_with_fallback(lambda model: ["opencode", model], ["a"], max_attempts=0)


def test_candidate_models_keeps_router_choice_first_and_unique():
    decision = RouteDecision(Capability.NORMAL_CODING, "primary", "test")
    assert candidate_models(decision, ["backup", "primary", "backup2"]) == (
        "primary",
        "backup",
        "backup2",
    )
