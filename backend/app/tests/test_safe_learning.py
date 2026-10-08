from __future__ import annotations

import json

import numpy as np
import pytest

from app.analysis.safe_learning import ActionDecision, _supervised_policy, run_safe_learning
from app.models.diagram import Diagram
from app.models.learning import SafeLearningRequest
from app.tests.helpers import first_order_step_diagram, gain_only_diagram


def test_safe_learning_is_reproducible_and_reports_holdout_metrics() -> None:
    request = SafeLearningRequest(
        diagram=Diagram.model_validate(first_order_step_diagram()),
        horizon=2.0,
        dt=0.02,
        training_trajectories=4,
        validation_trajectories=6,
        input_limit=0.05,
        mpc_horizon_steps=10,
        on_policy_rounds=1,
        on_policy_trajectories=2,
        seed=7,
    )

    first = run_safe_learning(request)
    second = run_safe_learning(request)

    assert first.model["state_dimension"] == 1
    assert first.model["controllability_rank"] == 1
    assert first.dataset.training_samples > 100
    assert first.dataset.on_policy_samples > 0
    assert first.dataset.test_imitation_rmse == second.dataset.test_imitation_rmse
    assert first.teacher.kind == "finite_horizon_linear_mpc"
    assert first.teacher.input_constraint == "-0.05 <= u_k <= 0.05"
    assert first.teacher.unconverged_queries == 0
    assert len(first.policies) == 3
    assert all(policy.asymptotically_stable for policy in first.policies)
    assert all(policy.pole_domain == "z" for policy in first.policies)
    assert all(
        abs(complex(pole["real"], pole["imag"])) < 1.0
        for policy in first.policies
        for pole in policy.closed_loop_poles
    )
    assert len(first.evaluation) == 4
    assert first.safety.certificate_kind == "local_invariant_ellipsoid"
    assert first.safety.certificate_domain == "sampled_data"
    assert first.safety.certified_rho is not None
    assert first.safety.certified_rho > 0.0
    assert first.safety.certified_backup_saturations == 0
    payload = json.loads(first.model_dump_json())
    assert payload["safety"]["certified_rho"] == first.safety.certified_rho

    p = np.asarray(first.safety.lyapunov_matrix)
    basis_gain = np.asarray(next(policy.gain for policy in first.policies if policy.name == "basis"))
    direction = np.linalg.solve(p, basis_gain.T)[:, 0]
    boundary_state = direction * np.sqrt(
        first.safety.certified_rho / float(direction.T @ p @ direction)
    )
    assert abs(float((basis_gain @ boundary_state).item())) <= 0.05 + 1e-10
    for actions in (
        first.trace.basis_action,
        first.trace.teacher_action,
        first.trace.learner_action,
        first.trace.supervised_action,
    ):
        assert max(abs(value) for value in actions) <= 0.05 + 1e-12
    assert len(first.trace.time) == len(first.trace.supervisor_active)
    assert len(first.trace.time) == len(first.trace.certificate_active)
    assert len(first.trace.time) == len(first.trace.lyapunov_value)


def test_supervisor_intervenes_without_saturating_backup_inside_certified_region() -> None:
    candidate = lambda _state: ActionDecision(0.0)
    supervised = _supervised_policy(
        np.asarray([[1.0]]),
        np.asarray([[0.1]]),
        candidate,
        np.asarray([[0.5]]),
        np.asarray([[1.0]]),
        0.05,
        0.1,
        0.5,
        1.0,
    )
    decision = supervised(np.asarray([0.1]))

    assert decision.supervisor_active
    assert decision.certificate_active
    assert not decision.backup_saturated
    assert decision.value == pytest.approx(-0.05)


def test_without_input_limit_reports_global_unsaturated_certificate() -> None:
    request = SafeLearningRequest(
        diagram=Diagram.model_validate(first_order_step_diagram()),
        horizon=0.5,
        dt=0.02,
        training_trajectories=2,
        validation_trajectories=4,
        input_limit=None,
        mpc_horizon_steps=8,
        on_policy_rounds=0,
    )

    result = run_safe_learning(request)

    assert result.safety.certificate_kind == "global_unsaturated"
    assert result.safety.certified_rho is None
    assert result.safety.certified_inner_radius is None
    assert result.safety.heuristic_decisions == 0
    assert result.safety.certified_decision_percent == 100.0
    expected_intervals = int(round(request.horizon / request.dt))
    assert result.safety.decisions == request.validation_trajectories * expected_intervals


def test_safe_learning_rejects_static_model() -> None:
    request = SafeLearningRequest(
        diagram=Diagram.model_validate(gain_only_diagram()),
        training_trajectories=2,
        validation_trajectories=4,
    )

    with pytest.raises(ValueError, match="динамическую модель"):
        run_safe_learning(request)
