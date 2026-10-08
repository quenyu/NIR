from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np


def _finite_or_none(value: float | None) -> float | None:
    if value is None:
        return None
    if not np.isfinite(value):
        return None
    return float(value)


def _empty_metrics(settling_band: float) -> dict[str, Any]:
    return {
        "final_value": None,
        "target_value": None,
        "target_source": None,
        "min_value": None,
        "max_value": None,
        "overshoot_percent": None,
        "settling_time": None,
        "rise_time": None,
        "steady_state_error": None,
        "integral_absolute_error": None,
        "integral_squared_error": None,
        "settling_band_percent": settling_band * 100.0,
        "reference": None,
    }


def _overshoot_percent(values: np.ndarray, target_value: float) -> float | None:
    transition = target_value - float(values[0])
    if abs(transition) <= 1e-12:
        return None
    if transition > 0.0:
        peak = float(np.max(values))
        overshoot = max(0.0, (peak - target_value) / abs(transition) * 100.0)
    else:
        peak = float(np.min(values))
        overshoot = max(0.0, (target_value - peak) / abs(transition) * 100.0)
    return overshoot


def _settling_time(
    time: np.ndarray,
    values: np.ndarray,
    target_value: float,
    band: float,
) -> float | None:
    response_scale = max(
        abs(target_value - float(values[0])),
        float(np.max(np.abs(values - target_value))),
    )
    tolerance = response_scale * band
    if tolerance <= 1e-12:
        return None

    outside = np.flatnonzero(np.abs(values - target_value) > tolerance)
    if outside.size == 0:
        return 0.0
    last_outside = int(outside[-1])
    if last_outside >= len(time) - 2:
        return None
    return float(time[last_outside + 1] - time[0])


def _rise_time(time: np.ndarray, values: np.ndarray, target_value: float) -> float | None:
    initial_value = float(values[0])
    transition = target_value - initial_value
    if abs(transition) <= 1e-12:
        return None

    low = initial_value + 0.1 * transition
    high = initial_value + 0.9 * transition
    def crossing_time(threshold: float) -> float | None:
        reached = values >= threshold if transition > 0.0 else values <= threshold
        indices = np.flatnonzero(reached)
        if indices.size == 0:
            return None
        index = int(indices[0])
        if index == 0:
            return float(time[0])
        left_value = float(values[index - 1])
        right_value = float(values[index])
        if abs(right_value - left_value) <= 1e-15:
            return float(time[index])
        ratio = (threshold - left_value) / (right_value - left_value)
        return float(time[index - 1] + ratio * (time[index] - time[index - 1]))

    low_time = crossing_time(low)
    high_time = crossing_time(high)
    if low_time is None or high_time is None or high_time < low_time:
        return None
    return high_time - low_time


def _error_integrals(
    time: np.ndarray,
    values: np.ndarray,
    reference: float | np.ndarray | None,
) -> tuple[float | None, float | None, float | None]:
    if reference is None:
        return None, None, None

    if isinstance(reference, np.ndarray):
        reference_values = reference
    else:
        reference_values = np.full_like(values, float(reference), dtype=float)

    if reference_values.shape != values.shape:
        return None, None, None

    error = reference_values - values
    steady_state_error = float(error[-1])
    iae = float(np.trapezoid(np.abs(error), time))
    ise = float(np.trapezoid(error * error, time))
    return steady_state_error, iae, ise


def compute_quality_metrics(
    time: Sequence[float],
    outputs: Mapping[str, Sequence[float]],
    *,
    references: Mapping[str, float | Sequence[float]] | None = None,
    settling_band: float = 0.02,
) -> dict[str, dict[str, Any]]:
    time_values = np.asarray(time, dtype=float)
    metrics: dict[str, dict[str, Any]] = {}

    for label, raw_values in outputs.items():
        values = np.asarray(raw_values, dtype=float)
        if time_values.size == 0 or values.size == 0 or values.size != time_values.size:
            metrics[label] = _empty_metrics(settling_band)
            continue

        if not np.all(np.isfinite(time_values)) or not np.all(np.isfinite(values)):
            metrics[label] = _empty_metrics(settling_band)
            continue

        final_value = float(values[-1])
        reference_input = None if references is None else references.get(label)
        if isinstance(reference_input, Sequence) and not isinstance(reference_input, str):
            reference: float | np.ndarray | None = np.asarray(reference_input, dtype=float)
        else:
            reference = None if reference_input is None else float(reference_input)

        if isinstance(reference, np.ndarray) and (
            reference.shape != values.shape or not np.all(np.isfinite(reference))
        ):
            metrics[label] = _empty_metrics(settling_band)
            continue
        if isinstance(reference, np.ndarray):
            target_value = float(reference[-1])
            target_source = "reference_series_final"
        elif reference is not None:
            target_value = float(reference)
            target_source = "reference"
        else:
            target_value = final_value
            target_source = "last_sample_estimate"

        steady_state_error, iae, ise = _error_integrals(time_values, values, reference)
        if isinstance(reference, np.ndarray):
            reference_summary: float | str | None = "provided"
        else:
            reference_summary = _finite_or_none(reference)
        metrics[label] = {
            "final_value": _finite_or_none(final_value),
            "target_value": _finite_or_none(target_value),
            "target_source": target_source,
            "min_value": _finite_or_none(float(np.min(values))),
            "max_value": _finite_or_none(float(np.max(values))),
            "overshoot_percent": _finite_or_none(_overshoot_percent(values, target_value)),
            "settling_time": _finite_or_none(
                _settling_time(time_values, values, target_value, settling_band)
            ),
            "rise_time": _finite_or_none(_rise_time(time_values, values, target_value)),
            "steady_state_error": _finite_or_none(steady_state_error),
            "integral_absolute_error": _finite_or_none(iae),
            "integral_squared_error": _finite_or_none(ise),
            "settling_band_percent": settling_band * 100.0,
            "reference": reference_summary,
        }

    return metrics
