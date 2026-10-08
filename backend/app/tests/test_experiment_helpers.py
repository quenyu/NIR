from __future__ import annotations

import numpy as np

from app.experiments.metrics import compute_error_metrics, summarize_timings
from app.experiments.reference_models import (
    first_order_step_response,
    integrator_step_response,
    underdamped_second_order_step_response,
)
from app.experiments.scenarios import build_scenarios


def test_compute_error_metrics_returns_expected_values() -> None:
    actual = np.array([0.0, 1.0, 2.0])
    reference = np.array([0.0, 1.5, 1.0])

    metrics = compute_error_metrics(actual, reference)

    assert metrics.max_abs_error == 1.0
    assert np.isclose(metrics.rmse, np.sqrt((0.0**2 + 0.5**2 + 1.0**2) / 3.0))
    assert metrics.final_value_error == 1.0


def test_summarize_timings_returns_basic_statistics() -> None:
    summary = summarize_timings([1.0, 2.0, 3.0])

    assert summary.mean_ms == 2.0
    assert summary.median_ms == 2.0
    assert np.isclose(summary.std_ms, np.std(np.array([1.0, 2.0, 3.0])))
    assert summary.min_ms == 1.0
    assert summary.max_ms == 3.0


def test_reference_models_match_known_limits() -> None:
    time = np.array([0.0, 1.0, 2.0])

    integrator = integrator_step_response(time)
    first_order = first_order_step_response(time, k=2.0, t_const=0.5)
    second_order = underdamped_second_order_step_response(time, k=1.5, wn=3.0, zeta=0.2)

    assert np.allclose(integrator, np.array([0.0, 1.0, 2.0]))
    assert np.isclose(first_order[0], 0.0)
    assert np.isclose(first_order[-1], 2.0 * (1.0 - np.exp(-4.0)))
    assert np.isclose(second_order[0], 0.0)
    assert second_order.max() > 1.5


def test_scenarios_point_to_existing_example_files() -> None:
    scenarios = build_scenarios()

    assert [scenario.slug for scenario in scenarios] == [
        "integrator",
        "first_order_lag",
        "second_order_oscillator",
        "butterworth_lpf",
    ]
    assert all(scenario.diagram_path.exists() for scenario in scenarios)
