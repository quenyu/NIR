from __future__ import annotations

import argparse
import csv
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import matplotlib
import numpy as np

matplotlib.use("Agg")
from matplotlib import pyplot as plt

from app.experiments.metrics import compute_error_metrics, summarize_timings
from app.experiments.scenarios import BENCHMARK_SCENARIO_SLUG, DEFAULT_DT_SWEEP, build_scenarios
from app.models.api import SimulationRequest
from app.simulation.service import simulate_request

SOLVERS = ("rk4", "solve_ivp")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run reproducible numerical experiments for the NIR report."
    )
    parser.add_argument(
        "--dt-values",
        nargs="*",
        type=float,
        default=list(DEFAULT_DT_SWEEP),
        help="Time steps used in the error-vs-dt sweep.",
    )
    parser.add_argument(
        "--benchmark-repetitions",
        type=int,
        default=100,
        help="Number of timed repetitions per solver.",
    )
    parser.add_argument(
        "--benchmark-warmup",
        type=int,
        default=10,
        help="Number of warm-up runs per solver before timing.",
    )
    return parser.parse_args()


def ensure_output_dirs() -> tuple[Path, Path]:
    docs_dir = REPO_ROOT / "docs"
    data_dir = docs_dir / "data"
    figures_dir = docs_dir / "figures"
    data_dir.mkdir(parents=True, exist_ok=True)
    figures_dir.mkdir(parents=True, exist_ok=True)
    return data_dir, figures_dir


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def write_csv(path: Path, fieldnames: list[str], rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def simulate_series(
    scenario: Any,
    diagram: Any,
    solver: str,
    dt: float,
) -> tuple[np.ndarray, np.ndarray]:
    result = simulate_request(
        SimulationRequest(
            diagram=diagram,
            t_start=0.0,
            t_end=scenario.t_end,
            dt=dt,
            solver=solver,
        )
    )
    time_values = np.asarray(result.time, dtype=float)
    outputs = np.asarray(result.outputs[scenario.scope_label], dtype=float)
    return time_values, outputs


def plot_transition(path: Path, scenario: Any, time_values: np.ndarray, analytic: np.ndarray, series: dict[str, np.ndarray]) -> None:
    figure, axis = plt.subplots(figsize=(8.4, 4.8), constrained_layout=True)
    axis.plot(time_values, analytic, label="analytic", linewidth=2.4, linestyle="--", color="#1f2937")
    axis.plot(time_values, series["rk4"], label="rk4", linewidth=1.8, color="#2563eb")
    axis.plot(time_values, series["solve_ivp"], label="solve_ivp", linewidth=1.8, color="#dc2626")
    axis.set_title(scenario.title)
    axis.set_xlabel("Time, s")
    axis.set_ylabel("Output")
    axis.grid(True, alpha=0.35)
    axis.legend()
    figure.savefig(path, dpi=180)
    plt.close(figure)


def plot_dt_sweep(path: Path, scenarios: list[Any], rows: list[dict[str, Any]]) -> None:
    figure, axes = plt.subplots(1, len(scenarios), figsize=(5.4 * len(scenarios), 4.6), constrained_layout=True)
    if len(scenarios) == 1:
        axes = [axes]

    for axis, scenario in zip(axes, scenarios):
        for solver, color in (("rk4", "#2563eb"), ("solve_ivp", "#dc2626")):
            matching = [
                row
                for row in rows
                if row["scenario_slug"] == scenario.slug and row["solver"] == solver
            ]
            matching.sort(key=lambda row: row["dt"])
            dts = [row["dt"] for row in matching]
            errors = [row["max_abs_error"] for row in matching]
            axis.plot(dts, errors, marker="o", linewidth=1.8, label=solver, color=color)

        axis.set_xscale("log")
        axis.set_yscale("log")
        axis.set_title(scenario.title)
        axis.set_xlabel("dt")
        axis.set_ylabel("max_abs_error")
        axis.grid(True, which="both", alpha=0.3)
        axis.legend()

    figure.savefig(path, dpi=180)
    plt.close(figure)


def plot_benchmark_boxplot(path: Path, benchmark_samples: dict[str, np.ndarray], benchmark_scenario: Any) -> None:
    figure, axis = plt.subplots(figsize=(7.2, 4.8), constrained_layout=True)
    axis.boxplot(
        [benchmark_samples["rk4"], benchmark_samples["solve_ivp"]],
        tick_labels=["rk4", "solve_ivp"],
        patch_artist=True,
        boxprops={"facecolor": "#bfdbfe", "edgecolor": "#1d4ed8"},
        medianprops={"color": "#111827", "linewidth": 1.5},
    )
    axis.set_title(f"Solver timing on {benchmark_scenario.slug}")
    axis.set_ylabel("Duration, ms")
    axis.grid(True, axis="y", alpha=0.3)
    figure.savefig(path, dpi=180)
    plt.close(figure)


def plot_benchmark_histogram(path: Path, benchmark_samples: dict[str, np.ndarray], benchmark_scenario: Any) -> None:
    figure, axis = plt.subplots(figsize=(7.8, 4.8), constrained_layout=True)
    axis.hist(benchmark_samples["rk4"], bins=18, alpha=0.65, label="rk4", color="#2563eb")
    axis.hist(benchmark_samples["solve_ivp"], bins=18, alpha=0.55, label="solve_ivp", color="#dc2626")
    axis.set_title(f"Timing distribution on {benchmark_scenario.slug}")
    axis.set_xlabel("Duration, ms")
    axis.set_ylabel("Count")
    axis.grid(True, axis="y", alpha=0.3)
    axis.legend()
    figure.savefig(path, dpi=180)
    plt.close(figure)


def scientific(value: float) -> str:
    return f"{value:.3e}"


def decimal(value: float) -> str:
    return f"{value:.4f}"


def ratio_display(value: float) -> str:
    if not np.isfinite(value):
        return "exact"
    return decimal(value)


def markdown_table(rows: list[dict[str, Any]], columns: list[tuple[str, str]]) -> str:
    header = "| " + " | ".join(label for _, label in columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"
    body = [
        "| " + " | ".join(str(row[key]) for key, _ in columns) + " |"
        for row in rows
    ]
    return "\n".join([header, separator, *body])


def generate_report_markdown(
    manifest: dict[str, Any],
    scenarios: list[Any],
    accuracy_rows: list[dict[str, Any]],
    solver_comparison_rows: list[dict[str, Any]],
    dt_sweep_summary_rows: list[dict[str, Any]],
    benchmark_summary_rows: list[dict[str, Any]],
) -> str:
    scenario_rows = [
        {
            "title": scenario.title,
            "diagram_path": scenario.as_dict()["diagram_path"],
            "t_end": decimal(scenario.t_end),
            "default_dt": scientific(scenario.default_dt),
            "description": scenario.description,
        }
        for scenario in scenarios
    ]

    accuracy_table_rows = [
        {
            "scenario": row["scenario_title"],
            "solver": row["solver"],
            "dt": scientific(row["dt"]),
            "max_abs_error": scientific(row["max_abs_error"]),
            "rmse": scientific(row["rmse"]),
            "final_value_error": scientific(row["final_value_error"]),
        }
        for row in accuracy_rows
    ]

    comparison_table_rows = [
        {
            "scenario": row["scenario_title"],
            "max_abs_diff": scientific(row["max_abs_diff"]),
            "rmse_diff": scientific(row["rmse_diff"]),
            "final_value_diff": scientific(row["final_value_diff"]),
        }
        for row in solver_comparison_rows
    ]

    dt_summary_table_rows = [
        {
            "scenario": row["scenario_title"],
            "solver": row["solver"],
            "largest_dt": scientific(row["largest_dt"]),
            "error_at_largest_dt": scientific(row["error_at_largest_dt"]),
            "smallest_dt": scientific(row["smallest_dt"]),
            "error_at_smallest_dt": scientific(row["error_at_smallest_dt"]),
            "reduction_factor": ratio_display(row["reduction_factor"]),
        }
        for row in dt_sweep_summary_rows
    ]

    benchmark_table_rows = [
        {
            "solver": row["solver"],
            "mean_ms": decimal(row["mean_ms"]),
            "median_ms": decimal(row["median_ms"]),
            "std_ms": decimal(row["std_ms"]),
            "min_ms": decimal(row["min_ms"]),
            "max_ms": decimal(row["max_ms"]),
            "repetitions": row["repetitions"],
        }
        for row in benchmark_summary_rows
    ]

    observed_errors = [row["max_abs_error"] for row in accuracy_rows]
    best_accuracy_row = min(accuracy_rows, key=lambda row: row["max_abs_error"])
    worst_accuracy_row = max(accuracy_rows, key=lambda row: row["max_abs_error"])
    fastest_solver_row = min(benchmark_summary_rows, key=lambda row: row["median_ms"])
    slowest_solver_row = max(benchmark_summary_rows, key=lambda row: row["median_ms"])

    lines = [
        "# Экспериментальная часть НИР",
        "",
        "_Файл сгенерирован скриптом `scripts/benchmarks/run_experiments.py`._",
        "",
        "## Цель экспериментальной части",
        "Цель экспериментов состоит в том, чтобы воспроизводимо оценить точность и вычислительные затраты текущего backend-ядра на ограниченном наборе эталонных структурных схем. Материалы ниже подготовлены из автоматически сгенерированных CSV/JSON и фигур, без ручной подстановки чисел.",
        "",
        "## Тестовые схемы",
        markdown_table(
            scenario_rows,
            [
                ("title", "Схема"),
                ("diagram_path", "Источник"),
                ("t_end", "t_end"),
                ("default_dt", "Базовый dt"),
                ("description", "Описание"),
            ],
        ),
        "",
        "Краткий вывод. Для экспериментов использованы четыре схемы с аналитическими эталонами, покрывающие интегрирующий, апериодический, колебательный режимы и ФНЧ Баттерворта.",
        "",
        "## Условия моделирования",
        f"- Дата генерации артефактов: `{manifest['generated_at_utc']}`.",
        f"- Python: `{manifest['environment']['python_version']}`.",
        f"- Платформа: `{manifest['environment']['platform']}`.",
        f"- Solver-ы: `{', '.join(manifest['solvers'])}`.",
        f"- Sweep по dt: `{', '.join(str(value) for value in manifest['dt_values'])}`.",
        f"- Бенчмарк: `{manifest['benchmark']['scenario_slug']}`, repetitions=`{manifest['benchmark']['repetitions']}`, warmup=`{manifest['benchmark']['warmup']}`.",
        "",
        "## Таблица ошибок для эталонных схем",
        markdown_table(
            accuracy_table_rows,
            [
                ("scenario", "Схема"),
                ("solver", "Solver"),
                ("dt", "dt"),
                ("max_abs_error", "max_abs_error"),
                ("rmse", "RMSE"),
                ("final_value_error", "final_value_error"),
            ],
        ),
        "",
        (
            "Краткий вывод. На базовых прогонах наблюдаемый диапазон `max_abs_error` составил "
            f"от `{scientific(min(observed_errors))}` до `{scientific(max(observed_errors))}`. "
            f"Наилучший результат в этой выборке дал `{best_accuracy_row['solver']}` для схемы "
            f"`{best_accuracy_row['scenario_slug']}` (`{scientific(best_accuracy_row['max_abs_error'])}`), "
            f"наибольшая ошибка наблюдалась для `{worst_accuracy_row['solver']}` на схеме "
            f"`{worst_accuracy_row['scenario_slug']}` (`{scientific(worst_accuracy_row['max_abs_error'])}`)."
        ),
        "",
        "## Графики переходных процессов",
    ]

    for scenario in scenarios:
        lines.extend(
            [
                f"### {scenario.title}",
                f"![{scenario.title}](figures/transition_{scenario.slug}.png)",
                (
                    "Краткий вывод. На графике совмещены аналитическая кривая и оба solver-а; "
                    "визуальное совпадение следует трактовать вместе с таблицей ошибок, а не как самостоятельное доказательство точности."
                ),
                "",
            ]
        )

    lines.extend(
        [
            "## Сравнение rk4 и solve_ivp",
            markdown_table(
                comparison_table_rows,
                [
                    ("scenario", "Схема"),
                    ("max_abs_diff", "max_abs_diff"),
                    ("rmse_diff", "RMSE_diff"),
                    ("final_value_diff", "final_value_diff"),
                ],
            ),
            "",
            "Краткий вывод. Различия между `rk4` и `solve_ivp` на одинаковой сетке времени остаются измеримыми, но на рассмотренных схемах не меняют качественную форму переходных процессов.",
            "",
            "## График ошибки от dt",
            "![Зависимость ошибки от dt](figures/error_vs_dt_max_abs.png)",
            "",
            markdown_table(
                dt_summary_table_rows,
                [
                    ("scenario", "Схема"),
                    ("solver", "Solver"),
                    ("largest_dt", "Крупный dt"),
                    ("error_at_largest_dt", "Ошибка при крупном dt"),
                    ("smallest_dt", "Малый dt"),
                    ("error_at_smallest_dt", "Ошибка при малом dt"),
                    ("reduction_factor", "Во сколько раз уменьшилась ошибка"),
                ],
            ),
            "",
            "Краткий вывод. На исследованной сетке уменьшение `dt` для `rk4` приводит к ожидаемому снижению ошибки. Для `solve_ivp` этот график нужно трактовать осторожно, потому что в текущем API параметр `dt` задаёт прежде всего сетку сохранения результата, а внутренний шаг интегрирования у `solve_ivp` остаётся адаптивным.",
            "",
            "## Бенчмарки времени",
            markdown_table(
                benchmark_table_rows,
                [
                    ("solver", "Solver"),
                    ("mean_ms", "mean_ms"),
                    ("median_ms", "median_ms"),
                    ("std_ms", "std_ms"),
                    ("min_ms", "min_ms"),
                    ("max_ms", "max_ms"),
                    ("repetitions", "N"),
                ],
            ),
            "",
            "![Boxplot времени](figures/benchmark_boxplot.png)",
            "",
            "![Histogram времени](figures/benchmark_histogram.png)",
            "",
            (
                "Краткий вывод. В данном запуске более низкую медиану времени показал "
                f"`{fastest_solver_row['solver']}` (`{decimal(fastest_solver_row['median_ms'])}` ms), "
                f"а более высокую — `{slowest_solver_row['solver']}` (`{decimal(slowest_solver_row['median_ms'])}` ms). "
                "Эти абсолютные времена относятся только к текущей машине, версии Python и текущей сборке зависимостей."
            ),
            "",
            "## Ограничения интерпретации результатов",
            "- Эксперименты охватывают только четыре эталонные схемы из ограниченной библиотеки блоков и не доказывают универсальность для произвольных динамических систем.",
            "- Для `solve_ivp` зависимость ошибки от `dt` нельзя трактовать так же, как для `rk4`, поскольку внутренний шаг интегрирования выбирается адаптивно, а `dt` влияет главным образом на сетку вывода.",
            "- Бенчмарк включает не только собственно solver, но и компиляцию диаграммы, построение временной сетки и вычисление выходов Scope, то есть отражает время полного backend-пайплайна, а не изолированного численного ядра.",
            "- Абсолютные времена исполнения зависят от локальной машины и окружения; переносить их в отчёт без повторного прогона на целевой машине не следует.",
            "- Наличие аналитического эталона в этих сценариях упрощает интерпретацию; для более сложных схем в дальнейшем потребуется отдельная методика верификации.",
        ]
    )

    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    data_dir, figures_dir = ensure_output_dirs()
    scenarios = build_scenarios()

    accuracy_rows: list[dict[str, Any]] = []
    solver_comparison_rows: list[dict[str, Any]] = []
    dt_sweep_rows: list[dict[str, Any]] = []
    dt_sweep_summary_rows: list[dict[str, Any]] = []
    loaded_diagrams = {scenario.slug: scenario.load_diagram() for scenario in scenarios}

    for scenario in scenarios:
        diagram = loaded_diagrams[scenario.slug]
        baseline_series: dict[str, np.ndarray] = {}
        baseline_time: np.ndarray | None = None
        analytic_values: np.ndarray | None = None

        for solver in SOLVERS:
            time_values, outputs = simulate_series(scenario, diagram, solver, scenario.default_dt)
            reference = scenario.reference(time_values)
            metrics = compute_error_metrics(outputs, reference)

            if baseline_time is None:
                baseline_time = time_values
                analytic_values = reference
            baseline_series[solver] = outputs

            accuracy_rows.append(
                {
                    "scenario_slug": scenario.slug,
                    "scenario_title": scenario.title,
                    "solver": solver,
                    "dt": scenario.default_dt,
                    "max_abs_error": metrics.max_abs_error,
                    "rmse": metrics.rmse,
                    "final_value_error": metrics.final_value_error,
                }
            )

        assert baseline_time is not None and analytic_values is not None
        solver_gap = compute_error_metrics(baseline_series["rk4"], baseline_series["solve_ivp"])
        solver_comparison_rows.append(
            {
                "scenario_slug": scenario.slug,
                "scenario_title": scenario.title,
                "max_abs_diff": solver_gap.max_abs_error,
                "rmse_diff": solver_gap.rmse,
                "final_value_diff": solver_gap.final_value_error,
            }
        )

        timeseries_rows = [
            {
                "time": float(time_point),
                "analytic": float(analytic_point),
                "rk4": float(rk4_point),
                "solve_ivp": float(ivp_point),
            }
            for time_point, analytic_point, rk4_point, ivp_point in zip(
                baseline_time,
                analytic_values,
                baseline_series["rk4"],
                baseline_series["solve_ivp"],
            )
        ]
        write_csv(
            data_dir / f"timeseries_{scenario.slug}.csv",
            ["time", "analytic", "rk4", "solve_ivp"],
            timeseries_rows,
        )
        plot_transition(
            figures_dir / f"transition_{scenario.slug}.png",
            scenario,
            baseline_time,
            analytic_values,
            baseline_series,
        )

        scenario_dt_rows: list[dict[str, Any]] = []
        for dt in args.dt_values:
            for solver in SOLVERS:
                time_values, outputs = simulate_series(scenario, diagram, solver, dt)
                reference = scenario.reference(time_values)
                metrics = compute_error_metrics(outputs, reference)
                row = {
                    "scenario_slug": scenario.slug,
                    "scenario_title": scenario.title,
                    "solver": solver,
                    "dt": float(dt),
                    "max_abs_error": metrics.max_abs_error,
                    "rmse": metrics.rmse,
                    "final_value_error": metrics.final_value_error,
                }
                dt_sweep_rows.append(row)
                scenario_dt_rows.append(row)

        for solver in SOLVERS:
            matching = [
                row for row in scenario_dt_rows if row["solver"] == solver
            ]
            matching.sort(key=lambda row: row["dt"])
            smallest = matching[0]
            largest = matching[-1]
            reduction_factor = (
                largest["max_abs_error"] / smallest["max_abs_error"]
                if smallest["max_abs_error"] > 0.0
                else float("inf")
            )
            dt_sweep_summary_rows.append(
                {
                    "scenario_slug": scenario.slug,
                    "scenario_title": scenario.title,
                    "solver": solver,
                    "largest_dt": largest["dt"],
                    "error_at_largest_dt": largest["max_abs_error"],
                    "smallest_dt": smallest["dt"],
                    "error_at_smallest_dt": smallest["max_abs_error"],
                    "reduction_factor": reduction_factor,
                }
            )

    plot_dt_sweep(figures_dir / "error_vs_dt_max_abs.png", scenarios, dt_sweep_rows)

    benchmark_scenario = next(
        scenario for scenario in scenarios if scenario.slug == BENCHMARK_SCENARIO_SLUG
    )
    benchmark_sample_rows: list[dict[str, Any]] = []
    benchmark_summary_rows: list[dict[str, Any]] = []
    benchmark_samples: dict[str, np.ndarray] = {}

    for solver in SOLVERS:
        for _ in range(args.benchmark_warmup):
            simulate_series(
                benchmark_scenario,
                loaded_diagrams[benchmark_scenario.slug],
                solver,
                benchmark_scenario.default_dt,
            )

        samples_ms: list[float] = []
        for iteration in range(1, args.benchmark_repetitions + 1):
            started = time.perf_counter()
            simulate_series(
                benchmark_scenario,
                loaded_diagrams[benchmark_scenario.slug],
                solver,
                benchmark_scenario.default_dt,
            )
            duration_ms = (time.perf_counter() - started) * 1000.0
            samples_ms.append(duration_ms)
            benchmark_sample_rows.append(
                {
                    "scenario_slug": benchmark_scenario.slug,
                    "solver": solver,
                    "iteration": iteration,
                    "duration_ms": duration_ms,
                }
            )

        sample_array = np.asarray(samples_ms, dtype=float)
        benchmark_samples[solver] = sample_array
        summary = summarize_timings(sample_array)
        benchmark_summary_rows.append(
            {
                "scenario_slug": benchmark_scenario.slug,
                "solver": solver,
                "mean_ms": summary.mean_ms,
                "median_ms": summary.median_ms,
                "std_ms": summary.std_ms,
                "min_ms": summary.min_ms,
                "max_ms": summary.max_ms,
                "repetitions": args.benchmark_repetitions,
                "warmup": args.benchmark_warmup,
                "dt": benchmark_scenario.default_dt,
                "t_end": benchmark_scenario.t_end,
            }
        )

    plot_benchmark_boxplot(
        figures_dir / "benchmark_boxplot.png",
        benchmark_samples,
        benchmark_scenario,
    )
    plot_benchmark_histogram(
        figures_dir / "benchmark_histogram.png",
        benchmark_samples,
        benchmark_scenario,
    )

    write_csv(
        data_dir / "accuracy_summary.csv",
        ["scenario_slug", "scenario_title", "solver", "dt", "max_abs_error", "rmse", "final_value_error"],
        accuracy_rows,
    )
    write_json(data_dir / "accuracy_summary.json", accuracy_rows)

    write_csv(
        data_dir / "solver_comparison.csv",
        ["scenario_slug", "scenario_title", "max_abs_diff", "rmse_diff", "final_value_diff"],
        solver_comparison_rows,
    )

    write_csv(
        data_dir / "dt_sweep_metrics.csv",
        ["scenario_slug", "scenario_title", "solver", "dt", "max_abs_error", "rmse", "final_value_error"],
        dt_sweep_rows,
    )
    write_csv(
        data_dir / "dt_sweep_summary.csv",
        [
            "scenario_slug",
            "scenario_title",
            "solver",
            "largest_dt",
            "error_at_largest_dt",
            "smallest_dt",
            "error_at_smallest_dt",
            "reduction_factor",
        ],
        dt_sweep_summary_rows,
    )
    write_csv(
        data_dir / "benchmark_samples.csv",
        ["scenario_slug", "solver", "iteration", "duration_ms"],
        benchmark_sample_rows,
    )
    write_csv(
        data_dir / "benchmark_summary.csv",
        ["scenario_slug", "solver", "mean_ms", "median_ms", "std_ms", "min_ms", "max_ms", "repetitions", "warmup", "dt", "t_end"],
        benchmark_summary_rows,
    )

    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "solvers": list(SOLVERS),
        "dt_values": [float(value) for value in args.dt_values],
        "benchmark": {
            "scenario_slug": benchmark_scenario.slug,
            "repetitions": args.benchmark_repetitions,
            "warmup": args.benchmark_warmup,
        },
        "environment": {
            "python_version": platform.python_version(),
            "platform": platform.platform(),
        },
        "scenarios": [scenario.as_dict() for scenario in scenarios],
    }
    write_json(data_dir / "experiment_manifest.json", manifest)

    report_markdown = generate_report_markdown(
        manifest=manifest,
        scenarios=scenarios,
        accuracy_rows=accuracy_rows,
        solver_comparison_rows=solver_comparison_rows,
        dt_sweep_summary_rows=dt_sweep_summary_rows,
        benchmark_summary_rows=benchmark_summary_rows,
    )
    (REPO_ROOT / "docs" / "nir_experiments.md").write_text(report_markdown, encoding="utf-8")


if __name__ == "__main__":
    main()
