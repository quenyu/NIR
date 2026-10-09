from __future__ import annotations

import pytest

from app.core.block_specs import get_pid_coefficients
from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.model import diagram_errors as validate_diagram
from app.simulation.service import simulate_request
from app.tests.helpers import analyze, block, connection


def pid_closed_loop_diagram(*, kp: float, ki: float, kd: float = 0.0) -> dict:
    return {
        "blocks": [
            block("step1", "StepInput", parameters={"amplitude": 1.0, "t0": 0.0}, output_ports=["out"]),
            block("sum1", "Sum", parameters={"signs": ["+", "-"]}, input_ports=["in1", "in2"], output_ports=["out"]),
            block(
                "pid1",
                "PIDController",
                parameters={"kp": kp, "ki": ki, "kd": kd, "filter_n": 20.0},
                input_ports=["in"],
                output_ports=["out"],
            ),
            block(
                "plant1",
                "TransferFunction",
                parameters={"numerator": [1.0], "denominator": [1.0, 1.0]},
                input_ports=["in"],
                output_ports=["out"],
            ),
            block("scope1", "Scope", parameters={"label": "y"}, input_ports=["in"]),
        ],
        "connections": [
            connection("step1", "out", "sum1", "in1"),
            connection("sum1", "out", "pid1", "in"),
            connection("pid1", "out", "plant1", "in"),
            connection("plant1", "out", "sum1", "in2"),
            connection("plant1", "out", "scope1", "in"),
        ],
    }


def test_pid_coefficients_cover_p_pi_pd_and_pid() -> None:
    assert get_pid_coefficients({"kp": 2.0, "ki": 0.0, "kd": 0.0, "filter_n": 10.0}) == ([2.0], [1.0])
    assert get_pid_coefficients({"kp": 2.0, "ki": 3.0, "kd": 0.0, "filter_n": 10.0}) == ([2.0, 3.0], [1.0, 0.0])
    assert get_pid_coefficients({"kp": 2.0, "ki": 0.0, "kd": 0.5, "filter_n": 10.0}) == ([7.0, 20.0], [1.0, 10.0])
    assert get_pid_coefficients({"kp": 2.0, "ki": 3.0, "kd": 0.5, "filter_n": 10.0}) == (
        [7.0, 23.0, 30.0],
        [1.0, 10.0, 0.0],
    )


def test_pid_rejects_non_positive_derivative_filter() -> None:
    raw = pid_closed_loop_diagram(kp=1.0, ki=1.0)
    raw["blocks"][2]["parameters"]["filter_n"] = 0.0
    errors = validate_diagram(Diagram.model_validate(raw))
    assert any("filter_n" in error for error in errors)


def test_pi_controller_eliminates_step_steady_state_error() -> None:
    diagram = Diagram.model_validate(pid_closed_loop_diagram(kp=2.0, ki=1.0))
    response = simulate_request(
        SimulationRequest(diagram=diagram, t_end=15.0, dt=0.02, solver="solve_ivp")
    )

    assert response.outputs["y"][-1] == pytest.approx(1.0, abs=1e-3)
    assert response.system_analysis["stability"] == "stable"
    assert response.system_analysis["state_dimension"] == 2


def test_global_model_contains_pid_and_plant_states() -> None:
    diagram = Diagram.model_validate(pid_closed_loop_diagram(kp=2.0, ki=1.0))
    analysis = analyze(diagram)

    assert analysis["state_dimension"] == 2
    assert analysis["controllability"]["full_rank"] is True
    assert analysis["observability"]["full_rank"] is True
    assert analysis["stability"] == "stable"
