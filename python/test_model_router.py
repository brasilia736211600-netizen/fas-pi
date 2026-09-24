import pytest

from model_router import (
    Capability,
    ModelProfile,
    TaskSignals,
    available_models,
    classify_task,
    route,
)


def test_simple_latency_sensitive_task_uses_fast_capability():
    decision = route(TaskSignals(files_changed=1, latency_sensitive=True))
    assert decision.capability is Capability.FAST_SIMPLE
    assert decision.model in {
        "opencode/big-pickle",
        "opencode/mimo-v2.5-free",
        "opencode/ling-3.0-flash-fin-free",
        "opencode/nemotron-3.5-lightning-free",
    }


def test_multi_file_architecture_task_is_complex():
    signals = TaskSignals(files_changed=6, architecture_impact=True)
    assert classify_task(signals) is Capability.COMPLEX_AMBIGUOUS
    assert route(signals).model == "opencode/big-pickle"


def test_recovery_takes_precedence_over_generic_complexity():
    signals = TaskSignals(
        files_changed=10,
        architecture_impact=True,
        recovery=True,
    )
    decision = route(signals)
    assert decision.capability is Capability.RECOVERY
    assert decision.model == "opencode/big-pickle"


def test_critical_review_is_highest_priority_signal():
    decision = route(
        TaskSignals(
            files_changed=1,
            recovery=True,
            critical_review=True,
        )
    )
    assert decision.capability is Capability.CRITICAL_REVIEW
    assert decision.model == "opencode/big-pickle"


def test_custom_registry_controls_selection_order():
    models = (
        ModelProfile("custom-fast", (Capability.FAST_SIMPLE,)),
        ModelProfile("custom-normal", (Capability.NORMAL_CODING,)),
    )
    decision = route(TaskSignals(files_changed=1), models=models)
    assert decision.model == "custom-fast"


def test_missing_capability_is_an_explicit_configuration_error():
    models = (ModelProfile("custom-normal", (Capability.NORMAL_CODING,)),)
    with pytest.raises(ValueError, match="no configured model supports"):
        route(TaskSignals(files_changed=1, critical_review=True), models=models)


def test_empty_registry_is_rejected():
    with pytest.raises(ValueError, match="must not be empty"):
        route(TaskSignals(), models=())


def test_registry_diagnostics_are_machine_readable():
    registry = available_models()
    assert set(registry) == {cap.value for cap in Capability}
    assert "opencode/big-pickle" in registry[Capability.CRITICAL_REVIEW.value]
