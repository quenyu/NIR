from app.experiments.metrics import ErrorMetrics, TimingSummary, compute_error_metrics, summarize_timings
from app.experiments.reference_models import (
    first_order_step_response,
    integrator_step_response,
    underdamped_second_order_step_response,
)
from app.experiments.scenarios import BENCHMARK_SCENARIO_SLUG, DEFAULT_DT_SWEEP, ScenarioSpec, build_scenarios
from app.experiments.service import (
    AVAILABLE_SOLVERS,
    DEFAULT_BENCHMARK_REPETITIONS,
    DEFAULT_BENCHMARK_WARMUP,
    get_experiments_catalog,
    run_experiment,
)

__all__ = [
    "AVAILABLE_SOLVERS",
    "BENCHMARK_SCENARIO_SLUG",
    "DEFAULT_BENCHMARK_REPETITIONS",
    "DEFAULT_BENCHMARK_WARMUP",
    "DEFAULT_DT_SWEEP",
    "ErrorMetrics",
    "ScenarioSpec",
    "TimingSummary",
    "build_scenarios",
    "compute_error_metrics",
    "first_order_step_response",
    "get_experiments_catalog",
    "integrator_step_response",
    "run_experiment",
    "summarize_timings",
    "underdamped_second_order_step_response",
]
