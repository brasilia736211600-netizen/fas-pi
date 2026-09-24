"""Small deterministic model policy for FAS.

The router deliberately avoids an ML-based decision layer. It maps explicit task
signals to a capability class and selects the highest-priority configured model
for that class.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Mapping


class Capability(StrEnum):
    FAST_SIMPLE = "fast_simple"
    NORMAL_CODING = "normal_coding"
    COMPLEX_AMBIGUOUS = "complex_ambiguous"
    EXPLORATION = "exploration"
    RECOVERY = "recovery"
    CRITICAL_REVIEW = "critical_review"


@dataclass(frozen=True)
class TaskSignals:
    """Explicit signals FAS can obtain before model selection."""

    files_changed: int = 1
    ambiguity: int = 0
    architecture_impact: bool = False
    recovery: bool = False
    exploration: bool = False
    critical_review: bool = False
    latency_sensitive: bool = False


@dataclass(frozen=True)
class ModelProfile:
    name: str
    priorities: tuple[Capability, ...]


@dataclass(frozen=True)
class RouteDecision:
    capability: Capability
    model: str
    reason: str


DEFAULT_MODELS: tuple[ModelProfile, ...] = (
    ModelProfile(
        "opencode/big-pickle",
        (
            Capability.CRITICAL_REVIEW,
            Capability.NORMAL_CODING,
            Capability.RECOVERY,
            Capability.COMPLEX_AMBIGUOUS,
        ),
    ),
    ModelProfile(
        "opencode/muse-spark-1.3-contributor-free",
        (
            Capability.NORMAL_CODING,
            Capability.RECOVERY,
            Capability.COMPLEX_AMBIGUOUS,
            Capability.CRITICAL_REVIEW,
        ),
    ),
    ModelProfile(
        "opencode/mimo-v2.5-free",
        (Capability.FAST_SIMPLE, Capability.NORMAL_CODING, Capability.RECOVERY),
    ),
    ModelProfile(
        "opencode/ling-3.0-flash-fin-free",
        (Capability.FAST_SIMPLE, Capability.NORMAL_CODING, Capability.EXPLORATION),
    ),
    ModelProfile(
        "opencode/nemotron-3-ultra-free",
        (Capability.COMPLEX_AMBIGUOUS, Capability.CRITICAL_REVIEW),
    ),
    ModelProfile(
        "opencode/nemotron-3.5-lightning-free",
        (Capability.NORMAL_CODING, Capability.FAST_SIMPLE),
    ),
)


def classify_task(signals: TaskSignals) -> Capability:
    """Choose the minimum capability class justified by explicit task signals."""

    if signals.critical_review:
        return Capability.CRITICAL_REVIEW
    if signals.recovery:
        return Capability.RECOVERY
    if signals.exploration:
        return Capability.EXPLORATION
    if signals.architecture_impact or signals.ambiguity >= 2 or signals.files_changed >= 5:
        return Capability.COMPLEX_AMBIGUOUS
    if signals.latency_sensitive or signals.files_changed <= 1:
        return Capability.FAST_SIMPLE
    return Capability.NORMAL_CODING


def route(
    signals: TaskSignals,
    models: tuple[ModelProfile, ...] = DEFAULT_MODELS,
) -> RouteDecision:
    """Return a deterministic model choice for the task signals.

    Models are searched in configured priority order. A missing capability falls
    through to the next available model rather than inventing a new provider.
    """

    if not models:
        raise ValueError("model registry must not be empty")

    capability = classify_task(signals)
    for profile in models:
        if capability in profile.priorities:
            return RouteDecision(
                capability=capability,
                model=profile.name,
                reason=f"selected for capability={capability.value}",
            )

    raise ValueError(f"no configured model supports capability={capability.value}")


def available_models(models: tuple[ModelProfile, ...] = DEFAULT_MODELS) -> Mapping[str, tuple[str, ...]]:
    """Expose the registry for diagnostics without changing routing policy."""

    return {
        capability.value: tuple(
            profile.name for profile in models if capability in profile.priorities
        )
        for capability in Capability
    }
