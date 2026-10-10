from __future__ import annotations

import pytest

from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.hierarchy import flatten_diagram
from app.simulation.model import diagram_errors as validate_diagram
from app.simulation.service import simulate_request
from app.tests.helpers import analyze


def interface_block(block_id: str, block_type: str, port: str) -> dict[str, object]:
    return {
        "id": block_id,
        "type": block_type,
        "parameters": {"port": port},
        "input_ports": [] if block_type == "SubsystemInput" else ["in"],
        "output_ports": ["out"] if block_type == "SubsystemInput" else [],
    }


def gain_subsystem(gain: float) -> dict[str, object]:
    return {
        "blocks": [
            interface_block("input", "SubsystemInput", "in"),
            {
                "id": "gain",
                "type": "Gain",
                "parameters": {"k": gain},
                "input_ports": ["in"],
                "output_ports": ["out"],
            },
            interface_block("output", "SubsystemOutput", "out"),
        ],
        "connections": [
            {"from_block": "input", "from_port": "out", "to_block": "gain", "to_port": "in"},
            {"from_block": "gain", "from_port": "out", "to_block": "output", "to_port": "in"},
        ],
    }


def root_with_subsystem(nested: dict[str, object]) -> dict[str, object]:
    return {
        "blocks": [
            {
                "id": "step",
                "type": "StepInput",
                "parameters": {"amplitude": 1.0, "t0": 0.0},
                "input_ports": [],
                "output_ports": ["out"],
            },
            {
                "id": "plant",
                "type": "Subsystem",
                "parameters": {"diagram": nested},
                "input_ports": ["in"],
                "output_ports": ["out"],
            },
            {
                "id": "scope",
                "type": "Scope",
                "parameters": {"label": "y"},
                "input_ports": ["in"],
                "output_ports": [],
            },
        ],
        "connections": [
            {"from_block": "step", "from_port": "out", "to_block": "plant", "to_port": "in"},
            {"from_block": "plant", "from_port": "out", "to_block": "scope", "to_port": "in"},
        ],
    }


def test_subsystem_is_flattened_with_hierarchical_block_ids() -> None:
    diagram = Diagram.model_validate(root_with_subsystem(gain_subsystem(2.5)))

    flattened = flatten_diagram(diagram)

    assert {block.id for block in flattened.blocks} == {"step", "plant::gain", "scope"}
    assert any(
        connection.from_block == "step" and connection.to_block == "plant::gain"
        for connection in flattened.connections
    )
    assert any(
        connection.from_block == "plant::gain" and connection.to_block == "scope"
        for connection in flattened.connections
    )


def test_subsystem_changes_real_simulation_result() -> None:
    diagram = Diagram.model_validate(root_with_subsystem(gain_subsystem(2.5)))

    result = simulate_request(
        SimulationRequest(diagram=diagram, t_start=0.0, t_end=0.2, dt=0.1, solver="rk4")
    )

    assert result.outputs["y"] == pytest.approx([2.5, 2.5, 2.5])


def test_nested_subsystems_are_expanded_recursively() -> None:
    inner = gain_subsystem(3.0)
    outer = {
        "blocks": [
            interface_block("input", "SubsystemInput", "in"),
            {
                "id": "inner",
                "type": "Subsystem",
                "parameters": {"diagram": inner},
                "input_ports": ["in"],
                "output_ports": ["out"],
            },
            interface_block("output", "SubsystemOutput", "out"),
        ],
        "connections": [
            {"from_block": "input", "from_port": "out", "to_block": "inner", "to_port": "in"},
            {"from_block": "inner", "from_port": "out", "to_block": "output", "to_port": "in"},
        ],
    }
    diagram = Diagram.model_validate(root_with_subsystem(outer))

    flattened = flatten_diagram(diagram)
    result = simulate_request(
        SimulationRequest(diagram=diagram, t_start=0.0, t_end=0.1, dt=0.1, solver="rk4")
    )

    assert "plant::inner::gain" in {block.id for block in flattened.blocks}
    assert result.outputs["y"] == pytest.approx([3.0, 3.0])


def test_dynamic_state_inside_subsystem_is_part_of_global_model() -> None:
    nested = gain_subsystem(1.0)
    nested["blocks"][1] = {
        "id": "lag",
        "type": "FirstOrderLag",
        "parameters": {"k": 2.0, "T": 0.5, "y0": 0.0},
        "input_ports": ["in"],
        "output_ports": ["out"],
    }
    nested["connections"][0]["to_block"] = "lag"
    nested["connections"][1]["from_block"] = "lag"
    diagram = Diagram.model_validate(root_with_subsystem(nested))

    analysis = analyze(diagram)

    assert analysis["state_dimension"] == 1
    assert analysis["state_labels"] == ["plant::lag"]
    assert analysis["matrices"]["A"][0][0] == pytest.approx(-2.0)
    assert analysis["matrices"]["B"][0][0] == pytest.approx(4.0)


def test_duplicate_subsystem_interface_port_is_rejected() -> None:
    nested = gain_subsystem(1.0)
    nested["blocks"].insert(1, interface_block("input2", "SubsystemInput", "in"))
    diagram_data = root_with_subsystem(nested)
    diagram_data["blocks"][1]["input_ports"] = ["in", "in"]
    diagram = Diagram.model_validate(diagram_data)

    errors = validate_diagram(diagram)

    assert any("уникальными" in error for error in errors)
