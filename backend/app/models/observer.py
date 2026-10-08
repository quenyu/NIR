from __future__ import annotations

import math

from pydantic import BaseModel, Field, model_validator

from app.models.diagram import Diagram


class ObserverExperimentRequest(BaseModel):
    diagram: Diagram
    input_block_id: str | None = None
    output_label: str | None = None
    horizon: float = 6.0
    dt: float = 0.02
    input_amplitude: float = 1.0
    step_time: float = 0.0
    initial_state_scale: float = 1.0
    observer_speed_factor: float = 3.0
    process_noise_std: float = 0.01
    measurement_noise_std: float = 0.05
    seed: int = 42

    @model_validator(mode="after")
    def validate_options(self) -> "ObserverExperimentRequest":
        positive = {
            "horizon": self.horizon,
            "dt": self.dt,
            "observer_speed_factor": self.observer_speed_factor,
        }
        for name, value in positive.items():
            if not math.isfinite(value) or value <= 0.0:
                raise ValueError(f"'{name}' должен быть конечным числом больше 0.")
        finite = {
            "input_amplitude": self.input_amplitude,
            "step_time": self.step_time,
            "initial_state_scale": self.initial_state_scale,
            "process_noise_std": self.process_noise_std,
            "measurement_noise_std": self.measurement_noise_std,
        }
        for name, value in finite.items():
            if not math.isfinite(value):
                raise ValueError(f"'{name}' должен быть конечным числом.")
        if self.initial_state_scale < 0.0:
            raise ValueError("'initial_state_scale' не может быть отрицательным.")
        if self.process_noise_std < 0.0 or self.measurement_noise_std < 0.0:
            raise ValueError("Интенсивности шума не могут быть отрицательными.")
        if self.step_time < 0.0 or self.step_time > self.horizon:
            raise ValueError("'step_time' должен находиться внутри горизонта моделирования.")
        intervals = self.horizon / self.dt
        if intervals > 20_000:
            raise ValueError("В эксперименте не должно быть более 20 000 шагов.")
        if not math.isclose(intervals, round(intervals), rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError("'horizon' должен содержать целое число шагов 'dt'.")
        return self


class ObserverSummary(BaseModel):
    method: str
    name: str
    gain: list[list[float]] = Field(default_factory=list)
    error_dynamics_poles: list[dict[str, float]] = Field(default_factory=list)
    spectral_radius: float
    asymptotically_stable: bool
    design: str
    covariance: list[list[float]] | None = None


class ObserverMetrics(BaseModel):
    method: str
    state_rmse: float
    steady_state_rmse: float
    rmse_by_state: list[float] = Field(default_factory=list)
    mean_error_norm: float
    max_error_norm: float
    final_error_norm: float
    innovation_rms: float
    improvement_over_zero_estimate_percent: float
    three_sigma_coverage_percent: float | None = None


class ObserverTrace(BaseModel):
    time: list[float] = Field(default_factory=list)
    state_labels: list[str] = Field(default_factory=list)
    input: list[float] = Field(default_factory=list)
    true_output: list[float] = Field(default_factory=list)
    measured_output: list[float] = Field(default_factory=list)
    true_states: list[list[float]] = Field(default_factory=list)
    luenberger_states: list[list[float]] = Field(default_factory=list)
    kalman_states: list[list[float]] = Field(default_factory=list)
    luenberger_error_norm: list[float] = Field(default_factory=list)
    kalman_error_norm: list[float] = Field(default_factory=list)
    luenberger_innovation: list[float] = Field(default_factory=list)
    kalman_innovation: list[float] = Field(default_factory=list)
    kalman_three_sigma: list[float] = Field(default_factory=list)


class ObserverExperimentResponse(BaseModel):
    success: bool
    model: dict[str, object] = Field(default_factory=dict)
    settings: dict[str, object] = Field(default_factory=dict)
    observers: list[ObserverSummary] = Field(default_factory=list)
    metrics: list[ObserverMetrics] = Field(default_factory=list)
    trace: ObserverTrace = Field(default_factory=ObserverTrace)
    warnings: list[str] = Field(default_factory=list)
