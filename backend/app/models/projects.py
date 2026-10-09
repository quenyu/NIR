from __future__ import annotations

import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.diagram import Diagram


class ProjectPosition(BaseModel):
    x: float
    y: float

    @field_validator("x", "y")
    @classmethod
    def finite_coordinate(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Координаты блока должны быть конечными числами.")
        return value


class ProjectViewport(BaseModel):
    x: float
    y: float
    zoom: float

    @model_validator(mode="after")
    def validate_viewport(self) -> ProjectViewport:
        if not all(math.isfinite(value) for value in (self.x, self.y, self.zoom)):
            raise ValueError("Параметры viewport должны быть конечными числами.")
        if self.zoom <= 0.0:
            raise ValueError("Масштаб viewport должен быть больше 0.")
        return self


class ProjectLayout(BaseModel):
    positions: dict[str, ProjectPosition] = Field(default_factory=dict)
    viewport: ProjectViewport | None = None


class ProjectSimulationSettings(BaseModel):
    solver: Literal["rk4", "solve_ivp"] = "solve_ivp"
    t_start: float = 0.0
    t_end: float = 6.0
    dt: float = 0.01

    @model_validator(mode="after")
    def validate_time_settings(self) -> ProjectSimulationSettings:
        if not all(math.isfinite(value) for value in (self.t_start, self.t_end, self.dt)):
            raise ValueError("Параметры времени должны быть конечными числами.")
        if self.t_end <= self.t_start:
            raise ValueError("t_end должен быть больше t_start.")
        if self.dt <= 0.0:
            raise ValueError("dt должен быть больше 0.")
        return self


class ProjectPayload(BaseModel):
    diagram: Diagram
    layout: ProjectLayout = Field(default_factory=ProjectLayout)
    simulation: ProjectSimulationSettings = Field(default_factory=ProjectSimulationSettings)


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    payload: ProjectPayload

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Название проекта не может быть пустым.")
        return normalized


class ProjectUpdateRequest(ProjectCreateRequest):
    expected_version: int = Field(ge=1)


class ProjectSummary(BaseModel):
    id: str
    title: str
    version: int
    block_count: int
    created_at: datetime
    updated_at: datetime


class ProjectRecord(ProjectSummary):
    payload: ProjectPayload


class ProjectListResponse(BaseModel):
    projects: list[ProjectSummary] = Field(default_factory=list)
