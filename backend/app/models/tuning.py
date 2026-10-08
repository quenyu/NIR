from __future__ import annotations

import math

from pydantic import BaseModel, Field, model_validator

from app.models.diagram import Diagram


class PIDTuneRequest(BaseModel):
    diagram: Diagram
    controller_block_id: str
    scope_label: str | None = None
    reference_input_block_id: str | None = None
    t_end: float = 8.0
    dt: float = 0.02
    kp_bounds: tuple[float, float] = (0.0, 20.0)
    ki_bounds: tuple[float, float] = (0.0, 10.0)
    kd_bounds: tuple[float, float] = (0.0, 5.0)
    max_iterations: int = Field(default=8, ge=1, le=40)
    seed: int = 42

    @model_validator(mode="after")
    def validate_tuning_options(self) -> "PIDTuneRequest":
        if not math.isfinite(self.t_end) or self.t_end <= 0.0:
            raise ValueError("'t_end' должен быть конечным числом больше 0.")
        if not math.isfinite(self.dt) or self.dt <= 0.0:
            raise ValueError("'dt' должен быть конечным числом больше 0.")
        for name, bounds in (
            ("kp_bounds", self.kp_bounds),
            ("ki_bounds", self.ki_bounds),
            ("kd_bounds", self.kd_bounds),
        ):
            if (
                not all(math.isfinite(value) for value in bounds)
                or bounds[0] < 0.0
                or bounds[1] <= bounds[0]
            ):
                raise ValueError(f"Некорректные границы '{name}'.")
        return self


class PIDTuneResponse(BaseModel):
    success: bool
    controller_block_id: str
    initial_parameters: dict[str, float] = Field(default_factory=dict)
    tuned_parameters: dict[str, float] = Field(default_factory=dict)
    initial_score: float | None = None
    tuned_score: float | None = None
    improvement_percent: float | None = None
    metrics: dict[str, float | None] = Field(default_factory=dict)
    evaluations: int = 0
    algorithm: str = "differential_evolution"
    warnings: list[str] = Field(default_factory=list)
