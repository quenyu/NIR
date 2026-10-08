from __future__ import annotations

import numpy as np
import pytest

from app.analysis.observer import _rank_observability, run_observer_experiment
from app.models.diagram import Diagram
from app.models.observer import ObserverExperimentRequest
from app.tests.helpers import (
    block,
    connection,
    first_order_step_diagram,
    gain_only_diagram,
    second_order_step_diagram,
)


def test_observers_are_reproducible_stable_and_improve_state_estimate() -> None:
    request = ObserverExperimentRequest(
        diagram=Diagram.model_validate(second_order_step_diagram()),
        horizon=4.0,
        dt=0.02,
        process_noise_std=0.005,
        measurement_noise_std=0.03,
        seed=11,
    )

    first = run_observer_experiment(request)
    second = run_observer_experiment(request)

    assert first.model["state_dimension"] == 2
    assert first.model["observability_rank"] == 2
    assert all(item.asymptotically_stable for item in first.observers)
    assert all(item.spectral_radius < 1.0 for item in first.observers)
    assert first.trace.measured_output == second.trace.measured_output
    assert first.metrics == second.metrics
    assert len(first.trace.time) == 201
    assert len(first.trace.true_states) == 2
    assert all(len(series) == 201 for series in first.trace.true_states)
    assert all(metric.improvement_over_zero_estimate_percent > 0.0 for metric in first.metrics)
    kalman = next(metric for metric in first.metrics if metric.method == "kalman")
    assert kalman.three_sigma_coverage_percent is not None
    assert 0.0 <= kalman.three_sigma_coverage_percent <= 100.0


def test_first_order_luenberger_poles_match_reported_error_dynamics() -> None:
    result = run_observer_experiment(
        ObserverExperimentRequest(
            diagram=Diagram.model_validate(first_order_step_diagram()),
            horizon=2.0,
            dt=0.02,
            process_noise_std=0.0,
            measurement_noise_std=0.0,
        )
    )

    observer = next(item for item in result.observers if item.method == "luenberger")
    ad = np.asarray(result.model["Ad"])
    c = np.asarray(result.model["C_measurement"])
    gain = np.asarray(observer.gain)
    actual = np.linalg.eigvals(ad - gain @ c)
    reported = np.asarray(
        [complex(item["real"], item["imag"]) for item in observer.error_dynamics_poles]
    )
    assert np.allclose(np.sort_complex(actual), np.sort_complex(reported), atol=1e-10)
    assert max(abs(value) for value in actual) < 1.0


def test_observer_rejects_static_model() -> None:
    request = ObserverExperimentRequest(
        diagram=Diagram.model_validate(gain_only_diagram())
    )
    with pytest.raises(ValueError, match="динамическую модель"):
        run_observer_experiment(request)


def test_observer_rejects_unobservable_selected_output() -> None:
    diagram = {
        "blocks": [
            block("step1", "StepInput", parameters={"amplitude": 1.0, "t0": 0.0}, output_ports=["out"]),
            block("lag1", "FirstOrderLag", parameters={"k": 1.0, "T": 1.0, "y0": 0.0}, input_ports=["in"], output_ports=["out"]),
            block("lag2", "FirstOrderLag", parameters={"k": 1.0, "T": 1.0, "y0": 0.0}, input_ports=["in"], output_ports=["out"]),
            block("sum1", "Sum", parameters={"signs": ["+", "+"]}, input_ports=["in1", "in2"], output_ports=["out"]),
            block("scope1", "Scope", parameters={"label": "y"}, input_ports=["in"]),
        ],
        "connections": [
            connection("step1", "out", "lag1", "in"),
            connection("step1", "out", "lag2", "in"),
            connection("lag1", "out", "sum1", "in1"),
            connection("lag2", "out", "sum1", "in2"),
            connection("sum1", "out", "scope1", "in"),
        ],
    }
    request = ObserverExperimentRequest(diagram=Diagram.model_validate(diagram))
    with pytest.raises(ValueError, match=r"rank\(O\)=1"):
        run_observer_experiment(request)


def test_sampled_observability_check_catches_mode_aliasing() -> None:
    continuous_a = np.asarray([[0.0, -1.0], [1.0, 0.0]])
    sampled_ad = -np.eye(2)
    c = np.asarray([[1.0, 0.0]])

    assert _rank_observability(continuous_a, c) == 2
    assert _rank_observability(sampled_ad, c) == 1
