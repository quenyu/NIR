"""Integration methods against the exact solution of x' = A x + B r.

Tolerances follow from each method:
* exact (matrix exponential): only rounding, ~1e-12 relative to the signal;
* solve_ivp RK45 with rtol=1e-8, atol=1e-10: local error control, the global
  error is bounded by a small multiple of rtol over these short horizons;
* RK4 with fixed step h: global error O(h^4), checked through the observed order;
* explicit Euler (study reference only): global error O(h).
"""

from __future__ import annotations

import numpy as np
import pytest

from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.model import compile_model
from app.simulation.service import simulate_request
from app.simulation.solvers import SolverError, euler_integrate, exact_lti_integrate, rk4_integrate, solve_ivp_integrate
from app.tests.structural_cases import (
    DiagramBuilder,
    biproper_loop_case,
    flat_equivalent_of_subsystem_feedback,
    nested_feedback_case,
    pid_loop_case,
    subsystem_feedback_case,
)


def _model(diagram: dict):
    return compile_model(Diagram.model_validate(diagram)).model


def _grid(model, t_end: float, dt: float) -> np.ndarray:
    grid = np.arange(0.0, t_end + 0.5 * dt, dt)
    return np.unique(np.concatenate((grid, model.step_breakpoints(0.0, t_end))))


def _outputs(model, grid: np.ndarray, states: np.ndarray) -> np.ndarray:
    sources = np.stack([model.source_values(t) for t in grid], axis=1)
    return model.c @ states + model.d @ sources


def _delayed_lag(t0: float) -> dict:
    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=2.0, t0=t0)
    b.add("lag", "FirstOrderLag", k=1.5, T=0.4, y0=0.0)
    b.add("y", "Scope", label="y")
    b.link("u", "lag")
    b.link("lag", "y")
    return b.build()


def test_exact_solver_matches_closed_form_with_unaligned_step() -> None:
    t0 = 0.37
    model = _model(_delayed_lag(t0))
    grid = _grid(model, 3.0, 0.1)
    states = exact_lti_integrate(model.a, model.b, model.source_values, model.x0, grid)

    expected = np.where(grid >= t0, 3.0 * (1.0 - np.exp(-(grid - t0) / 0.4)), 0.0)
    np.testing.assert_allclose(_outputs(model, grid, states)[0], expected, atol=1e-12)


@pytest.mark.parametrize("case", [pid_loop_case(), nested_feedback_case()], ids=lambda c: c.name)
def test_rk45_agrees_with_exact_solution(case) -> None:
    model = _model(case.diagram)
    grid = _grid(model, 10.0, 0.05)
    exact = _outputs(model, grid, exact_lti_integrate(model.a, model.b, model.source_values, model.x0, grid))
    rk45 = _outputs(model, grid, solve_ivp_integrate(model.rhs, model.x0, grid))

    scale = float(np.max(np.abs(exact)))
    assert np.max(np.abs(rk45 - exact)) <= 1e-6 * scale


def test_rk4_has_fourth_order_convergence() -> None:
    model = _model(pid_loop_case().diagram)
    errors = []
    for dt in (0.04, 0.02, 0.01):
        grid = _grid(model, 4.0, dt)
        exact = _outputs(model, grid, exact_lti_integrate(model.a, model.b, model.source_values, model.x0, grid))
        rk4 = _outputs(model, grid, rk4_integrate(model.rhs, model.x0, grid))
        errors.append(float(np.max(np.abs(rk4 - exact))))

    orders = np.log2(np.asarray(errors[:-1]) / np.asarray(errors[1:]))
    assert np.all((orders > 3.7) & (orders < 4.3)), orders


