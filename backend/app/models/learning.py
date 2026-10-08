from __future__ import annotations

import math

from pydantic import BaseModel, Field, model_validator

from app.models.diagram import Diagram


class SafeLearningRequest(BaseModel):
    diagram: Diagram
    input_block_id: str | None = None
    output_label: str | None = None
    horizon: float = 6.0
    dt: float = 0.02
    training_trajectories: int = Field(default=12, ge=2, le=80)
    validation_trajectories: int = Field(default=32, ge=4, le=200)
    initial_state_scale: float = 1.0
    state_noise_std: float = 0.04
    ridge: float = 1e-3
    control_weight: float = 0.2
    basis_control_ratio: float = 8.0
    safety_decay: float = 0.05
    input_limit: float | None = 0.5
    mpc_horizon_steps: int = Field(default=20, ge=2, le=80)
    mpc_iterations: int = Field(default=60, ge=5, le=300)
    mpc_tolerance: float = 1e-6
    on_policy_rounds: int = Field(default=2, ge=0, le=5)
    on_policy_trajectories: int = Field(default=4, ge=1, le=20)
    seed: int = 42

    @model_validator(mode="after")
    def validate_options(self) -> "SafeLearningRequest":
        positive_values = {
            "horizon": self.horizon,
            "dt": self.dt,
            "initial_state_scale": self.initial_state_scale,
            "control_weight": self.control_weight,
            "basis_control_ratio": self.basis_control_ratio,
        }
        for name, value in positive_values.items():
            if not math.isfinite(value) or value <= 0.0:
                raise ValueError(f"'{name}' должен быть конечным числом больше 0.")
        horizon_steps = self.horizon / self.dt
        if horizon_steps > 10_000:
            raise ValueError("В одном прогоне не должно быть более 10 000 шагов.")
        if not math.isclose(horizon_steps, round(horizon_steps), rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError("'horizon' должен содержать целое число шагов 'dt'.")
        if not math.isfinite(self.state_noise_std) or self.state_noise_std < 0.0:
            raise ValueError("'state_noise_std' должен быть конечным неотрицательным числом.")
        if not math.isfinite(self.ridge) or self.ridge < 0.0:
            raise ValueError("'ridge' должен быть конечным неотрицательным числом.")
        if not math.isfinite(self.safety_decay) or not 0.0 < self.safety_decay <= 1.0:
            raise ValueError("'safety_decay' должен находиться в диапазоне (0, 1].")
        if self.input_limit is not None and (
            not math.isfinite(self.input_limit) or self.input_limit <= 0.0
        ):
            raise ValueError("'input_limit' должен быть конечным числом больше 0.")
        if not math.isfinite(self.mpc_tolerance) or self.mpc_tolerance <= 0.0:
            raise ValueError("'mpc_tolerance' должен быть конечным числом больше 0.")
        rollout_steps = int(round(horizon_steps)) + 1
        rollout_count = (
            self.training_trajectories
            + self.on_policy_rounds * self.on_policy_trajectories
            + self.validation_trajectories
        )
        if rollout_steps * rollout_count > 150_000:
            raise ValueError(
                "Расчёт слишком велик для интерактивного режима: уменьшите горизонт, "
                "число траекторий или увеличьте dt."
            )
        return self


class LearnedPolicySummary(BaseModel):
    name: str
    role: str
    policy_kind: str = "linear_state_feedback"
    feature_count: int = 0
    gain: list[list[float]] = Field(default_factory=list)
    closed_loop_poles: list[dict[str, float]] = Field(default_factory=list)
    pole_domain: str = "z"
    asymptotically_stable: bool


class LearningDatasetSummary(BaseModel):
    training_trajectories: int
    initial_teacher_samples: int
    on_policy_rounds: int
    on_policy_trajectories_per_round: int
    on_policy_round_samples: list[int] = Field(default_factory=list)
    on_policy_samples: int
    training_samples: int
    validation_trajectories: int
    state_noise_std: float
    ridge: float
    feature_count: int
    train_imitation_rmse: float
    test_imitation_rmse: float
    on_policy_rmse_before: float | None = None
    on_policy_rmse_after: float | None = None


class MpcTeacherSummary(BaseModel):
    kind: str
    solver: str
    horizon_steps: int
    sample_time: float
    prediction_horizon: float
    decision_variables: int
    input_constraint: str
    state_constraints: str
    terminal_cost: str
    iterations_limit: int
    tolerance: float
    solver_queries: int
    mean_iterations: float
    max_iterations_used: int
    max_projected_residual: float
    unconverged_queries: int
    converged_percent: float
    active_constraint_percent: float


class LearningEvaluationRow(BaseModel):
    policy: str
    mean_cost: float
    median_cost: float
    stabilization_percent: float
    worst_state_norm: float
    saturation_percent: float


class SafeLearningTrace(BaseModel):
    time: list[float] = Field(default_factory=list)
    basis_output: list[float] = Field(default_factory=list)
    teacher_output: list[float] = Field(default_factory=list)
    learner_output: list[float] = Field(default_factory=list)
    supervised_output: list[float] = Field(default_factory=list)
    basis_action: list[float] = Field(default_factory=list)
    teacher_action: list[float] = Field(default_factory=list)
    learner_action: list[float] = Field(default_factory=list)
    supervised_action: list[float] = Field(default_factory=list)
    basis_state_norm: list[float] = Field(default_factory=list)
    teacher_state_norm: list[float] = Field(default_factory=list)
    learner_state_norm: list[float] = Field(default_factory=list)
    supervised_state_norm: list[float] = Field(default_factory=list)
    lyapunov_value: list[float] = Field(default_factory=list)
    supervisor_active: list[int] = Field(default_factory=list)
    certificate_active: list[int] = Field(default_factory=list)


class SafeLearningSafety(BaseModel):
    certificate_kind: str
    certificate_domain: str = "sampled_data"
    sample_time: float
    lyapunov_function: str
    lyapunov_matrix: list[list[float]] = Field(default_factory=list)
    admission_condition: str
    requested_decay: float
    backup_decay: float
    input_limit: float | None = None
    certified_rho: float | None = None
    certified_inner_radius: float | None = None
    validation_initial_states_inside_percent: float
    certified_decisions: int
    heuristic_decisions: int
    certified_decision_percent: float
    interventions: int
    decisions: int
    intervention_percent: float
    candidate_acceptance_percent: float
    candidate_saturations: int
    backup_saturations: int
    certified_backup_saturations: int


class SafeLearningResponse(BaseModel):
    success: bool
    model: dict[str, object] = Field(default_factory=dict)
    dataset: LearningDatasetSummary
    teacher: MpcTeacherSummary
    policies: list[LearnedPolicySummary] = Field(default_factory=list)
    evaluation: list[LearningEvaluationRow] = Field(default_factory=list)
    safety: SafeLearningSafety
    trace: SafeLearningTrace = Field(default_factory=SafeLearningTrace)
    warnings: list[str] = Field(default_factory=list)
