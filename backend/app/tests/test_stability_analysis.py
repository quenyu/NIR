"""Stability classification (M1), PBH tests (M2) and the RK4 step check (M4)."""

from __future__ import annotations

import numpy as np
import pytest
from scipy.linalg import block_diag
from scipy.signal import tf2ss

from app.analysis.stability import balanced, classify_stability, rk4_step_check
from app.analysis.system import controllability, observability
from app.core.block_specs import butterworth_coefficients


def companion(denominator: list[float]) -> np.ndarray:
    a, _, _, _ = tf2ss([1.0], denominator)
    return np.asarray(a, dtype=float)


@pytest.mark.parametrize(
    ("denominator", "status"),
    [
        ([1.0, 3.0, 2.0], "stable"),
        ([1.0, -1.0], "unstable"),
        ([1.0, 0.0], "marginal"),                 # 1/s
        ([1.0, 0.0, 4.0], "marginal"),            # simple pair +-2j
        ([1.0, 0.0, 0.0], "unstable"),            # 1/s^2: Jordan block at 0
        ([1.0, 0.0, 2.0, 0.0, 1.0], "unstable"),  # (s^2+1)^2: Jordan blocks at +-j
        ([1.0, 1.0, 1.0, 1.0], "marginal"),       # (s+1)(s^2+1)
    ],
)
def test_classification_of_companion_models(denominator, status) -> None:
    assert classify_stability(companion(denominator))["status"] == status


def test_repeated_semisimple_pole_on_axis_is_marginal() -> None:
    """Two independent integrators: double eigenvalue 0 with two eigenvectors."""

    assert classify_stability(np.zeros((2, 2)))["status"] == "marginal"
    two_oscillators = block_diag(companion([1.0, 0.0, 1.0]), companion([1.0, 0.0, 1.0]))
    assert classify_stability(two_oscillators)["status"] == "marginal"


def test_empty_model_is_not_applicable() -> None:
    assert classify_stability(np.zeros((0, 0)))["status"] == "not_applicable"


@pytest.mark.parametrize("order", range(2, 11))
def test_butterworth_realizations_are_controllable_and_observable(order: int) -> None:
    numerator, denominator = butterworth_coefficients(order, 10.0)
    a, b, c, _ = (np.asarray(m, dtype=float) for m in tf2ss(numerator, denominator))

    assert controllability(a, b)["full_rank"] is True
    assert observability(a, c)["full_rank"] is True


def test_pbh_detects_uncontrollable_and_unobservable_modes() -> None:
    # Two identical lags driven by one input: the difference x1 - x2 is not reachable.
    a = np.diag([-1.0, -1.0])
    b = np.array([[1.0], [1.0]])
    reach = controllability(a, b)
    assert reach["full_rank"] is False
    assert reach["rank"] == 1

    # y = x1 only for decoupled modes: the second mode is invisible.
    a = np.diag([-1.0, -2.0])
    seen = observability(a, np.array([[1.0, 0.0]]))
    assert seen["full_rank"] is False
    assert seen["deficient_modes"][0]["real"] == pytest.approx(-2.0)


def test_balancing_is_a_consistent_similarity_transform() -> None:
    """(T^-1 A T, T^-1 B, C T) has the same transfer function as (A, B, C)."""

    a = np.array([[-1.0, 1e4, 0.0], [0.0, -2.0, 1e-3], [1e2, 0.0, -3.0]])
    b = np.array([[1.0], [0.0], [1e3]])
    c = np.array([[1e-2, 1.0, 0.0]])
    a_bal, t = balanced(a)
    b_bal, c_bal = np.linalg.solve(t, b), c @ t

    np.testing.assert_allclose(np.linalg.solve(t, a @ t), a_bal, rtol=1e-12, atol=1e-12)
    for s in (0.5j, 2.0 + 1.0j):
        original = c @ np.linalg.solve(s * np.eye(3) - a, b)
        transformed = c_bal @ np.linalg.solve(s * np.eye(3) - a_bal, b_bal)
        np.testing.assert_allclose(transformed, original, rtol=1e-12)
    assert controllability(a, b)["full_rank"] is True


def test_rk4_check_covers_imaginary_axis_poles() -> None:
    """Undamped oscillator w = 10: RK4 is unstable on the axis for h w > 2 sqrt(2)."""

    a = companion([1.0, 0.0, 100.0])
    rejected = rk4_step_check(a, 0.5)
    assert rejected["stable"] is False
    assert rejected["max_step"] == pytest.approx(2.0 * np.sqrt(2.0) / 10.0, rel=1e-6)
    assert rk4_step_check(a, 0.25)["stable"] is True


def test_rk4_check_does_not_block_physically_unstable_modes() -> None:
    a = np.array([[2.0]])
    check = rk4_step_check(a, 1.0)
    assert check["stable"] is True
    assert check["inaccurate_growing_modes"]  # e^2 vs R(2) = 7: reported, not blocked
    assert rk4_step_check(a, 0.01)["inaccurate_growing_modes"] == []
