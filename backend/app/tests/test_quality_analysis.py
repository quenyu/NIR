from __future__ import annotations

import numpy as np
import pytest

from app.analysis.quality import compute_quality_metrics
from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.service import simulate_request
from app.tests.structural_cases import DiagramBuilder


def _metrics(time, values, y_inf, t_step=0.0, reference=None):
    return compute_quality_metrics(
        time,
        {"y": values},
        steady_values={"y": y_inf},
        t_step=t_step,
        references=None if reference is None else {"y": reference},
    )["y"]


def test_first_order_indices_match_closed_form() -> None:
    """y = 1 - e^{-t}: t_rise = ln 9, t_settle(2 %) = ln 50, no overshoot."""

    time = np.linspace(0.0, 10.0, 100_001)
    row = _metrics(time, 1.0 - np.exp(-time), y_inf=1.0)

    assert row["target_source"] == "model_steady_state"
    assert row["overshoot_percent"] == pytest.approx(0.0, abs=1e-12)
    # Linear interpolation between samples 1e-4 apart: error O(h^2).
    assert row["rise_time"] == pytest.approx(np.log(9.0), abs=1e-6)
    # Settling is quantized to the sample grid.
    assert row["settling_time"] == pytest.approx(np.log(50.0), abs=1e-4)


def test_underdamped_overshoot_matches_closed_form() -> None:
    zeta, wn = 0.3, 2.0
    wd = wn * np.sqrt(1.0 - zeta**2)
    time = np.linspace(0.0, 20.0, 200_001)
    y = 1.0 - np.exp(-zeta * wn * time) * (np.cos(wd * time) + zeta / np.sqrt(1 - zeta**2) * np.sin(wd * time))

    row = _metrics(time, y, y_inf=1.0)

    expected = 100.0 * np.exp(-zeta * np.pi / np.sqrt(1.0 - zeta**2))
    assert row["overshoot_percent"] == pytest.approx(expected, rel=1e-6)


def test_steady_state_is_not_taken_from_the_last_sample() -> None:
    """The window ends before the response settles: y(t_end) ~ 0.63, y_inf = 1."""

    time = np.linspace(0.0, 1.0, 1001)
    row = _metrics(time, 1.0 - np.exp(-time), y_inf=1.0)

    assert row["final_value"] == pytest.approx(1.0 - np.exp(-1.0))
    assert row["target_value"] == 1.0
    assert row["settling_time"] is None
    assert "2 %" in row["reason"]


def test_metrics_are_measured_from_the_step_instant() -> None:
    time = np.linspace(0.0, 12.0, 120_001)
    shifted = np.where(time >= 2.0, 1.0 - np.exp(-(time - 2.0)), 0.0)

    row = _metrics(time, shifted, y_inf=1.0, t_step=2.0)

    assert row["settling_time"] == pytest.approx(np.log(50.0), abs=1e-3)


def test_tracking_errors_use_reference_and_model_steady_state() -> None:
    time = np.linspace(0.0, 10.0, 10_001)
    row = _metrics(time, 0.8 * (1.0 - np.exp(-time)), y_inf=0.8, reference=1.0)

    assert row["steady_state_error"] == pytest.approx(0.2)
    # IAE = integral of 0.2 + 0.8 e^{-t} over [0, 10]; trapezoid error O(h^2).
    assert row["integral_absolute_error"] == pytest.approx(2.0 + 0.8 * (1 - np.exp(-10.0)), rel=1e-6)


def test_missing_steady_state_leaves_step_indices_undefined() -> None:
    time = np.linspace(0.0, 5.0, 501)
    row = compute_quality_metrics(
        time, {"y": np.exp(time) - 1.0}, steady_values={"y": None}, t_step=0.0,
        unavailable_reason="неустойчива",
    )["y"]

    assert row["settling_time"] is None
    assert row["rise_time"] is None
    assert row["overshoot_percent"] is None
    assert row["reason"] == "неустойчива"


def _unstable_plant() -> dict:
    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    b.add("g", "TransferFunction", numerator=[1.0], denominator=[1.0, -1.0])
    b.add("y", "Scope", label="y")
    b.link("u", "g")
    b.link("g", "y")
    return b.build()


def test_diverging_signal_has_no_settling_time_end_to_end() -> None:
    result = simulate_request(
        SimulationRequest(diagram=Diagram.model_validate(_unstable_plant()), t_end=5.0, dt=0.01)
    )

    row = result.quality_metrics["y"]
    assert result.system_analysis["stability"] == "unstable"
    assert row["target_value"] is None
    assert row["settling_time"] is None
    assert row["rise_time"] is None
    assert "неустойчива" in row["reason"]


def test_step_after_the_window_leaves_indices_undefined() -> None:
    """y_inf assumes the step is on; a step at t0 >= t_end never reaches the trajectory."""

    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=1.0, t0=10.0)
    b.add("g", "TransferFunction", numerator=[1.0], denominator=[1.0, 1.0])
    b.add("y", "Scope", label="y")
    b.link("u", "g")
    b.link("g", "y")
    result = simulate_request(SimulationRequest(diagram=Diagram.model_validate(b.build()), t_end=5.0, dt=0.01))

    row = result.quality_metrics["y"]
    assert row["target_value"] is None
    assert row["settling_time"] is None
    assert "после окончания" in row["reason"]
