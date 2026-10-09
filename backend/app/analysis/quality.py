"""Step-response quality indices.

The steady-state value is not read from the last sample of a finite
trajectory: it is the limit y_inf = (D - C A^-1 B) r of the model, which
exists only for an asymptotically stable A (for a model without states it is
simply D r). When it does not exist, overshoot, rise and settling times are
undefined and are reported as null with a reason.

Settling time uses the classical band: |y(t) - y_inf| <= 2 % of the step of
the output |y_inf - y(t_step)| for all later samples, measured from the
instant of the step.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from app.simulation.assembly import LinearModel

SETTLING_BAND = 0.02


def steady_state_outputs(model: LinearModel, stability: str) -> np.ndarray | None:
    """y_inf for all Scope outputs with every step input switched on."""

    r_inf = np.array([source.amplitude for source in model.sources], dtype=float)
    if model.state_dimension == 0:
        return model.d @ r_inf
    if stability != "stable":
        return None
    dc_gain = model.d - model.c @ np.linalg.solve(model.a, model.b)
    return dc_gain @ r_inf


def step_instant(model: LinearModel, t_start: float) -> float:
    active = [s.t0 for s in model.sources if s.amplitude != 0.0]
    return max(t_start, min(active)) if active else t_start


def _crossing_time(time: np.ndarray, values: np.ndarray, threshold: float, rising: bool) -> float | None:
    reached = values >= threshold if rising else values <= threshold
    indices = np.flatnonzero(reached)
    if indices.size == 0:
        return None
    index = int(indices[0])
    if index == 0:
        return float(time[0])
    left, right = float(values[index - 1]), float(values[index])
    if right == left:
        return float(time[index])
    ratio = (threshold - left) / (right - left)
    return float(time[index - 1] + ratio * (time[index] - time[index - 1]))


def _step_indices(
    time: np.ndarray,
    values: np.ndarray,
    y_inf: float,
    t_step: float,
) -> dict[str, Any]:
    after = time >= t_step
    t, y = time[after], values[after]
    if t.size < 2:
        return {"reason": "После ступеньки недостаточно отсчётов."}
    y0 = float(y[0])
    transition = y_inf - y0
    if abs(transition) <= 1e-12 * max(1.0, abs(y_inf)):
        return {"reason": "Выход не изменяет установившееся значение: переходного процесса нет."}

    rising = transition > 0.0
    peak = float(np.max(y) if rising else np.min(y))
    overshoot = max(0.0, (peak - y_inf) / transition * 100.0)

    low = _crossing_time(t, y, y0 + 0.1 * transition, rising)
    high = _crossing_time(t, y, y0 + 0.9 * transition, rising)
    rise = high - low if low is not None and high is not None and high >= low else None

    band = SETTLING_BAND * abs(transition)
    outside = np.flatnonzero(np.abs(y - y_inf) > band)
    if outside.size == 0:
        settling: float | None = 0.0
    elif int(outside[-1]) == t.size - 1:
        settling = None
    else:
        settling = float(t[int(outside[-1]) + 1] - t[0])

    return {
        "overshoot_percent": overshoot,
        "rise_time": rise,
        "settling_time": settling,
        "reason": None if settling is not None else "Процесс не вошёл в 2 % зону до конца моделирования.",
    }


def compute_quality_metrics(
    time: Sequence[float],
    outputs: Mapping[str, Sequence[float]],
    *,
    steady_values: Mapping[str, float | None],
    t_step: float,
    unavailable_reason: str | None = None,
    references: Mapping[str, float] | None = None,
) -> dict[str, dict[str, Any]]:
    time_values = np.asarray(time, dtype=float)
    metrics: dict[str, dict[str, Any]] = {}
    for label, raw in outputs.items():
        values = np.asarray(raw, dtype=float)
        y_inf = steady_values.get(label)
        reference = None if references is None else references.get(label)
        row: dict[str, Any] = {
            "final_value": float(values[-1]) if values.size else None,
            "target_value": None if y_inf is None else float(y_inf),
            "target_source": None if y_inf is None else "model_steady_state",
            "min_value": float(np.min(values)) if values.size else None,
            "max_value": float(np.max(values)) if values.size else None,
            "overshoot_percent": None,
            "settling_time": None,
            "rise_time": None,
            "steady_state_error": None,
            "integral_absolute_error": None,
            "integral_squared_error": None,
            "settling_band_percent": SETTLING_BAND * 100.0,
            "reference": reference,
            "reason": unavailable_reason,
        }
        if values.size == time_values.size and values.size and np.all(np.isfinite(values)):
            if y_inf is not None:
                indices = _step_indices(time_values, values, float(y_inf), t_step)
                row.update({key: indices.get(key) for key in ("overshoot_percent", "rise_time", "settling_time")})
                row["reason"] = indices.get("reason")
            if reference is not None:
                error = reference - values
                row["integral_absolute_error"] = float(np.trapezoid(np.abs(error), time_values))
                row["integral_squared_error"] = float(np.trapezoid(error * error, time_values))
                if y_inf is not None:
                    row["steady_state_error"] = float(reference - y_inf)
        metrics[label] = row
    return metrics
