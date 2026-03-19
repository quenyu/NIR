from __future__ import annotations

from copy import deepcopy
from typing import Any


def block(
    block_id: str,
    block_type: str,
    *,
    parameters: dict[str, Any] | None = None,
    input_ports: list[str] | None = None,
    output_ports: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": block_id,
        "type": block_type,
        "parameters": parameters or {},
        "input_ports": input_ports or [],
        "output_ports": output_ports or [],
    }


def connection(from_block: str, from_port: str, to_block: str, to_port: str) -> dict[str, str]:
    return {
        "from_block": from_block,
        "from_port": from_port,
        "to_block": to_block,
        "to_port": to_port,
    }


def gain_only_diagram() -> dict[str, Any]:
    return {
        "blocks": [
            block(
                "step1",
                "StepInput",
                parameters={"amplitude": 1.0, "t0": 0.0},
                input_ports=[],
                output_ports=["out"],
            ),
            block(
                "gain1",
                "Gain",
                parameters={"k": 2.0},
                input_ports=["in"],
                output_ports=["out"],
            ),
            block(
                "scope1",
                "Scope",
                parameters={"label": "y"},
                input_ports=["in"],
                output_ports=[],
            ),
        ],
        "connections": [
            connection("step1", "out", "gain1", "in"),
            connection("gain1", "out", "scope1", "in"),
        ],
    }


def integrator_step_diagram() -> dict[str, Any]:
    return {
        "blocks": [
            block(
                "step1",
                "StepInput",
                parameters={"amplitude": 1.0, "t0": 0.0},
                input_ports=[],
                output_ports=["out"],
            ),
            block(
                "int1",
                "Integrator",
                parameters={"k": 1.0, "y0": 0.0},
                input_ports=["in"],
                output_ports=["out"],
            ),
            block(
                "scope1",
                "Scope",
                parameters={"label": "y"},
                input_ports=["in"],
                output_ports=[],
            ),
        ],
        "connections": [
            connection("step1", "out", "int1", "in"),
            connection("int1", "out", "scope1", "in"),
        ],
    }


def first_order_step_diagram() -> dict[str, Any]:
    return {
        "blocks": [
            block(
                "step1",
                "StepInput",
                parameters={"amplitude": 1.0, "t0": 0.0},
                input_ports=[],
                output_ports=["out"],
            ),
            block(
                "lag1",
                "FirstOrderLag",
                parameters={"k": 2.0, "T": 0.5, "y0": 0.0},
                input_ports=["in"],
                output_ports=["out"],
            ),
            block(
                "scope1",
                "Scope",
                parameters={"label": "y"},
                input_ports=["in"],
                output_ports=[],
            ),
        ],
        "connections": [
            connection("step1", "out", "lag1", "in"),
            connection("lag1", "out", "scope1", "in"),
        ],
    }


def second_order_step_diagram() -> dict[str, Any]:
    return {
        "blocks": [
            block(
                "step1",
                "StepInput",
                parameters={"amplitude": 1.0, "t0": 0.0},
                input_ports=[],
                output_ports=["out"],
            ),
            block(
                "osc1",
                "SecondOrderOscillator",
                parameters={"k": 1.5, "wn": 3.0, "zeta": 0.2, "y0": 0.0, "v0": 0.0},
                input_ports=["in"],
                output_ports=["out"],
            ),
            block(
                "scope1",
                "Scope",
                parameters={"label": "y"},
                input_ports=["in"],
                output_ports=[],
            ),
        ],
        "connections": [
            connection("step1", "out", "osc1", "in"),
            connection("osc1", "out", "scope1", "in"),
        ],
    }


def closed_loop_dynamic_diagram() -> dict[str, Any]:
    return {
        "blocks": [
            block(
                "step1",
                "StepInput",
                parameters={"amplitude": 1.0, "t0": 0.0},
                input_ports=[],
                output_ports=["out"],
            ),
            block(
                "sum1",
                "Sum",
                parameters={"signs": ["+", "-"]},
                input_ports=["in1", "in2"],
                output_ports=["out"],
            ),
            block(
                "lag1",
                "FirstOrderLag",
                parameters={"k": 1.0, "T": 0.8, "y0": 0.0},
                input_ports=["in"],
                output_ports=["out"],
            ),
            block(
                "fb1",
                "Gain",
                parameters={"k": 1.0},
                input_ports=["in"],
                output_ports=["out"],
            ),
            block(
                "scope1",
                "Scope",
                parameters={"label": "y"},
                input_ports=["in"],
                output_ports=[],
            ),
        ],
        "connections": [
            connection("step1", "out", "sum1", "in1"),
            connection("sum1", "out", "lag1", "in"),
            connection("lag1", "out", "fb1", "in"),
            connection("fb1", "out", "sum1", "in2"),
            connection("lag1", "out", "scope1", "in"),
        ],
    }


def deep_copy_diagram(diagram: dict[str, Any]) -> dict[str, Any]:
    return deepcopy(diagram)

