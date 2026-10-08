from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, Field, model_validator


SolverName = Literal["rk4", "solve_ivp"]


class ExperimentCatalogScenario(BaseModel):
    slug: str
    title: str
    description: str
    default_dt: float
    default_t_end: float
    default_dt_values: list[float] = Field(default_factory=list)
    default_benchmark_repetitions: int
    default_benchmark_warmup: int
    parameter_block_id: str
    parameter_name: str
    parameter_nominal: float
    default_parameter_values: list[float] = Field(default_factory=list)


class ExperimentCatalogResponse(BaseModel):
    scenarios: list[ExperimentCatalogScenario] = Field(default_factory=list)
    solvers: list[SolverName] = Field(default_factory=list)


class ExperimentRunRequest(BaseModel):
    scenario: str
    solvers: list[SolverName] = Field(default_factory=lambda: ["rk4", "solve_ivp"])
    dt: float | None = None
    t_end: float | None = None
    include_analytic: bool = True
    run_accuracy: bool = True
    run_solver_comparison: bool = True
    run_dt_sweep: bool = False
    dt_values: list[float] = Field(default_factory=list)
    run_benchmark: bool = False
    benchmark_repetitions: int = 100
    benchmark_warmup: int = 10
    run_parameter_sweep: bool = False
    parameter_block_id: str | None = None
    parameter_name: str | None = None
    parameter_values: list[float] = Field(default_factory=list)
    run_monte_carlo: bool = False
    monte_carlo_samples: int = 30
    uncertainty_percent: float = 20.0
    random_seed: int = 42

    @model_validator(mode="after")
    def validate_request(self) -> "ExperimentRunRequest":
        self.solvers = list(dict.fromkeys(self.solvers))
        if not self.solvers:
            raise ValueError("Нужно выбрать хотя бы один solver.")
        if self.dt is not None and (not math.isfinite(self.dt) or self.dt <= 0.0):
            raise ValueError("'dt' должен быть конечным числом больше 0.")
        if self.t_end is not None and (
            not math.isfinite(self.t_end) or self.t_end <= 0.0
        ):
            raise ValueError("'t_end' должен быть конечным числом больше 0.")
        if self.benchmark_repetitions <= 0 or self.benchmark_repetitions > 500:
            raise ValueError("'benchmark_repetitions' должен быть от 1 до 500.")
        if self.benchmark_warmup < 0 or self.benchmark_warmup > 100:
            raise ValueError("'benchmark_warmup' должен быть от 0 до 100.")
        if len(self.dt_values) > 50:
            raise ValueError("'dt_values' не должен содержать более 50 значений.")
        if any(not math.isfinite(value) or value <= 0.0 for value in self.dt_values):
            raise ValueError("Все значения 'dt_values' должны быть конечными и больше 0.")
        if len(self.parameter_values) > 200:
            raise ValueError("'parameter_values' не должен содержать более 200 значений.")
        if any(not math.isfinite(value) for value in self.parameter_values):
            raise ValueError("Все значения 'parameter_values' должны быть конечными.")
        if self.monte_carlo_samples <= 0 or self.monte_carlo_samples > 500:
            raise ValueError("'monte_carlo_samples' должен быть от 1 до 500.")
        if (
            not math.isfinite(self.uncertainty_percent)
            or self.uncertainty_percent <= 0.0
            or self.uncertainty_percent > 200.0
        ):
            raise ValueError("'uncertainty_percent' должен быть в диапазоне (0, 200].")
        return self


class ExperimentScenarioMetadata(BaseModel):
    slug: str
    title: str
    description: str
    requested_dt: float
    requested_t_end: float
    selected_solvers: list[SolverName] = Field(default_factory=list)


class ExperimentEnvironmentSummary(BaseModel):
    generated_at_utc: str
    python_version: str
    platform: str


class ExperimentTimeseries(BaseModel):
    time: list[float] = Field(default_factory=list)
    analytic: list[float] | None = None
    rk4: list[float] | None = None
    solve_ivp: list[float] | None = None


class ExperimentAccuracyRow(BaseModel):
    solver: SolverName
    dt: float
    max_abs_error: float
    rmse: float
    final_value_error: float


class ExperimentSolverComparisonRow(BaseModel):
    max_abs_diff: float
    rmse_diff: float
    final_value_diff: float


class ExperimentDtSweepRow(BaseModel):
    solver: SolverName
    dt: float
    max_abs_error: float
    rmse: float
    final_value_error: float


class ExperimentBenchmarkSummaryRow(BaseModel):
    solver: SolverName
    mean_ms: float
    median_ms: float
    std_ms: float
    min_ms: float
    max_ms: float
    repetitions: int


class ExperimentBenchmarkSampleRow(BaseModel):
    solver: SolverName
    iteration: int
    duration_ms: float


class ExperimentParameterSweepRow(BaseModel):
    parameter_value: float
    stability: str
    spectral_abscissa: float | None = None
    final_value: float | None = None
    overshoot_percent: float | None = None
    settling_time: float | None = None
    integral_absolute_error: float | None = None


class ExperimentMonteCarloSampleRow(ExperimentParameterSweepRow):
    sample: int


class ExperimentRobustSummary(BaseModel):
    parameter_block_id: str
    parameter_name: str
    nominal_value: float
    solver: SolverName
    sample_count: int
    stable_samples: int
    robust_stability_percent: float
    worst_spectral_abscissa: float | None = None
    final_value_min: float | None = None
    final_value_max: float | None = None


class ExperimentRunResponse(BaseModel):
    scenario: ExperimentScenarioMetadata
    environment: ExperimentEnvironmentSummary
    timeseries: ExperimentTimeseries
    accuracy_rows: list[ExperimentAccuracyRow] = Field(default_factory=list)
    solver_comparison_rows: list[ExperimentSolverComparisonRow] = Field(default_factory=list)
    dt_sweep_rows: list[ExperimentDtSweepRow] = Field(default_factory=list)
    benchmark_summary_rows: list[ExperimentBenchmarkSummaryRow] = Field(default_factory=list)
    benchmark_samples: list[ExperimentBenchmarkSampleRow] = Field(default_factory=list)
    parameter_sweep_rows: list[ExperimentParameterSweepRow] = Field(default_factory=list)
    monte_carlo_rows: list[ExperimentMonteCarloSampleRow] = Field(default_factory=list)
    robust_summary: ExperimentRobustSummary | None = None
    warnings: list[str] = Field(default_factory=list)
    interpretation_notes: list[str] = Field(default_factory=list)
