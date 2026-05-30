from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.models.diagram import Diagram


class ValidateRequest(BaseModel):
    diagram: Diagram


class ValidateResponse(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


class SimulationRequest(BaseModel):
    diagram: Diagram
    t_start: float = 0.0
    t_end: float = 10.0
    dt: float | None = 0.01
    t_eval: list[float] | None = None
    solver: Literal["rk4", "solve_ivp"] = "solve_ivp"

    @model_validator(mode="after")
    def validate_time_definition(self) -> "SimulationRequest":
        if self.t_end <= self.t_start:
            raise ValueError("'t_end' должен быть больше, чем 't_start'.")
        if self.t_eval is None and self.dt is None:
            raise ValueError("Укажите либо 'dt', либо 't_eval'.")
        if self.dt is not None and self.dt <= 0.0:
            raise ValueError("'dt' должен быть больше 0.")
        if self.t_eval is not None:
            if len(self.t_eval) < 2:
                raise ValueError("'t_eval' должен содержать минимум две точки времени.")
            if any(t2 <= t1 for t1, t2 in zip(self.t_eval[:-1], self.t_eval[1:])):
                raise ValueError("'t_eval' должен быть строго возрастающим.")
        return self


class SimulationResponse(BaseModel):
    success: bool
    time: list[float] = Field(default_factory=list)
    outputs: dict[str, list[float]] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    stability_analysis: dict[str, Any] = Field(default_factory=dict)
    quality_metrics: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    validation_errors: list[str] = Field(default_factory=list)
