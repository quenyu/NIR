from __future__ import annotations

import math

from pydantic import BaseModel, Field, model_validator

from app.models.diagram import Diagram


class OutputFeedbackRequest(BaseModel):
    diagram: Diagram
    input_block_id: str | None = None
    output_label: str | None = None
    horizon: float = 6.0
    dt: float = 0.02
    initial_state_scale: float = 1.0
    observer_speed_factor: float = 3.0
    process_noise_std: float = 0.01
    measurement_noise_std: float = 0.05
    state_weight: float = 1.0
    control_weight: float = 0.1
    control_limit: float = 5.0
    reference: float = 0.0
    seed: int = 42

    @model_validator(mode="after")
    def validate_options(self) -> "OutputFeedbackRequest":
        positive = {
            "horizon": self.horizon,
            "dt": self.dt,
            "observer_speed_factor": self.observer_speed_factor,
            "state_weight": self.state_weight,
            "control_weight": self.control_weight,
            "control_limit": self.control_limit,
        }
        for name, value in positive.items():
            if not math.isfinite(value) or value <= 0.0:
                raise ValueError(f"'{name}' должен быть конечным числом больше 0.")
        finite_nonnegative = {
            "initial_state_scale": self.initial_state_scale,
            "process_noise_std": self.process_noise_std,
            "measurement_noise_std": self.measurement_noise_std,
        }
        for name, value in finite_nonnegative.items():
            if not math.isfinite(value) or value < 0.0:
                raise ValueError(f"'{name}' должен быть конечным неотрицательным числом.")
        if not math.isfinite(self.reference):
            raise ValueError("'reference' должен быть конечным числом.")
        intervals = self.horizon / self.dt
        if intervals > 20_000:
            raise ValueError("В эксперименте не должно быть более 20 000 шагов.")
        if not math.isclose(intervals, round(intervals), rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError("'horizon' должен содержать целое число шагов 'dt'.")
        return self


class OutputFeedbackDesign(BaseModel):
    method: str
    name: str
    feedback_gain: list[list[float]] = Field(default_factory=list)
    controller_poles: list[dict[str, float]] = Field(default_factory=list)
    observer_poles: list[dict[str, float]] = Field(default_factory=list)
    augmented_poles: list[dict[str, float]] = Field(default_factory=list)
    spectral_radius: float
    asymptotically_stable: bool
    separation_matches: bool | None = None
    interpretation: str


class OutputFeedbackMetrics(BaseModel):
    method: str
    state_rms: float
    final_state_norm: float
    peak_state_norm: float
    output_rms: float
    control_rms: float
    peak_control: float
    saturation_percent: float
    quadratic_cost_per_step: float
    tracking_rmse: float
    final_output: float
    steady_state_error: float
    estimation_rmse: float | None = None
    final_estimation_error_norm: float | None = None


class OutputFeedbackTrace(BaseModel):
    time: list[float] = Field(default_factory=list)
    state_labels: list[str] = Field(default_factory=list)
    full_state_states: list[list[float]] = Field(default_factory=list)
    luenberger_states: list[list[float]] = Field(default_factory=list)
    kalman_states: list[list[float]] = Field(default_factory=list)
    luenberger_estimates: list[list[float]] = Field(default_factory=list)
    kalman_estimates: list[list[float]] = Field(default_factory=list)
    full_state_norm: list[float] = Field(default_factory=list)
    luenberger_state_norm: list[float] = Field(default_factory=list)
    kalman_state_norm: list[float] = Field(default_factory=list)
    luenberger_estimation_error_norm: list[float] = Field(default_factory=list)
    kalman_estimation_error_norm: list[float] = Field(default_factory=list)
    full_state_output: list[float] = Field(default_factory=list)
    luenberger_output: list[float] = Field(default_factory=list)
    kalman_output: list[float] = Field(default_factory=list)
    full_state_control: list[float] = Field(default_factory=list)
    luenberger_control: list[float] = Field(default_factory=list)
    kalman_control: list[float] = Field(default_factory=list)


class OutputFeedbackResponse(BaseModel):
    success: bool
    model: dict[str, object] = Field(default_factory=dict)
    settings: dict[str, object] = Field(default_factory=dict)
    designs: list[OutputFeedbackDesign] = Field(default_factory=list)
    metrics: list[OutputFeedbackMetrics] = Field(default_factory=list)
    trace: OutputFeedbackTrace = Field(default_factory=OutputFeedbackTrace)
    warnings: list[str] = Field(default_factory=list)
