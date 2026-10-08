from __future__ import annotations

import numpy as np
import pytest

from app.analysis.output_feedback import run_output_feedback_experiment
from app.models.diagram import Diagram
from app.models.output_feedback import OutputFeedbackRequest
from app.tests.helpers import (
    first_order_step_diagram,
    gain_only_diagram,
    second_order_step_diagram,
)


def test_lqg_is_reproducible_respects_limit_and_separation_principle() -> None:
    request = OutputFeedbackRequest(
        diagram=Diagram.model_validate(second_order_step_diagram()),
        horizon=4.0,
        dt=0.02,
        process_noise_std=0.005,
        measurement_noise_std=0.03,
        control_limit=0.4,
        seed=19,
    )

    first = run_output_feedback_experiment(request)
    second = run_output_feedback_experiment(request)

    assert first == second
    assert first.model["controllability_rank"] == 2
    assert first.model["observability_rank"] == 2
    assert all(item.asymptotically_stable for item in first.designs)
    output_feedback = [item for item in first.designs if item.method != "full_state_lqr"]
    assert all(item.separation_matches for item in output_feedback)
    assert all(len(item.augmented_poles) == 4 for item in output_feedback)
    for control in (
        first.trace.full_state_control,
        first.trace.luenberger_control,
        first.trace.kalman_control,
    ):
        assert max(abs(value) for value in control) <= request.control_limit + 1e-12
    assert any(item.saturation_percent > 0.0 for item in first.metrics)
    assert any("локальную" in warning for warning in first.warnings)


def test_noise_free_first_order_output_feedback_converges() -> None:
    result = run_output_feedback_experiment(
        OutputFeedbackRequest(
            diagram=Diagram.model_validate(first_order_step_diagram()),
            horizon=6.0,
            dt=0.02,
            initial_state_scale=1.0,
            process_noise_std=0.0,
            measurement_noise_std=0.0,
            control_limit=100.0,
        )
    )

    assert all(item.saturation_percent == 0.0 for item in result.metrics)
    assert all(item.final_state_norm < 1e-5 for item in result.metrics)
    assert result.metrics[1].final_estimation_error_norm is not None
    assert result.metrics[1].final_estimation_error_norm < 1e-7
    assert result.metrics[2].final_estimation_error_norm is not None
    assert result.metrics[2].final_estimation_error_norm < 1e-5
    controller_poles = np.asarray(
        [
            complex(item["real"], item["imag"])
            for item in result.designs[0].controller_poles
        ]
    )
    assert np.max(np.abs(controller_poles)) < 1.0


@pytest.mark.parametrize(
    ("diagram_factory", "horizon", "tolerance"),
    [
        (first_order_step_diagram, 6.0, 1e-6),
        (second_order_step_diagram, 10.0, 2e-4),
    ],
)
def test_static_prefilter_tracks_constant_reference_without_noise(
    diagram_factory,
    horizon: float,
    tolerance: float,
) -> None:
    reference = 2.0
    result = run_output_feedback_experiment(
        OutputFeedbackRequest(
            diagram=Diagram.model_validate(diagram_factory()),
            horizon=horizon,
            dt=0.02,
            initial_state_scale=0.0,
            process_noise_std=0.0,
            measurement_noise_std=0.0,
            control_limit=100.0,
            reference=reference,
        )
    )

    assert np.isfinite(result.model["prefilter_gain"])
    assert all(abs(item.final_output - reference) < tolerance for item in result.metrics)
    assert all(abs(item.steady_state_error) < tolerance for item in result.metrics)
    assert all(item.saturation_percent == 0.0 for item in result.metrics)
    assert any("Префильтр" in warning for warning in result.warnings)


def test_output_feedback_rejects_static_model() -> None:
    request = OutputFeedbackRequest(
        diagram=Diagram.model_validate(gain_only_diagram())
    )
    with pytest.raises(ValueError, match="динамическую модель"):
        run_output_feedback_experiment(request)


def test_request_rejects_nonintegral_sample_grid() -> None:
    with pytest.raises(ValueError, match="целое число шагов"):
        OutputFeedbackRequest(
            diagram=Diagram.model_validate(first_order_step_diagram()),
            horizon=1.0,
            dt=0.3,
        )


def test_request_rejects_nonfinite_reference() -> None:
    with pytest.raises(ValueError, match="reference"):
        OutputFeedbackRequest(
            diagram=Diagram.model_validate(first_order_step_diagram()),
            reference=float("nan"),
        )
