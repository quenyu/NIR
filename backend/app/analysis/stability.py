"""Stability of the assembled continuous LTI model x' = A x + B u.

Classification (Lyapunov stability of the free motion):

* asymptotically stable ("stable"): all eigenvalues have Re < 0;
* unstable: some eigenvalue has Re > 0, or an eigenvalue on the imaginary
  axis is not semisimple (a nontrivial Jordan block gives t^k growth, e.g. the
  double integrator 1/s^2);
* marginally stable ("marginal"): Re <= 0 and every imaginary-axis
  eigenvalue is semisimple (algebraic = geometric multiplicity).

Floating-point eigenvalues of a k-fold eigenvalue are spread by about
eps^(1/k) * ||A||, so a repeated pole on the axis may come out with tiny
nonzero real parts. Eigenvalues are therefore grouped into clusters and the
multiplicities are compared through numerical ranks of (A - mu I).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy.linalg import matrix_balance, schur

EPS = float(np.finfo(float).eps)
# Real parts below this (relative to ||A||) count as "on the imaginary axis".
# sqrt(eps) covers the eps^(1/2) spread of a double eigenvalue.
AXIS_RTOL = float(np.sqrt(EPS))
# Eigenvalues closer than this (relative) are treated as one multiple
# eigenvalue: a k-fold eigenvalue is computed with a spread of about
# eps^(1/k), so eps^(1/3) covers multiplicities up to three while still
# separating distinct poles 1e-5 apart. A missed higher-order Jordan block
# shows up as real parts beyond AXIS_RTOL and is still reported unstable.
CLUSTER_RTOL = EPS ** (1.0 / 3.0)


def _scale(a: np.ndarray) -> float:
    return max(1.0, float(np.linalg.norm(a, 2)))


def balanced(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Diagonal similarity T with T^-1 A T balanced; returns (T^-1 A T, T)."""

    if a.size == 0:
        return a, np.eye(0)
    a_bal, t = matrix_balance(a, permute=False)
    return a_bal, t


def eigenvalue_clusters(a: np.ndarray) -> list[tuple[complex, int]]:
    """Group numerically repeated eigenvalues: [(mean value, multiplicity)]."""

    if a.size == 0:
        return []
    values = np.linalg.eigvals(a)
    tolerance = CLUSTER_RTOL * _scale(a)
    clusters: list[list[complex]] = []
    for value in sorted(values, key=lambda v: (v.real, v.imag)):
        for cluster in clusters:
            if abs(value - np.mean(cluster)) <= tolerance:
                cluster.append(value)
                break
        else:
            clusters.append([value])
    return [(complex(np.mean(cluster)), len(cluster)) for cluster in clusters]


def geometric_multiplicity(a: np.ndarray, value: complex) -> int:
    n = a.shape[0]
    singular_values = np.linalg.svd(a - value * np.eye(n), compute_uv=False)
    return int(np.sum(singular_values <= CLUSTER_RTOL * _scale(a)))


def _axis_subspace(a_bal: np.ndarray) -> np.ndarray:
    """Restriction of A to the invariant subspace of its near-axis eigenvalues.

    Candidates are selected with a loose tolerance relative to ||A||; the
    ordered complex Schur form then isolates them, so that the final
    decisions below use the scale of these modes and not of fast ones
    elsewhere in the model (a stiff block must not blur slow poles).
    """

    loose = CLUSTER_RTOL * _scale(a_bal)
    t, _, count = schur(a_bal.astype(complex), output="complex", sort=lambda value: abs(value.real) <= loose)
    return t[:count, :count]


def classify_stability(a: np.ndarray) -> dict[str, Any]:
    n = a.shape[0]
    if n == 0:
        return {"status": "not_applicable", "reason": "Модель не содержит состояний."}

    a_bal, _ = balanced(a)
    unstable = {"status": "unstable", "reason": "Есть полюса в правой полуплоскости."}
    loose = CLUSTER_RTOL * _scale(a_bal)
    if any(value.real > loose for value in np.linalg.eigvals(a_bal)):
        return unstable

    local = _axis_subspace(a_bal)
    if local.size == 0:
        return {"status": "stable", "reason": "Все полюса в левой полуплоскости."}

    axis_tolerance = AXIS_RTOL * _scale(local)
    values = np.diag(local)
    if any(value.real > axis_tolerance for value in values):
        return unstable
    on_axis = [(value, k) for value, k in eigenvalue_clusters(local) if abs(value.real) <= axis_tolerance]
    if not on_axis:
        return {"status": "stable", "reason": "Все полюса в левой полуплоскости."}

    for value, multiplicity in on_axis:
        if multiplicity > 1 and geometric_multiplicity(local, value) < multiplicity:
            return {
                "status": "unstable",
                "reason": (
                    f"Кратный полюс {value.real:+.3g}{value.imag:+.3g}j на мнимой оси "
                    "образует жорданову клетку: свободное движение растёт как t^k."
                ),
            }
    return {
        "status": "marginal",
        "reason": "Простые полюса на мнимой оси: движение ограничено, но не затухает.",
    }


def rk4_amplification(z: complex) -> complex:
    return 1.0 + z + z * z / 2.0 + z**3 / 6.0 + z**4 / 24.0


def _rk4_step_limit(pole: complex, step: float) -> float:
    """Largest h' <= step with |R(h' * pole)| <= 1 (bisection on the ray)."""

    low, high = 0.0, step
    for _ in range(60):
        middle = 0.5 * (low + high)
        if abs(rk4_amplification(middle * pole)) <= 1.0:
            low = middle
        else:
            high = middle
    return low


def rk4_step_check(a: np.ndarray, step: float) -> dict[str, Any]:
    """Compare the RK4 amplification with the exact one, e^(h lambda), per mode.

    A mode that is stable or marginal physically (Re lambda <= tol) must not be
    amplified by the method: |R(h lambda)| > 1 is numerical instability and
    the step is rejected. For a physically growing mode the growth is real;
    only a large relative error of the per-step factor is reported.
    """

    if a.size == 0:
        return {"stable": True, "unstable_modes": [], "max_step": None, "inaccurate_growing_modes": []}

    poles = np.linalg.eigvals(a)
    unstable: list[complex] = []
    limits: list[float] = []
    inaccurate: list[complex] = []
    for pole in poles:
        z = step * pole
        amplification = abs(rk4_amplification(z))
        # Relative to |lambda|: a fast block elsewhere must not turn a slowly
        # growing mode into an "axis" mode.
        if pole.real <= AXIS_RTOL * abs(pole):
            if amplification > 1.0 + 1e-12:
                unstable.append(complex(pole))
                limits.append(_rk4_step_limit(complex(pole), step))
        else:
            exact = abs(np.exp(z))
            if abs(amplification - exact) > 0.01 * exact:
                inaccurate.append(complex(pole))
    return {
        "stable": not unstable,
        "unstable_modes": unstable,
        "max_step": min(limits) if limits else None,
        "inaccurate_growing_modes": inaccurate,
    }
