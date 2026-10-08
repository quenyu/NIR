from __future__ import annotations

import numpy as np

from app.analysis.system import assemble_state_space
from app.examples.hierarchical_scenarios import SCENARIOS, hierarchical_closed_loop
from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.hierarchy import flatten_diagram
from app.simulation.service import simulate_request
from app.validation.validator import validate_diagram


EXPECTED_STATE_DIMENSIONS = {
    "two_level_plant": 1,
    "three_level_cascade": 2,
    "hierarchical_closed_loop": 3,
    "compact_five_subsystem_chain": 6,
}


def test_hierarchical_scenarios_compile_to_equivalent_flat_models() -> None:
    for name, build_scenario in SCENARIOS.items():
        hierarchical = Diagram.model_validate(build_scenario())
        assert validate_diagram(hierarchical) == []

        flattened = flatten_diagram(hierarchical)
        hierarchical_analysis = assemble_state_space(hierarchical)
        flat_analysis = assemble_state_space(flattened)

        assert hierarchical_analysis["state_dimension"] == EXPECTED_STATE_DIMENSIONS[name]
        for matrix_name in ("A", "B", "C", "D"):
            assert np.allclose(
                hierarchical_analysis["matrices"][matrix_name],
                flat_analysis["matrices"][matrix_name],
            )


def test_three_level_closed_loop_has_hierarchical_states_and_is_stable() -> None:
    diagram = Diagram.model_validate(hierarchical_closed_loop())
    analysis = assemble_state_space(diagram)

    assert analysis["state_labels"] == [
        "plant::actuator::actuator_lag",
        "plant::oscillator.x1",
        "plant::oscillator.x2",
    ]
    assert analysis["stability"] == "stable"
    assert analysis["controllability"]["full_rank"] is True
    assert analysis["observability"]["full_rank"] is True

    result = simulate_request(
        SimulationRequest(diagram=diagram, t_start=0.0, t_end=8.0, dt=0.02, solver="rk4")
    )
    output = np.asarray(result.outputs["y"])

    state_mapping = result.metadata["provenance"]["state_mapping"]
    assert [
        (
            state["global_index"],
            state["block_id"],
            state["subsystem_path"],
            state["local_index"],
        )
        for state in state_mapping
    ] == [
        (0, "plant::actuator::actuator_lag", ["plant", "actuator"], 0),
        (1, "plant::oscillator", ["plant"], 0),
        (2, "plant::oscillator", ["plant"], 1),
    ]

    assert np.isfinite(output).all()
    assert 0.65 < output[-1] < 0.70
    assert 1.0 < np.max(output) < 1.10


def test_source_inside_subsystem_is_an_external_state_space_input() -> None:
    diagram = Diagram.model_validate(SCENARIOS["compact_five_subsystem_chain"]())
    analysis = assemble_state_space(diagram)

    assert analysis["input_blocks"] == ["reference::step"]
    assert analysis["input_dimension"] == 1
    assert np.asarray(analysis["matrices"]["B"]).shape == (6, 1)
