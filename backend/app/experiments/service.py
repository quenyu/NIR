from __future__ import annotations

import platform
import time
from datetime import datetime, timezone

import numpy as np

from app.experiments.metrics import compute_error_metrics, summarize_timings
from app.experiments.scenarios import DEFAULT_DT_SWEEP, ScenarioSpec, build_scenarios
from app.models.api import SimulationRequest
from app.models.experiments import (
    ExperimentAccuracyRow,
    ExperimentBenchmarkSampleRow,
    ExperimentBenchmarkSummaryRow,
    ExperimentCatalogResponse,
    ExperimentCatalogScenario,
    ExperimentDtSweepRow,
    ExperimentEnvironmentSummary,
    ExperimentRunRequest,
    ExperimentRunResponse,
    ExperimentScenarioMetadata,
    ExperimentSolverComparisonRow,
    ExperimentTimeseries,
    ExperimentMonteCarloSampleRow,
    ExperimentParameterSweepRow,
    ExperimentRobustSummary,
)
from app.simulation.service import simulate_request

AVAILABLE_SOLVERS: tuple[str, ...] = ("rk4", "solve_ivp")
DEFAULT_BENCHMARK_REPETITIONS = 10
DEFAULT_BENCHMARK_WARMUP = 2


def _scenario_lookup() -> dict[str, ScenarioSpec]:
    return {scenario.slug: scenario for scenario in build_scenarios()}


def _simulate_series(
    scenario: ScenarioSpec,
    solver: str,
    *,
    diagram=None,
    dt: float,
    t_end: float,
) -> tuple[np.ndarray, np.ndarray]:
    loaded_diagram = diagram if diagram is not None else scenario.load_diagram()
    result = simulate_request(
        SimulationRequest(
            diagram=loaded_diagram,
            t_start=0.0,
            t_end=t_end,
            dt=dt,
            solver=solver,
        )
    )
    return (
        np.asarray(result.time, dtype=float),
        np.asarray(result.outputs[scenario.scope_label], dtype=float),
    )


def _build_interpretation_notes(request: ExperimentRunRequest) -> list[str]:
    notes = [
        "Эксперименты охватывают только четыре эталонные схемы из ограниченной библиотеки блоков.",
    ]
    if "solve_ivp" in request.solvers:
        notes.append(
            "Для solve_ivp параметр dt в текущем API задаёт главным образом сетку вывода, а не внутренний адаптивный шаг интегратора."
        )
    if request.run_benchmark:
        notes.append(
            "Benchmark относится к текущей машине и текущему окружению, поэтому абсолютные времена нужно трактовать локально."
        )
        notes.append(
            "Benchmark отражает полный backend pipeline: компиляцию диаграммы, solver и вычисление выходов Scope, а не только solver kernel."
        )
    return notes


def get_experiments_catalog() -> ExperimentCatalogResponse:
    scenarios = [
        ExperimentCatalogScenario(
            slug=scenario.slug,
            title=scenario.title,
            description=scenario.description,
            default_dt=scenario.default_dt,
            default_t_end=scenario.t_end,
            default_dt_values=list(DEFAULT_DT_SWEEP),
            default_benchmark_repetitions=DEFAULT_BENCHMARK_REPETITIONS,
            default_benchmark_warmup=DEFAULT_BENCHMARK_WARMUP,
            parameter_block_id=scenario.parameter_block_id,
            parameter_name=scenario.parameter_name,
            parameter_nominal=scenario.parameter_nominal,
            default_parameter_values=[
                round(float(value), 6)
                for value in np.linspace(
                    scenario.parameter_nominal * 0.6,
                    scenario.parameter_nominal * 1.4,
                    9,
                )
            ],
        )
        for scenario in build_scenarios()
    ]
    return ExperimentCatalogResponse(
        scenarios=scenarios,
        solvers=list(AVAILABLE_SOLVERS),
    )


def _set_parameter(diagram, block_id: str, parameter_name: str, value: float) -> None:
    for block in diagram.blocks:
        if block.id == block_id:
            block.parameters[parameter_name] = float(value)
            return
    raise ValueError(f"Блок параметрического эксперимента '{block_id}' не найден.")


