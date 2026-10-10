from __future__ import annotations

import numpy as np
import pytest

from app.core.block_specs import has_direct_feedthrough
from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.assembly import block_realization
from app.simulation.model import compile_model
from app.simulation.model import diagram_errors as validate_diagram
from app.simulation.service import simulate_request


def _tf_realization(diagram: Diagram):
    block = next(b for b in diagram.blocks if b.id == "tf1")
    return block_realization(block)

def _block(
    block_id: str,
    block_type: str,
    parameters: dict[str, object],
    input_ports: list[str],
    output_ports: list[str],
) -> dict[str, object]:
    return {
        "id": block_id,
        "type": block_type,
        "parameters": parameters,
        "input_ports": input_ports,
        "output_ports": output_ports,
    }


def _connection(from_block: str, from_port: str, to_block: str, to_port: str) -> dict[str, str]:
    return {
        "from_block": from_block,
        "from_port": from_port,
        "to_block": to_block,
        "to_port": to_port,
    }


def _tf_step_diagram(
    numerator: list[float],
    denominator: list[float],
    *,
    tf_id: str = "tf1",
) -> dict[str, object]:
    return {
        "blocks": [
            _block("step1", "StepInput", {"amplitude": 1.0, "t0": 0.0}, [], ["out"]),
            _block(
                tf_id,
                "TransferFunction",
                {"numerator": numerator, "denominator": denominator},
                ["in"],
                ["out"],
            ),
            _block("scope1", "Scope", {"label": "y"}, ["in"], []),
        ],
        "connections": [
            _connection("step1", "out", tf_id, "in"),
            _connection(tf_id, "out", "scope1", "in"),
        ],
    }


def test_transfer_function_validation_first_order() -> None:
    diagram = Diagram.model_validate(_tf_step_diagram([1.0], [1.0, 1.0]))

    assert validate_diagram(diagram) == []


def test_transfer_function_validation_second_order() -> None:
    diagram = Diagram.model_validate(_tf_step_diagram([1.0, 3.0], [1.0, 2.0, 5.0]))

    assert validate_diagram(diagram) == []


def test_transfer_function_rejects_empty_denominator() -> None:
    diagram = Diagram.model_validate(_tf_step_diagram([1.0], []))

    errors = validate_diagram(diagram)

    assert any("denominator" in message and "empty" in message for message in errors)


def test_transfer_function_rejects_empty_numerator() -> None:
    diagram = Diagram.model_validate(_tf_step_diagram([], [1.0, 1.0]))

    errors = validate_diagram(diagram)

    assert any("numerator" in message and "empty" in message for message in errors)


def test_transfer_function_rejects_zero_denominator_leading_coefficient() -> None:
    diagram = Diagram.model_validate(_tf_step_diagram([1.0], [0.0, 1.0]))

    errors = validate_diagram(diagram)

    assert any("denominator[0]" in message and "равен 0" in message for message in errors)


def test_transfer_function_rejects_improper_numerator_order() -> None:
    diagram = Diagram.model_validate(_tf_step_diagram([1.0, 2.0, 3.0], [1.0, 1.0]))

    errors = validate_diagram(diagram)

    assert any("numerator" in message and "порядок знаменателя" in message for message in errors)


def test_stable_transfer_function_step_response_converges_to_one() -> None:
    request = SimulationRequest(
        diagram=Diagram.model_validate(_tf_step_diagram([1.0], [1.0, 1.0])),
        t_start=0.0,
        t_end=8.0,
        dt=0.01,
        solver="rk4",
    )

    result = simulate_request(request)
    y = np.array(result.outputs["y"])

    assert y[-1] == pytest.approx(1.0, abs=2e-3)
    assert result.system_analysis["stability"] == "stable"
    assert result.quality_metrics["y"]["final_value"] == pytest.approx(y[-1])


def test_static_transfer_function_behaves_like_gain() -> None:
    request = SimulationRequest(
        diagram=Diagram.model_validate(_tf_step_diagram([2.0], [4.0])),
        t_start=0.0,
        t_end=1.0,
        dt=0.1,
        solver="rk4",
    )

    result = simulate_request(request)

    assert result.metadata["state_dimension"] == 0
    assert np.allclose(result.outputs["y"], 0.5)


def test_unstable_transfer_function_stability_analysis() -> None:
    request = SimulationRequest(
        diagram=Diagram.model_validate(_tf_step_diagram([1.0], [1.0, -1.0])),
        t_start=0.0,
        t_end=1.0,
        dt=0.01,
        solver="rk4",
    )

    result = simulate_request(request)
    stability = result.system_analysis

    assert stability["stability"] == "unstable"
    assert stability["poles"][0]["real"] == pytest.approx(1.0)


def test_integrator_transfer_function_is_marginal() -> None:
    request = SimulationRequest(
        diagram=Diagram.model_validate(_tf_step_diagram([1.0], [1.0, 0.0])),
        t_start=0.0,
        t_end=1.0,
        dt=0.01,
        solver="rk4",
    )

    result = simulate_request(request)
    stability = result.system_analysis

    assert stability["stability"] == "marginal"
    assert stability["poles"][0]["real"] == pytest.approx(0.0)


def test_second_order_transfer_function_is_stable() -> None:
    request = SimulationRequest(
        diagram=Diagram.model_validate(_tf_step_diagram([1.0], [1.0, 2.0, 5.0])),
        t_start=0.0,
        t_end=1.0,
        dt=0.01,
        solver="rk4",
    )

    result = simulate_request(request)

    assert result.system_analysis["stability"] == "stable"


