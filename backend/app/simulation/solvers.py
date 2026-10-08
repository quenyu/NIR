from __future__ import annotations

from collections.abc import Callable
from collections.abc import Sequence

import numpy as np
from scipy.integrate import solve_ivp


def _validate_time_grid(t_eval: np.ndarray) -> None:
    if t_eval.ndim != 1:
        raise ValueError("Сетка времени должна быть одномерной.")
    if t_eval.size < 2:
        raise ValueError("Сетка времени должна содержать минимум две точки.")
    if np.any(np.diff(t_eval) <= 0.0):
        raise ValueError("Сетка времени должна быть строго возрастающей.")


def rk4_integrate(
    rhs: Callable[[float, np.ndarray], np.ndarray],
    x0: np.ndarray,
    t_eval: np.ndarray,
    *,
    breakpoints: Sequence[float] = (),
) -> np.ndarray:
    _validate_time_grid(t_eval)
    if x0.ndim != 1:
        raise ValueError("Начальное состояние должно быть одномерным.")

    state_dimension = x0.size
    if state_dimension == 0:
        return np.zeros((0, t_eval.size), dtype=float)

    trajectory = np.zeros((state_dimension, t_eval.size), dtype=float)
    trajectory[:, 0] = x0
    x = x0.copy()
    discontinuities = {float(value) for value in breakpoints}

    for idx in range(t_eval.size - 1):
        t0 = float(t_eval[idx])
        h = float(t_eval[idx + 1] - t_eval[idx])

        k1 = rhs(t0, x)
        k2 = rhs(t0 + 0.5 * h, x + 0.5 * h * k1)
        k3 = rhs(t0 + 0.5 * h, x + 0.5 * h * k2)
        right_time = t0 + h
        k4_time = (
            float(np.nextafter(right_time, t0))
            if any(np.isclose(right_time, value, rtol=0.0, atol=1e-14) for value in discontinuities)
            else right_time
        )
        k4 = rhs(k4_time, x + h * k3)

        if not all(np.all(np.isfinite(stage)) for stage in (k1, k2, k3, k4)):
            raise FloatingPointError(
                f"RK4 получил неконечную производную на шаге t={t0:g}."
            )

        x = x + (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
        if not np.all(np.isfinite(x)):
            raise FloatingPointError(
                f"RK4 получил неконечное состояние на шаге t={t0 + h:g}."
            )
        trajectory[:, idx + 1] = x

    return trajectory


def solve_ivp_integrate(
    rhs: Callable[[float, np.ndarray], np.ndarray],
    x0: np.ndarray,
    t_eval: np.ndarray,
    *,
    breakpoints: Sequence[float] = (),
) -> np.ndarray:
    _validate_time_grid(t_eval)
    if x0.ndim != 1:
        raise ValueError("Начальное состояние должно быть одномерным.")

    state_dimension = x0.size
    if state_dimension == 0:
        return np.zeros((0, t_eval.size), dtype=float)

    start = float(t_eval[0])
    end = float(t_eval[-1])
    discontinuities = sorted(
        {
            float(value)
            for value in breakpoints
            if np.isfinite(value) and start < float(value) < end
        }
    )
    segment_ends = [*discontinuities, end]
    trajectory = np.full((state_dimension, t_eval.size), np.nan, dtype=float)
    trajectory[:, 0] = x0
    current_state = x0.copy()
    left = start

    for right in segment_ends:
        is_discontinuity = right in discontinuities

        def segment_rhs(t: float, state: np.ndarray) -> np.ndarray:
            evaluation_time = (
                float(np.nextafter(right, left))
                if is_discontinuity and t >= right
                else t
            )
            return rhs(evaluation_time, state)

        result = solve_ivp(
            segment_rhs,
            t_span=(left, right),
            y0=current_state,
            method="RK45",
            rtol=1e-8,
            atol=1e-10,
            dense_output=True,
        )
        if not result.success or result.sol is None:
            raise RuntimeError(f"solve_ivp завершился с ошибкой: {result.message}")

        mask = (t_eval > left) & (t_eval <= right)
        if np.any(mask):
            trajectory[:, mask] = result.sol(t_eval[mask])
        current_state = np.asarray(result.y[:, -1], dtype=float)
        if not np.all(np.isfinite(current_state)):
            raise FloatingPointError(
                f"solve_ivp получил неконечное состояние в момент t={right:g}."
            )
        left = right

    if not np.all(np.isfinite(trajectory)):
        raise FloatingPointError("solve_ivp не сформировал конечную траекторию на всей сетке.")
    return trajectory