def test_euler_has_first_order_convergence() -> None:
    model = _model(pid_loop_case().diagram)
    errors = []
    for dt in (0.004, 0.002, 0.001):
        grid = _grid(model, 4.0, dt)
        exact = _outputs(model, grid, exact_lti_integrate(model.a, model.b, model.source_values, model.x0, grid))
        euler = _outputs(model, grid, euler_integrate(model.rhs, model.x0, grid))
        errors.append(float(np.max(np.abs(euler - exact))))

    orders = np.log2(np.asarray(errors[:-1]) / np.asarray(errors[1:]))
    assert np.all((orders > 0.9) & (orders < 1.1)), orders


def test_euler_step_is_the_left_point_rule() -> None:
    # x' = -x, x(0) = 1: one step of size h gives exactly 1 - h.
    trajectory = euler_integrate(lambda _t, x: -x, np.array([1.0]), np.array([0.0, 0.25]))
    assert trajectory[0, 1] == pytest.approx(0.75, abs=1e-15)


def test_euler_beyond_its_stability_limit_is_reported() -> None:
    # x' = -x with h = 3 > 2: |1 - h| = 2, the numerical solution doubles every step.
    grid = np.arange(0.0, 3.0 * 1100, 3.0)
    with pytest.raises(SolverError, match="Эйлер"):
        euler_integrate(lambda _t, x: -x, np.array([1.0]), grid)


def test_rk4_with_unaligned_step_keeps_its_accuracy() -> None:
    """The jump is a grid node and the last stage sees the left limit."""

    model = _model(_delayed_lag(0.3337))
    grid = _grid(model, 3.0, 0.01)
    exact = _outputs(model, grid, exact_lti_integrate(model.a, model.b, model.source_values, model.x0, grid))
    rk4 = _outputs(model, grid, rk4_integrate(model.rhs, model.x0, grid, breakpoints=model.step_breakpoints(0.0, 3.0)))

    # RK4 error constant for this lag is ~ h^4/(5! T^5) ~ 1e-8 per unit amplitude.
    assert np.max(np.abs(rk4 - exact)) <= 1e-7


def test_unstable_system_is_simulated_accurately() -> None:
    """1/(s-1) under a unit step: y = e^t - 1. Growth is physical, not numerical."""

    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    b.add("g", "TransferFunction", numerator=[1.0], denominator=[1.0, -1.0])
    b.add("y", "Scope", label="y")
    b.link("u", "g")
    b.link("g", "y")

    for solver, rtol in (("rk4", 1e-8), ("solve_ivp", 1e-6)):
        result = simulate_request(
            SimulationRequest(diagram=Diagram.model_validate(b.build()), t_end=5.0, dt=0.001, solver=solver)
        )
        time = np.asarray(result.time)
        np.testing.assert_allclose(result.outputs["y"][1:], np.exp(time[1:]) - 1.0, rtol=rtol)
        assert result.system_analysis["stability"] == "unstable"


def test_well_posed_algebraic_loop_is_simulated() -> None:
    """Loop through (s+2)/(s+1): closed loop (s+2)/(2s+3), y = 2/3 - e^{-1.5t}/6."""

    result = simulate_request(
        SimulationRequest(diagram=Diagram.model_validate(biproper_loop_case().diagram), t_end=4.0, dt=0.01)
    )
    time = np.asarray(result.time)

    np.testing.assert_allclose(result.outputs["y"], 2.0 / 3.0 - np.exp(-1.5 * time) / 6.0, atol=1e-7)
    assert result.system_analysis["algebraic_loops"][0]["blocks"] == ["e", "w"]


def test_nested_and_flat_diagrams_give_identical_trajectories() -> None:
    def run(diagram: dict) -> np.ndarray:
        result = simulate_request(
            SimulationRequest(diagram=Diagram.model_validate(diagram), t_end=3.0, dt=0.01, solver="rk4")
        )
        return np.asarray(result.outputs["y"])

    np.testing.assert_allclose(
        run(subsystem_feedback_case().diagram),
        run(flat_equivalent_of_subsystem_feedback().diagram),
        rtol=0.0,
        atol=1e-14,
    )
