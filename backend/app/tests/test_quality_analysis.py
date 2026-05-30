from __future__ import annotations

import pytest

from app.analysis.quality import compute_quality_metrics


def test_quality_metrics_empty_signal_returns_null_metrics() -> None:
    metrics = compute_quality_metrics([0.0, 1.0], {"y": []})

    assert metrics["y"]["final_value"] is None
    assert metrics["y"]["max_value"] is None
    assert metrics["y"]["steady_state_error"] is None
    assert metrics["y"]["integral_absolute_error"] is None
    assert metrics["y"]["integral_squared_error"] is None


def test_quality_metrics_single_sample_does_not_fail() -> None:
    metrics = compute_quality_metrics([0.0], {"y": [2.0]})

    assert metrics["y"]["final_value"] == pytest.approx(2.0)
    assert metrics["y"]["max_value"] == pytest.approx(2.0)
    assert metrics["y"]["steady_state_error"] is None
    assert metrics["y"]["integral_absolute_error"] is None
    assert metrics["y"]["integral_squared_error"] is None


def test_quality_metrics_non_finite_signal_returns_null_metrics() -> None:
    metrics = compute_quality_metrics([0.0, 1.0, 2.0], {"y": [0.0, float("inf"), 1.0]})

    assert metrics["y"]["final_value"] is None
    assert metrics["y"]["max_value"] is None
    assert metrics["y"]["overshoot_percent"] is None
    assert metrics["y"]["settling_time"] is None
    assert metrics["y"]["rise_time"] is None


def test_quality_metrics_basic_step_like_signal_without_reference() -> None:
    metrics = compute_quality_metrics(
        [0.0, 1.0, 2.0, 3.0],
        {"y": [0.0, 1.2, 1.0, 1.0]},
    )

    row = metrics["y"]
    assert row["final_value"] == pytest.approx(1.0)
    assert row["max_value"] == pytest.approx(1.2)
    assert row["overshoot_percent"] == pytest.approx(20.0)
    assert row["settling_time"] == pytest.approx(2.0)
    assert row["reference"] is None
    assert row["steady_state_error"] is None
    assert row["integral_absolute_error"] is None
    assert row["integral_squared_error"] is None


def test_quality_metrics_unsettled_signal_returns_null_settling_time() -> None:
    metrics = compute_quality_metrics([0.0, 1.0, 2.0], {"y": [0.0, 1.0, 1.5]})

    assert metrics["y"]["settling_time"] is None


def test_quality_metrics_zero_final_value_has_no_overshoot_percent() -> None:
    metrics = compute_quality_metrics([0.0, 1.0], {"y": [1.0, 0.0]})

    assert metrics["y"]["overshoot_percent"] is None
