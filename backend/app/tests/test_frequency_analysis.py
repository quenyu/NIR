from __future__ import annotations

import numpy as np
import pytest

from app.analysis.frequency import analyze_frequency_response
from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.model import compile_model
from app.simulation.service import simulate_request
from app.tests.helpers import first_order_step_diagram
from app.tests.structural_cases import DiagramBuilder, mimo_subsystem_case


def _response(diagram: dict) -> dict:
    return analyze_frequency_response(compile_model(Diagram.model_validate(diagram)).model)


def test_first_order_bode_matches_analytic_model() -> None:
    """first_order_step_diagram: W(s) = 2 / (0.5 s + 1)."""

    response = _response(first_order_step_diagram())
    channel = response["channels"][0]
    omega = np.asarray(response["frequency_rad_s"])
    expected = 2.0 / (0.5j * omega + 1.0)

    np.testing.assert_allclose(channel["magnitude_db"], 20 * np.log10(np.abs(expected)), rtol=1e-12)
    np.testing.assert_allclose(channel["phase_deg"], np.rad2deg(np.angle(expected)), atol=1e-10)
    assert "gain_margins_db" not in response


def test_every_input_output_channel_is_reported() -> None:
    response = _response(mimo_subsystem_case().diagram)

    assert [(c["input_block"], c["output_label"]) for c in response["channels"]] == [
        ("u1", "p"), ("u1", "q"), ("u2", "p"), ("u2", "q"),
    ]


def test_undamped_oscillator_does_not_break_the_analysis() -> None:
    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    b.add("g", "TransferFunction", numerator=[1.0], denominator=[1.0, 0.0, 1.0])
    b.add("y", "Scope", label="y")
    b.link("u", "g")
    b.link("g", "y")

    response = _response(b.build())

    magnitudes = response["channels"][0]["magnitude_db"]
    assert response["available"] is True
    assert all(value is None or np.isfinite(value) for value in magnitudes)


def test_simulation_response_contains_frequency_analysis() -> None:
    result = simulate_request(
        SimulationRequest(diagram=Diagram.model_validate(first_order_step_diagram()), t_end=1.0, dt=0.1)
    )

    assert result.frequency_analysis["available"] is True
    assert result.frequency_analysis["channels"][0]["output_label"] == "y"


def test_static_model_has_flat_response() -> None:
    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    b.add("k", "Gain", k=1.0)
    b.add("y", "Scope", label="y")
    b.link("u", "k")
    b.link("k", "y")

    channel = _response(b.build())["channels"][0]

    assert channel["magnitude_db"] == pytest.approx([0.0] * len(channel["magnitude_db"]))
