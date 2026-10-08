from __future__ import annotations

import json
from pathlib import Path

from app.analysis.system import assemble_state_space
from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.hierarchy import flatten_diagram
from app.simulation.service import simulate_request
from app.validation.validator import validate_diagram


EXAMPLE_PATH = Path(__file__).parents[3] / "examples" / "dc_motor_speed_control.json"


def load_example() -> Diagram:
    return Diagram.model_validate(json.loads(EXAMPLE_PATH.read_text(encoding="utf-8")))


def test_dc_motor_example_flattens_to_a_valid_physical_model() -> None:
    diagram = load_example()

    assert validate_diagram(diagram) == []
    flattened = flatten_diagram(diagram)
    flattened_ids = {block.id for block in flattened.blocks}
    assert {
        "dc_motor::electromagnetic",
        "dc_motor::mechanics",
        "dc_motor::back_emf",
    }.issubset(flattened_ids)

    analysis = assemble_state_space(diagram)
    assert analysis["state_dimension"] == 4
    assert analysis["stability"] == "stable"
    assert analysis["controllability"]["full_rank"] is True
    assert analysis["observability"]["full_rank"] is True


def test_dc_motor_example_tracks_the_speed_reference() -> None:
    response = simulate_request(
        SimulationRequest(diagram=load_example(), t_end=6.0, dt=0.01, solver="solve_ivp")
    )

    speed = response.outputs["ω(t), рад/с"]
    assert response.success is True
    assert response.system_analysis["stability"] == "stable"
    assert abs(speed[-1] - 1.0) <= 0.01
    assert max(speed) <= 1.01
    quality = response.quality_metrics["ω(t), рад/с"]
    settling_time = quality["settling_time"]
    assert settling_time is not None
    # Two-percent band is measured against the explicit reference 1.0.
    assert abs(settling_time - 4.54) <= 0.08
    assert quality["reference"] == 1.0
    assert quality["steady_state_error"] is not None
    assert abs(quality["steady_state_error"]) <= 0.01
    assert quality["integral_absolute_error"] is not None
    assert quality["integral_squared_error"] is not None
    assert response.system_analysis["state_dimension"] == 4