def _variant_row(
    scenario: ScenarioSpec,
    diagram,
    solver: str,
    *,
    dt: float,
    t_end: float,
    parameter_value: float,
) -> ExperimentParameterSweepRow:
    try:
        result = simulate_request(
            SimulationRequest(diagram=diagram, t_start=0.0, t_end=t_end, dt=dt, solver=solver)
        )
    except (ValueError, RuntimeError, FloatingPointError):
        return ExperimentParameterSweepRow(parameter_value=parameter_value, stability="failed")

    system = result.system_analysis
    metrics = result.quality_metrics.get(scenario.scope_label, {})
    return ExperimentParameterSweepRow(
        parameter_value=parameter_value,
        stability=str(system.get("stability", "not_applicable")),
        spectral_abscissa=system.get("spectral_abscissa"),
        final_value=metrics.get("final_value"),
        overshoot_percent=metrics.get("overshoot_percent"),
        settling_time=metrics.get("settling_time"),
        integral_absolute_error=metrics.get("integral_absolute_error"),
    )


def run_experiment(request: ExperimentRunRequest) -> ExperimentRunResponse:
    scenarios = _scenario_lookup()
    if request.scenario not in scenarios:
        raise ValueError(f"Неизвестный сценарий '{request.scenario}'.")

    scenario = scenarios[request.scenario]
    dt = request.dt if request.dt is not None else scenario.default_dt
    t_end = request.t_end if request.t_end is not None else scenario.t_end
    loaded_diagram = scenario.load_diagram()
    generated_at_utc = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    warnings: list[str] = []
    time_values: np.ndarray | None = None
    reference_values: np.ndarray | None = None
    solver_series: dict[str, np.ndarray] = {}

    for solver in request.solvers:
        simulated_time, outputs = _simulate_series(
            scenario,
            solver,
            diagram=loaded_diagram,
            dt=dt,
            t_end=t_end,
        )
        solver_series[solver] = outputs
        if time_values is None:
            time_values = simulated_time
            reference_values = scenario.reference(simulated_time)

    assert time_values is not None and reference_values is not None

    accuracy_rows: list[ExperimentAccuracyRow] = []
    if request.run_accuracy:
        accuracy_rows = [
            ExperimentAccuracyRow(
                solver=solver,
                dt=dt,
                **compute_error_metrics(outputs, reference_values).as_dict(),
            )
            for solver, outputs in solver_series.items()
        ]

    solver_comparison_rows: list[ExperimentSolverComparisonRow] = []
    if request.run_solver_comparison:
        if {"rk4", "solve_ivp"}.issubset(set(request.solvers)):
            diff_metrics = compute_error_metrics(solver_series["rk4"], solver_series["solve_ivp"])
            solver_comparison_rows.append(
                ExperimentSolverComparisonRow(
                    max_abs_diff=diff_metrics.max_abs_error,
                    rmse_diff=diff_metrics.rmse,
                    final_value_diff=diff_metrics.final_value_error,
                )
            )
        else:
            warnings.append(
                "Сравнение solver-ов доступно только если выбраны и rk4, и solve_ivp; блок comparison пропущен."
            )

    dt_sweep_rows: list[ExperimentDtSweepRow] = []
    if request.run_dt_sweep:
        dt_values = sorted(set(request.dt_values)) if request.dt_values else list(DEFAULT_DT_SWEEP)
        if not dt_values:
            warnings.append("Для dt sweep не переданы значения dt; использованы значения по умолчанию.")
            dt_values = list(DEFAULT_DT_SWEEP)

        for sweep_dt in dt_values:
            for solver in request.solvers:
                simulated_time, outputs = _simulate_series(
                    scenario,
                    solver,
                    diagram=loaded_diagram,
                    dt=sweep_dt,
                    t_end=t_end,
                )
                metrics = compute_error_metrics(outputs, scenario.reference(simulated_time))
                dt_sweep_rows.append(
                    ExperimentDtSweepRow(
                        solver=solver,
                        dt=sweep_dt,
                        max_abs_error=metrics.max_abs_error,
                        rmse=metrics.rmse,
                        final_value_error=metrics.final_value_error,
                    )
                )

    benchmark_summary_rows: list[ExperimentBenchmarkSummaryRow] = []
    benchmark_samples: list[ExperimentBenchmarkSampleRow] = []
    if request.run_benchmark:
        for solver in request.solvers:
            for _ in range(request.benchmark_warmup):
                _simulate_series(
                    scenario,
                    solver,
                    diagram=loaded_diagram,
                    dt=dt,
                    t_end=t_end,
                )

            samples_ms: list[float] = []
            for iteration in range(1, request.benchmark_repetitions + 1):
                started = time.perf_counter()
                _simulate_series(
                    scenario,
                    solver,
                    diagram=loaded_diagram,
                    dt=dt,
                    t_end=t_end,
                )
                duration_ms = (time.perf_counter() - started) * 1000.0
                samples_ms.append(duration_ms)
                benchmark_samples.append(
                    ExperimentBenchmarkSampleRow(
                        solver=solver,
                        iteration=iteration,
                        duration_ms=duration_ms,
                    )
                )

            summary = summarize_timings(samples_ms)
            benchmark_summary_rows.append(
                ExperimentBenchmarkSummaryRow(
                    solver=solver,
                    mean_ms=summary.mean_ms,
                    median_ms=summary.median_ms,
                    std_ms=summary.std_ms,
                    min_ms=summary.min_ms,
                    max_ms=summary.max_ms,
                    repetitions=request.benchmark_repetitions,
                )
            )

    parameter_block_id = request.parameter_block_id or scenario.parameter_block_id
    parameter_name = request.parameter_name or scenario.parameter_name
    nominal_value = scenario.parameter_nominal
    robust_solver = request.solvers[0]
    parameter_sweep_rows: list[ExperimentParameterSweepRow] = []
    if request.run_parameter_sweep:
        parameter_values = request.parameter_values or [
            float(value)
            for value in np.linspace(nominal_value * 0.6, nominal_value * 1.4, 9)
        ]
        for parameter_value in sorted(set(parameter_values)):
            candidate = loaded_diagram.model_copy(deep=True)
            _set_parameter(candidate, parameter_block_id, parameter_name, parameter_value)
            parameter_sweep_rows.append(
                _variant_row(
                    scenario,
                    candidate,
                    robust_solver,
                    dt=dt,
                    t_end=t_end,
                    parameter_value=parameter_value,
                )
            )

    monte_carlo_rows: list[ExperimentMonteCarloSampleRow] = []
    robust_summary: ExperimentRobustSummary | None = None
    if request.run_monte_carlo:
        rng = np.random.default_rng(request.random_seed)
        relative = request.uncertainty_percent / 100.0
        lower = nominal_value * (1.0 - relative)
        upper = nominal_value * (1.0 + relative)
        if nominal_value > 0.0:
            lower = max(lower, nominal_value * 1e-6)
        for sample in range(1, request.monte_carlo_samples + 1):
            parameter_value = float(rng.uniform(lower, upper))
            candidate = loaded_diagram.model_copy(deep=True)
            _set_parameter(candidate, parameter_block_id, parameter_name, parameter_value)
            row = _variant_row(
                scenario,
                candidate,
                robust_solver,
                dt=dt,
                t_end=t_end,
                parameter_value=parameter_value,
            )
            monte_carlo_rows.append(
                ExperimentMonteCarloSampleRow(sample=sample, **row.model_dump())
            )

        stable_rows = [row for row in monte_carlo_rows if row.stability == "stable"]
        spectral_values = [
            row.spectral_abscissa
            for row in monte_carlo_rows
            if row.spectral_abscissa is not None
        ]
        final_values = [
            row.final_value for row in monte_carlo_rows if row.final_value is not None
        ]
        robust_summary = ExperimentRobustSummary(
            parameter_block_id=parameter_block_id,
            parameter_name=parameter_name,
            nominal_value=nominal_value,
            solver=robust_solver,
            sample_count=len(monte_carlo_rows),
            stable_samples=len(stable_rows),
            robust_stability_percent=(len(stable_rows) / len(monte_carlo_rows) * 100.0),
            worst_spectral_abscissa=max(spectral_values) if spectral_values else None,
            final_value_min=min(final_values) if final_values else None,
            final_value_max=max(final_values) if final_values else None,
        )

    return ExperimentRunResponse(
        scenario=ExperimentScenarioMetadata(
            slug=scenario.slug,
            title=scenario.title,
            description=scenario.description,
            requested_dt=dt,
            requested_t_end=t_end,
            selected_solvers=request.solvers,
        ),
        environment=ExperimentEnvironmentSummary(
            generated_at_utc=generated_at_utc,
            python_version=platform.python_version(),
            platform=platform.platform(),
        ),
        timeseries=ExperimentTimeseries(
            time=[float(value) for value in time_values],
            analytic=[float(value) for value in reference_values] if request.include_analytic else None,
            rk4=[float(value) for value in solver_series["rk4"]] if "rk4" in solver_series else None,
            solve_ivp=[float(value) for value in solver_series["solve_ivp"]]
            if "solve_ivp" in solver_series
            else None,
        ),
        accuracy_rows=accuracy_rows,
        solver_comparison_rows=solver_comparison_rows,
        dt_sweep_rows=dt_sweep_rows,
        benchmark_summary_rows=benchmark_summary_rows,
        benchmark_samples=benchmark_samples,
        parameter_sweep_rows=parameter_sweep_rows,
        monte_carlo_rows=monte_carlo_rows,
        robust_summary=robust_summary,
        warnings=warnings,
        interpretation_notes=_build_interpretation_notes(request),
    )
