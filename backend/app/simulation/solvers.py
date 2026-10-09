"""Time integration of x' = f(t, x) with step discontinuities of the input.

The input of the model is piecewise constant: it jumps at the StepInput
instants. Every method integrates up to a jump and restarts from it, so the
derivative is never evaluated across a discontinuity.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

import numpy as np
from scipy.integrate import solve_ivp
from scipy.linalg import expm

Rhs = Callable[[float, np.ndarray], np.ndarray]


class SolverError(RuntimeError):
    """The integration could not produce a finite trajectory for this model."""

SOLVE_IVP_RTOL = 1e-8
SOLVE_IVP_ATOL = 1e-10


def _validate_time_grid(t_eval: np.ndarray) -> None:
    if t_eval.ndim != 1:
        raise ValueError("Сетка времени должна быть одномерной.")
    if t_eval.size < 2:
        raise ValueError("Сетка времени должна содержать минимум две точки.")
    if np.any(np.diff(t_eval) <= 0.0):
        raise ValueError("Сетка времени должна быть строго возрастающей.")


def euler_integrate(
    rhs: Rhs,
    x0: np.ndarray,
    t_grid: np.ndarray,
    *,
    breakpoints: Sequence[float] = (),
) -> np.ndarray:
    """Explicit Euler on the given grid: x_{k+1} = x_k + h·f(t_k, x_k).

    First-order reference method for the numerical study; it is not offered by
    the API. The derivative is taken at the left end of each step, so a jump at
    a breakpoint grid node takes effect from the step that starts there.
    """

    _validate_time_grid(t_grid)
    del breakpoints  # the left-point rule never evaluates past the step start
    if x0.size == 0:
        return np.zeros((0, t_grid.size))

    trajectory = np.zeros((x0.size, t_grid.size))
    trajectory[:, 0] = x0
    x = x0.astype(float).copy()
    for index in range(t_grid.size - 1):
        left, right = float(t_grid[index]), float(t_grid[index + 1])
        with np.errstate(over="ignore", invalid="ignore"):  # divergence is reported below
            x = x + (right - left) * rhs(left, x)
        if not np.all(np.isfinite(x)):
            raise SolverError(f"Эйлер: состояние перестало быть конечным в момент t={right:g}.")
        trajectory[:, index + 1] = x
    return trajectory


def rk4_integrate(
    rhs: Rhs,
    x0: np.ndarray,
    t_grid: np.ndarray,
    *,
    breakpoints: Sequence[float] = (),
) -> np.ndarray:
    """Classical RK4 on the given grid; every breakpoint must be a grid node.

    At a step that ends exactly on a breakpoint the last stage is evaluated
    just before it (left limit of the input), so the jump is applied only at
    the start of the next step.
    """

    _validate_time_grid(t_grid)
    if x0.size == 0:
        return np.zeros((0, t_grid.size))

    ends_on_jump = np.isin(t_grid[1:], np.asarray(breakpoints, dtype=float))
    trajectory = np.zeros((x0.size, t_grid.size))
    trajectory[:, 0] = x0
    x = x0.astype(float).copy()
    for index in range(t_grid.size - 1):
        left, right = float(t_grid[index]), float(t_grid[index + 1])
        h = right - left
        k4_time = float(np.nextafter(right, left)) if ends_on_jump[index] else right
        k1 = rhs(left, x)
        k2 = rhs(left + 0.5 * h, x + 0.5 * h * k1)
        k3 = rhs(left + 0.5 * h, x + 0.5 * h * k2)
        k4 = rhs(k4_time, x + h * k3)
        x = x + (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
        if not np.all(np.isfinite(x)):
            raise SolverError(f"RK4: состояние перестало быть конечным в момент t={right:g}.")
        trajectory[:, index + 1] = x
    return trajectory


def solve_ivp_integrate(
    rhs: Rhs,
    x0: np.ndarray,
    t_eval: np.ndarray,
    *,
    breakpoints: Sequence[float] = (),
) -> np.ndarray:
    """Adaptive RK45 (Dormand-Prince), restarted at every breakpoint."""

    _validate_time_grid(t_eval)
    if x0.size == 0:
        return np.zeros((0, t_eval.size))

    start, end = float(t_eval[0]), float(t_eval[-1])
    jumps = sorted({float(v) for v in breakpoints if start < float(v) < end})
    trajectory = np.full((x0.size, t_eval.size), np.nan)
    trajectory[:, 0] = x0
    state = x0.astype(float).copy()
    left = start
    for right in [*jumps, end]:
        is_jump = right != end

        def segment_rhs(
            t: float, x: np.ndarray, left: float = left, right: float = right, is_jump: bool = is_jump
        ) -> np.ndarray:
            # Inside the segment the input keeps its left-side value.
            return rhs(float(np.nextafter(right, left)) if is_jump and t >= right else t, x)

        result = solve_ivp(
            segment_rhs, (left, right), state, method="RK45",
            rtol=SOLVE_IVP_RTOL, atol=SOLVE_IVP_ATOL, dense_output=True,
        )
        if not result.success or result.sol is None:
            raise SolverError(f"solve_ivp завершился с ошибкой: {result.message}")
        mask = (t_eval > left) & (t_eval <= right)
        if np.any(mask):
            trajectory[:, mask] = result.sol(t_eval[mask])
        state = np.asarray(result.y[:, -1], dtype=float)
        if not np.all(np.isfinite(state)):
            raise SolverError(f"solve_ivp: состояние перестало быть конечным в момент t={right:g}.")
        left = right
    return trajectory


def exact_lti_integrate(
    a: np.ndarray,
    b: np.ndarray,
    source_values: Callable[[float], np.ndarray],
    x0: np.ndarray,
    t_grid: np.ndarray,
) -> np.ndarray:
    """Exact solution of x' = A x + B r for r constant on every grid interval.

    x(t + h) = e^{Ah} x(t) + G(h) B r,  G(h) = integral_0^h e^{A s} ds,
    both taken from the matrix exponential of [[A, I], [0, 0]] h. The grid
    must contain every input jump. Used as the reference for RK4 and RK45.
    """

    _validate_time_grid(t_grid)
    n = x0.size
    if n == 0:
        return np.zeros((0, t_grid.size))

    augmented = np.zeros((2 * n, 2 * n))
    augmented[:n, :n] = a
    augmented[:n, n:] = np.eye(n)
    cache: dict[float, tuple[np.ndarray, np.ndarray]] = {}

    trajectory = np.zeros((n, t_grid.size))
    trajectory[:, 0] = x0
    x = x0.astype(float).copy()
    for index in range(t_grid.size - 1):
        h = float(t_grid[index + 1] - t_grid[index])
        # Steps of a uniform grid differ only by rounding; 13 significant
        # digits keep one propagator per nominal step.
        key = float(f"{h:.12e}")
        if key not in cache:
            exponential = expm(augmented * key)
            cache[key] = (exponential[:n, :n], exponential[:n, n:])
        phi, gamma = cache[key]
        x = phi @ x + gamma @ (b @ source_values(float(t_grid[index])))
        trajectory[:, index + 1] = x
    return trajectory
