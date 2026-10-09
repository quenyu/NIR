from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.models.diagram import Diagram

MAX_SIMULATION_POINTS = 200_000


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
    def validate_time_definition(self) -> SimulationRequest:
        if not math.isfinite(self.t_start) or not math.isfinite(self.t_end):
            raise ValueError("'t_start' и 't_end' должны быть конечными числами.")
        if self.t_end <= self.t_start:
            raise ValueError("'t_end' должен быть больше, чем 't_start'.")
        if self.t_eval is None and self.dt is None:
            raise ValueError("Укажите либо 'dt', либо 't_eval'.")
        if self.dt is not None:
            if not math.isfinite(self.dt):
                raise ValueError("'dt' должен быть конечным числом.")
            if self.dt <= 0.0:
                raise ValueError("'dt' должен быть больше 0.")
        if self.t_eval is not None:
            if len(self.t_eval) < 2:
                raise ValueError("'t_eval' должен содержать минимум две точки времени.")
            if len(self.t_eval) > MAX_SIMULATION_POINTS:
                raise ValueError(
                    f"'t_eval' не должен содержать более {MAX_SIMULATION_POINTS} точек."
                )
            if any(not math.isfinite(value) for value in self.t_eval):
                raise ValueError("Все значения 't_eval' должны быть конечными.")
            if any(t2 <= t1 for t1, t2 in zip(self.t_eval[:-1], self.t_eval[1:], strict=True)):
                raise ValueError("'t_eval' должен быть строго возрастающим.")
            if not math.isclose(self.t_eval[0], self.t_start, rel_tol=1e-12, abs_tol=1e-12):
                raise ValueError("Первый отсчёт 't_eval' должен совпадать с 't_start'.")
            if not math.isclose(self.t_eval[-1], self.t_end, rel_tol=1e-12, abs_tol=1e-12):
                raise ValueError("Последний отсчёт 't_eval' должен совпадать с 't_end'.")
        elif self.dt is not None:
            point_count = math.ceil((self.t_end - self.t_start) / self.dt) + 1
            if point_count > MAX_SIMULATION_POINTS:
                raise ValueError(
                    "Расчётная сетка слишком велика: "
                    f"не более {MAX_SIMULATION_POINTS} временных отсчётов."
                )
        return self


class SimulationResponse(BaseModel):
    success: bool
    time: list[float] = Field(default_factory=list)
    outputs: dict[str, list[float]] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    system_analysis: dict[str, Any] = Field(default_factory=dict)
    frequency_analysis: dict[str, Any] = Field(default_factory=dict)
    quality_metrics: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


MAX_SWEEP_VALUES = 200


class SweepRequest(BaseModel):
    """Poles of the assembled model while one numeric block parameter varies."""

    diagram: Diagram
    block_id: str
    parameter: str
    values: list[float] = Field(min_length=2, max_length=MAX_SWEEP_VALUES)

    @model_validator(mode="after")
    def validate_values(self) -> SweepRequest:
        if any(not math.isfinite(value) for value in self.values):
            raise ValueError("Все значения параметра должны быть конечными.")
        return self


class SweepPoint(BaseModel):
    value: float
    poles: list[dict[str, float]] | None = None
    stability: str | None = None
    error: str | None = None


class SweepResponse(BaseModel):
    block_id: str
    parameter: str
    points: list[SweepPoint]
