from __future__ import annotations

import numpy as np

from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.service import simulate_request
from app.tests.helpers import (
    first_order_step_diagram,
    integrator_step_diagram,
    second_order_step_diagram,
)


def _underdamped_second_order_step_response(
    t: np.ndarray, k: float, wn: float, zeta: float
) -> np.ndarray:
    wd = wn * np.sqrt(1.0 - zeta**2)
    zeta_term = zeta / np.sqrt(1.0 - zeta**2)
    return k * (
        1.0 - np.exp(-zeta * wn * t) * (np.cos(wd * t) + zeta_term * np.sin(wd * t))
    )


def test_integrator_step_matches_linear_growth() -> None:
    request = SimulationRequest(
        diagram=Diagram.model_validate(integrator_step_diagram()),
        t_start=0.0,
        t_end=3.0,
        dt=0.01,
        solver="rk4",
    )
    result = simulate_request(request)

    t = np.array(result.time)
    y = np.array(result.outputs["y"])
    expected = t
    max_error = np.max(np.abs(y - expected))
    # Unit step into ideal integrator gives y(t)=t; RK4 should be nearly exact here.
    assert max_error < 1e-6


def test_first_order_lag_step_matches_analytical_response() -> None:
    request = SimulationRequest(
        diagram=Diagram.model_validate(first_order_step_diagram()),
        t_start=0.0,
        t_end=4.0,
        dt=0.01,
        solver="solve_ivp",
    )
    result = simulate_request(request)

    t = np.array(result.time)
    y = np.array(result.outputs["y"])
    expected = 2.0 * (1.0 - np.exp(-t / 0.5))
    max_error = np.max(np.abs(y - expected))
    # Tolerance accounts for numerical integration error and finite sampling grid.
    assert max_error < 2e-3


def test_second_order_oscillator_matches_expected_step_response() -> None:
    request = SimulationRequest(
        diagram=Diagram.model_validate(second_order_step_diagram()),
        t_start=0.0,
        t_end=6.0,
        dt=0.005,
        solver="solve_ivp",
    )
    result = simulate_request(request)

    t = np.array(result.time)
    y = np.array(result.outputs["y"])
    expected = _underdamped_second_order_step_response(t, k=1.5, wn=3.0, zeta=0.2)

    max_error = np.max(np.abs(y - expected))
    # Second-order oscillatory systems are sensitive; this tolerance is strict but realistic.
    assert max_error < 2e-2
    assert np.max(y) > 1.5  # underdamped overshoot is expected
    assert abs(y[-1] - 1.5) < 2e-2  # final value should approach static gain k


def test_rk4_and_solve_ivp_are_close() -> None:
    diagram = Diagram.model_validate(first_order_step_diagram())
    rk4_result = simulate_request(
        SimulationRequest(
            diagram=diagram,
            t_start=0.0,
            t_end=3.0,
            dt=0.01,
            solver="rk4",
        )
    )
    ivp_result = simulate_request(
        SimulationRequest(
            diagram=diagram,
            t_start=0.0,
            t_end=3.0,
            dt=0.01,
            solver="solve_ivp",
        )
    )

    y_rk4 = np.array(rk4_result.outputs["y"])
    y_ivp = np.array(ivp_result.outputs["y"])
    max_diff = np.max(np.abs(y_rk4 - y_ivp))
    # Both methods solve the same smooth ODE; differences should remain small.
    assert max_diff < 2e-3

