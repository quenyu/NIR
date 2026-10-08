from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.analysis.frequency import analyze_frequency_response
from app.analysis.system import assemble_state_space
from app.models.diagram import Diagram
from app.tests.helpers import first_order_step_diagram


def test_first_order_frequency_response_matches_analytic_model() -> None:
    system = assemble_state_space(Diagram.model_validate(first_order_step_diagram()))

    analysis = analyze_frequency_response(system)

    assert analysis["available"] is True
    assert len(analysis["frequency_rad_s"]) == 320

    frequency = np.asarray(analysis["frequency_rad_s"])
    magnitude_db = np.asarray(analysis["magnitude_db"])
    phase_deg = np.asarray(analysis["phase_deg"])
    magnitude_at_two = np.interp(np.log10(2.0), np.log10(frequency), magnitude_db)
    phase_at_two = np.interp(np.log10(2.0), np.log10(frequency), phase_deg)

    assert magnitude_at_two == pytest.approx(20.0 * np.log10(np.sqrt(2.0)), abs=0.01)
    assert phase_at_two == pytest.approx(-45.0, abs=0.02)
    assert analysis["critical_phase_margin_deg"] == pytest.approx(120.0, abs=0.1)
    assert analysis["critical_gain_margin_db"] is None


def test_simulation_response_contains_frequency_analysis(client: TestClient) -> None:
    response = client.post(
        "/simulate",
        json={
            "diagram": first_order_step_diagram(),
            "t_start": 0.0,
            "t_end": 1.0,
            "dt": 0.05,
            "solver": "rk4",
        },
    )

    assert response.status_code == 200
    analysis = response.json()["frequency_analysis"]
    assert analysis["available"] is True
    assert analysis["input_block"] == "step1"
    assert analysis["output_label"] == "y"
    assert len(analysis["nyquist_real"]) == 320


def test_frequency_range_expands_to_capture_high_gain_crossover() -> None:
    system = {
        "matrices": {"A": [[-1.0]], "B": [[10_000.0]], "C": [[1.0]], "D": [[0.0]]},
        "state_dimension": 1,
        "input_dimension": 1,
        "output_dimension": 1,
        "poles": [{"real": -1.0, "imag": 0.0}],
        "input_blocks": ["u"],
        "output_labels": ["y"],
    }

    analysis = analyze_frequency_response(system, points=500)

    assert analysis["gain_crossovers_rad_s"] == pytest.approx([10_000.0], rel=1e-4)


def test_static_unity_gain_does_not_report_hundreds_of_crossovers() -> None:
    system = {
        "matrices": {"A": [], "B": [], "C": [], "D": [[1.0]]},
        "state_dimension": 0,
        "input_dimension": 1,
        "output_dimension": 1,
        "poles": [],
        "input_blocks": ["u"],
        "output_labels": ["y"],
    }

    analysis = analyze_frequency_response(system)

    assert analysis["gain_crossovers_rad_s"] == []
    assert analysis["gain_crossover_status"] == "indeterminate_continuum"
