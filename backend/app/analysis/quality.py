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


def _overshoot_percent(values: np.ndarray, final_value: float) -> float | None:
    if abs(final_value) <= 1e-12:
        return None
    if final_value >= 0.0:
        peak = float(np.max(values))
        overshoot = max(0.0, (peak - final_value) / abs(final_value) * 100.0)
    else:
        peak = float(np.min(values))
        overshoot = max(0.0, (final_value - peak) / abs(final_value) * 100.0)
    return overshoot


def _settling_time(
    time: np.ndarray,
    values: np.ndarray,
    final_value: float,
    band: float,
) -> float | None:
    tolerance = abs(final_value) * band
    if tolerance <= 1e-12:
        return None

    outside = np.flatnonzero(np.abs(values - final_value) > tolerance)
    if outside.size == 0:
        return float(time[0])
    last_outside = int(outside[-1])
    if last_outside >= len(time) - 2:
        return None
    return float(time[last_outside + 1])


def _rise_time(time: np.ndarray, values: np.ndarray, final_value: float) -> float | None:
    if abs(final_value) <= 1e-12:
        return None

    low = 0.1 * final_value
    high = 0.9 * final_value
    if final_value > 0.0:
        low_crossings = np.flatnonzero(values >= low)
        high_crossings = np.flatnonzero(values >= high)
    else:
        low_crossings = np.flatnonzero(values <= low)
        high_crossings = np.flatnonzero(values <= high)

    if low_crossings.size == 0 or high_crossings.size == 0:
        return None
    high_index = int(high_crossings[0])
    low_candidates = low_crossings[low_crossings <= high_index]
    if low_candidates.size == 0:
        return None
    return float(time[high_index] - time[int(low_candidates[0])])


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

        steady_state_error, iae, ise = _error_integrals(time_values, values, reference)
        metrics[label] = {
            "final_value": _finite_or_none(final_value),
            "max_value": _finite_or_none(float(np.max(values))),
            "overshoot_percent": _finite_or_none(_overshoot_percent(values, final_value)),
            "settling_time": _finite_or_none(
                _settling_time(time_values, values, final_value, settling_band)
            ),
            "rise_time": _finite_or_none(_rise_time(time_values, values, final_value)),
            "steady_state_error": _finite_or_none(steady_state_error),
            "integral_absolute_error": _finite_or_none(iae),
            "integral_squared_error": _finite_or_none(ise),
            "settling_band_percent": settling_band * 100.0,
            "reference": None if reference is None else "provided",
        }

    return metrics
