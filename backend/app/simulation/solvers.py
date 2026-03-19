from __future__ import annotations

from collections.abc import Callable

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

    for idx in range(t_eval.size - 1):
        t0 = float(t_eval[idx])
        h = float(t_eval[idx + 1] - t_eval[idx])

        k1 = rhs(t0, x)
        k2 = rhs(t0 + 0.5 * h, x + 0.5 * h * k1)
        k3 = rhs(t0 + 0.5 * h, x + 0.5 * h * k2)
        k4 = rhs(t0 + h, x + h * k3)

        x = x + (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
        trajectory[:, idx + 1] = x

    return trajectory


def solve_ivp_integrate(
    rhs: Callable[[float, np.ndarray], np.ndarray],
    x0: np.ndarray,
    t_eval: np.ndarray,
) -> np.ndarray:
    _validate_time_grid(t_eval)
    if x0.ndim != 1:
        raise ValueError("Начальное состояние должно быть одномерным.")

    state_dimension = x0.size
    if state_dimension == 0:
        return np.zeros((0, t_eval.size), dtype=float)

    result = solve_ivp(
        rhs,
        t_span=(float(t_eval[0]), float(t_eval[-1])),
        y0=x0,
        t_eval=t_eval,
        method="RK45",
        rtol=1e-8,
        atol=1e-10,
    )
    if not result.success:
        raise RuntimeError(f"solve_ivp завершился с ошибкой: {result.message}")

    return result.y