def test_transfer_function_normalizes_non_unit_denominator() -> None:
    request = SimulationRequest(
        diagram=Diagram.model_validate(_tf_step_diagram([2.0], [3.0, 6.0])),
        t_start=0.0,
        t_end=6.0,
        dt=0.01,
        solver="rk4",
    )

    result = simulate_request(request)
    model = _tf_realization(request.diagram)

    assert result.metadata["state_dimension"] == 1
    assert model.a.shape == (1, 1)
    assert model.b.shape == (1, 1)
    assert model.c.shape == (1, 1)
    assert model.d[0, 0] == pytest.approx(0.0)
    assert model.a[0, 0] == pytest.approx(-2.0)
    assert model.c[0, 0] == pytest.approx(2.0 / 3.0)
    assert result.outputs["y"][-1] == pytest.approx(1.0 / 3.0, abs=2e-4)


def test_transfer_function_state_space_shapes_match_denominator_order() -> None:
    diagram = Diagram.model_validate(_tf_step_diagram([1.0], [1.0, 2.0, 5.0]))

    model = _tf_realization(diagram)

    assert compile_model(diagram).model.x0.shape == (2,)
    assert model.a.shape == (2, 2)
    assert model.b.shape == (2, 1)
    assert model.c.shape == (1, 2)
    assert model.d.shape == (1, 1)


def test_proper_not_strictly_proper_transfer_function_has_direct_feedthrough() -> None:
    diagram = Diagram.model_validate(_tf_step_diagram([1.0, 1.0], [1.0, 2.0]))

    model = _tf_realization(diagram)

    assert has_direct_feedthrough(
        "TransferFunction",
        {"numerator": [1.0, 1.0], "denominator": [1.0, 2.0]},
    )
    assert model.d[0, 0] == pytest.approx(1.0)


def test_direct_feedthrough_transfer_function_loop_is_invalid() -> None:
    diagram = Diagram.model_validate(
        {
            "blocks": [
                _block("sum1", "Sum", {"signs": ["+"]}, ["in1"], ["out"]),
                _block(
                    "tf1",
                    "TransferFunction",
                    {"numerator": [1.0, 1.0], "denominator": [1.0, 2.0]},
                    ["in"],
                    ["out"],
                ),
            ],
            "connections": [
                _connection("sum1", "out", "tf1", "in"),
                _connection("tf1", "out", "sum1", "in1"),
            ],
        }
    )

    errors = validate_diagram(diagram)

    assert errors


def test_parallel_transfer_function_branches_into_sum_are_valid() -> None:
    diagram = Diagram.model_validate(
        {
            "blocks": [
                _block("step1", "StepInput", {"amplitude": 1.0, "t0": 0.0}, [], ["out"]),
                _block(
                    "tf1",
                    "TransferFunction",
                    {"numerator": [1.0], "denominator": [1.0, 1.0]},
                    ["in"],
                    ["out"],
                ),
                _block(
                    "tf2",
                    "TransferFunction",
                    {"numerator": [2.0], "denominator": [1.0, 2.0]},
                    ["in"],
                    ["out"],
                ),
                _block("sum1", "Sum", {"signs": ["+", "+"]}, ["in1", "in2"], ["out"]),
                _block("scope1", "Scope", {"label": "y"}, ["in"], []),
            ],
            "connections": [
                _connection("step1", "out", "tf1", "in"),
                _connection("step1", "out", "tf2", "in"),
                _connection("tf1", "out", "sum1", "in1"),
                _connection("tf2", "out", "sum1", "in2"),
                _connection("sum1", "out", "scope1", "in"),
            ],
        }
    )

    assert validate_diagram(diagram) == []


def test_feedback_loop_through_dynamic_transfer_function_is_valid() -> None:
    diagram = Diagram.model_validate(
        {
            "blocks": [
                _block("step1", "StepInput", {"amplitude": 1.0, "t0": 0.0}, [], ["out"]),
                _block("sum1", "Sum", {"signs": ["+", "-"]}, ["in1", "in2"], ["out"]),
                _block(
                    "tf1",
                    "TransferFunction",
                    {"numerator": [1.0], "denominator": [1.0, 1.0]},
                    ["in"],
                    ["out"],
                ),
                _block("gain1", "Gain", {"k": 1.0}, ["in"], ["out"]),
                _block("scope1", "Scope", {"label": "y"}, ["in"], []),
            ],
            "connections": [
                _connection("step1", "out", "sum1", "in1"),
                _connection("sum1", "out", "tf1", "in"),
                _connection("tf1", "out", "gain1", "in"),
                _connection("gain1", "out", "sum1", "in2"),
                _connection("tf1", "out", "scope1", "in"),
            ],
        }
    )

    assert validate_diagram(diagram) == []


def test_pure_algebraic_loop_is_invalid() -> None:
    diagram = Diagram.model_validate(
        {
            "blocks": [
                _block("gain1", "Gain", {"k": 1.0}, ["in"], ["out"]),
                _block("sum1", "Sum", {"signs": ["+"]}, ["in1"], ["out"]),
            ],
            "connections": [
                _connection("gain1", "out", "sum1", "in1"),
                _connection("sum1", "out", "gain1", "in"),
            ],
        }
    )

    errors = validate_diagram(diagram)

    assert errors
