from __future__ import annotations

from app.models.diagram import Diagram
from app.tests.helpers import (
    closed_loop_dynamic_diagram,
    deep_copy_diagram,
    integrator_step_diagram,
)
from app.validation.validator import validate_diagram


def test_missing_connection_detected() -> None:
    diagram_dict = deep_copy_diagram(integrator_step_diagram())
    diagram_dict["connections"] = [
        conn for conn in diagram_dict["connections"] if conn["to_block"] != "int1"
    ]
    diagram = Diagram.model_validate(diagram_dict)

    errors = validate_diagram(diagram)
    assert any("Обязательный вход 'in' блока 'int1'" in message for message in errors)


def test_invalid_parameter_detected() -> None:
    diagram_dict = deep_copy_diagram(closed_loop_dynamic_diagram())
    for block in diagram_dict["blocks"]:
        if block["id"] == "lag1":
            block["parameters"]["T"] = 0.0
    diagram = Diagram.model_validate(diagram_dict)

    errors = validate_diagram(diagram)
    assert any("Параметр 'T' должен быть больше 0." in message for message in errors)


def test_invalid_block_type_detected() -> None:
    diagram_dict = deep_copy_diagram(integrator_step_diagram())
    diagram_dict["blocks"][1]["type"] = "AlienBlock"
    diagram = Diagram.model_validate(diagram_dict)

    errors = validate_diagram(diagram)
    assert any("неизвестный тип 'AlienBlock'" in message for message in errors)


def test_invalid_port_reference_detected() -> None:
    diagram_dict = deep_copy_diagram(integrator_step_diagram())
    diagram_dict["connections"][0]["to_port"] = "wrong_port"
    diagram = Diagram.model_validate(diagram_dict)

    errors = validate_diagram(diagram)
    assert any("неизвестный входной порт 'wrong_port'" in message for message in errors)


def test_algebraic_loop_without_dynamic_element_rejected() -> None:
    diagram = Diagram.model_validate(
        {
            "blocks": [
                {
                    "id": "gain1",
                    "type": "Gain",
                    "parameters": {"k": 1.0},
                    "input_ports": ["in"],
                    "output_ports": ["out"],
                },
                {
                    "id": "gain2",
                    "type": "Gain",
                    "parameters": {"k": 1.0},
                    "input_ports": ["in"],
                    "output_ports": ["out"],
                },
                {
                    "id": "scope1",
                    "type": "Scope",
                    "parameters": {"label": "y"},
                    "input_ports": ["in"],
                    "output_ports": [],
                },
            ],
            "connections": [
                {"from_block": "gain1", "from_port": "out", "to_block": "gain2", "to_port": "in"},
                {"from_block": "gain2", "from_port": "out", "to_block": "gain1", "to_port": "in"},
                {"from_block": "gain1", "from_port": "out", "to_block": "scope1", "to_port": "in"},
            ],
        }
    )

    errors = validate_diagram(diagram)
    assert any("алгебраическая петля" in message.lower() for message in errors)


def test_feedback_loop_with_dynamic_element_is_valid() -> None:
    diagram = Diagram.model_validate(closed_loop_dynamic_diagram())
    errors = validate_diagram(diagram)
    assert errors == []
