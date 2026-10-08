from __future__ import annotations

from app.examples.hierarchical_scenarios import hierarchical_closed_loop
from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.service import simulate_request
from app.tests.helpers import first_order_step_diagram


def test_assembled_state_space_reproduces_flat_block_graph() -> None:
    result = simulate_request(
        SimulationRequest(
            diagram=Diagram.model_validate(first_order_step_diagram()),
            t_end=3.0,
            dt=0.02,
            solver="rk4",
        )
    )

    verification = result.system_analysis["verification"]
    assert verification["status"] == "verified"
    assert verification["passed"] is True
    assert verification["method"] == "deterministic_mixed_probes"
    assert verification["dimensions_valid"] is True
    assert verification["finite"] is True
    assert verification["probe_count"] == 2
    assert verification["zero_state_residual"] == 0.0
    assert verification["zero_output_residual"] == 0.0
    assert verification["max_state_residual"] <= verification["tolerance"]
    assert verification["max_output_residual"] <= verification["tolerance"]


def test_assembled_state_space_reproduces_multilevel_block_graph() -> None:
    result = simulate_request(
        SimulationRequest(
            diagram=Diagram.model_validate(hierarchical_closed_loop()),
            t_end=4.0,
            dt=0.02,
            solver="solve_ivp",
        )
    )

    verification = result.system_analysis["verification"]
    assert verification["status"] == "verified"
    assert verification["passed"] is True
    assert verification["max_state_residual"] < 1e-9
    assert verification["max_output_residual"] < 1e-9
