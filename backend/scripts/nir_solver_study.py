"""Численные методы вычислительного ядра: Эйлер, RK4 и RK45 (исследование для НИР).

    cd backend && python scripts/nir_solver_study.py

Пишет таблицы в docs/study/nir_*.csv, графики в docs/figures/nir_*.png и сводку
в docs/nir_solver_study.md. Разделы:

1. точность от шага на трёх схемах с известным решением, наблюдаемый порядок;
2. какой шаг нужен каждому методу для ошибки не больше 10^-3;
3. устойчивость явного метода Эйлера на апериодическом звене: при h > 2T расчёт расходится;
4. время расчёта.
Эталон — точное решение через матричную экспоненту (exact_lti_integrate).
"""

from __future__ import annotations

import csv
import platform
import sys
import time
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402

from app.models.diagram import Diagram  # noqa: E402
from app.simulation.model import compile_model  # noqa: E402
from app.simulation.solvers import (  # noqa: E402
    SolverError,
    euler_integrate,
    exact_lti_integrate,
    rk4_integrate,
    solve_ivp_integrate,
)
from app.tests.structural_cases import DiagramBuilder, pid_loop_case  # noqa: E402

STUDY = REPO / "docs" / "study"
FIGURES = REPO / "docs" / "figures"
# Чёрно-белая печать: серии различаются типом линии и маркером, а не цветом.
INK = ["black", "black", "0.45", "0.45"]
LINES = ["-", "--", "-.", ":"]
MARKS = ["o", "s", "^", "D"]
STEPS = (0.2, 0.1, 0.05, 0.025, 0.0125)
METHODS = {"Эйлер": euler_integrate, "RK4": rk4_integrate, "RK45": solve_ivp_integrate}


def write_csv(name: str, rows: list[dict]) -> None:
    STUDY.mkdir(parents=True, exist_ok=True)
    with (STUDY / name).open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def table(rows: list[dict]) -> str:
    columns = list(rows[0])
    lines = ["| " + " | ".join(columns) + " |", "|" + "---|" * len(columns)]
    lines += ["| " + " | ".join(str(row[c]) for c in columns) + " |" for row in rows]
    return "\n".join(lines)


def lag_diagram(k: float = 1.0, t: float = 1.0) -> dict:
    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    b.add("lag", "FirstOrderLag", k=k, T=t, y0=0.0)
    b.add("scope", "Scope", label="y")
    b.link("u", "lag")
    b.link("lag", "scope")
    return b.build()


def oscillator_diagram(wn: float = 2.0, zeta: float = 0.3) -> dict:
    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    b.add("osc", "SecondOrderOscillator", k=1.0, wn=wn, zeta=zeta, y0=0.0, v0=0.0)
    b.add("scope", "Scope", label="y")
    b.link("u", "osc")
    b.link("osc", "scope")
    return b.build()


CASES = {
    "звено 1-го порядка": lag_diagram(),
    "колебательное звено": oscillator_diagram(),
    "замкнутый контур с ПИД": pid_loop_case().diagram,
}


def model_of(diagram: dict):
    return compile_model(Diagram.model_validate(diagram)).model


def simulate(model, method, grid: np.ndarray) -> np.ndarray:
    states = method(model.rhs, model.x0, grid)
    sources = np.stack([model.source_values(t) for t in grid], axis=1)
    return (model.c @ states + model.d @ sources)[0]


def exact(model, grid: np.ndarray) -> np.ndarray:
    states = exact_lti_integrate(model.a, model.b, model.source_values, model.x0, grid)
    sources = np.stack([model.source_values(t) for t in grid], axis=1)
    return (model.c @ states + model.d @ sources)[0]


def grid_of(t_end: float, dt: float) -> np.ndarray:
    return np.arange(0.0, t_end + dt / 2, dt)


def accuracy_versus_step() -> tuple[list[dict], dict[str, dict[str, list[float]]]]:
    rows, curves = [], {}
    for case, diagram in CASES.items():
        model = model_of(diagram)
        errors: dict[str, list[float]] = {name: [] for name in METHODS}
        for dt in STEPS:
            grid = grid_of(8.0, dt)
            reference = exact(model, grid)
            row = {"схема": case, "шаг h": dt}
            for name, method in METHODS.items():
                error = float(np.max(np.abs(simulate(model, method, grid) - reference)))
                errors[name].append(error)
                row[f"ошибка {name}"] = f"{error:.2e}"
            rows.append(row)
        for name in ("Эйлер", "RK4"):
            orders = np.log2(np.asarray(errors[name][:-1]) / np.asarray(errors[name][1:]))
            for row, order in zip(rows[-len(STEPS) + 1:], orders, strict=True):
                row[f"порядок {name}"] = f"{order:.2f}"
            rows[-len(STEPS)][f"порядок {name}"] = "—"
        curves[case] = errors
    return rows, curves


def step_for_tolerance(tolerance: float = 1e-3) -> list[dict]:
    """Наибольший шаг из ряда h = 0.5 / 2^k, при котором ошибка не превышает tolerance."""

    rows = []
    for case, diagram in CASES.items():
        model = model_of(diagram)
        row: dict = {"схема": case}
        for name in ("Эйлер", "RK4"):
            dt = 0.5
            while dt > 1e-5:
                grid = grid_of(8.0, dt)
                try:
                    error = float(np.max(np.abs(simulate(model, METHODS[name], grid) - exact(model, grid))))
                except SolverError:
                    error = np.inf
                if error <= tolerance:
                    break
                dt /= 2
            row[f"шаг {name}"] = f"{dt:g}"
            row[f"шагов {name}"] = int(round(8.0 / dt))
        row["выигрыш RK4, раз"] = f"{row['шагов Эйлер'] / row['шагов RK4']:.0f}"
        rows.append(row)
    return rows


def euler_stability(t_const: float = 1.0) -> tuple[list[dict], dict[float, tuple[np.ndarray, np.ndarray]]]:
    model = model_of(lag_diagram(t=t_const))
    rows, traces = [], {}
    for h in (0.5, 1.0, 1.5, 1.9, 2.1, 2.5):
        grid = grid_of(30.0, h)
        row = {"h / T": f"{h / t_const:.1f}", "множитель ошибки за шаг": f"{abs(1 - h / t_const):.1f}"}
        for name in ("Эйлер", "RK4"):
            try:
                y = simulate(model, METHODS[name], grid)
                deviation = float(abs(y[-1] - 1.0))
                row[f"{name}: откл. при t = 30"] = f"{deviation:.1e}"
                row[f"{name}: итог"] = "сходится" if deviation < 0.5 else "расходится"
                if name == "Эйлер":
                    traces[h] = (grid, y)
            except SolverError:
                row[f"{name}: откл. при t = 30"] = "∞"
                row[f"{name}: итог"] = "расходится"
        rows.append(row)
    return rows, traces


def cost() -> list[dict]:
    model = model_of(pid_loop_case().diagram)
    grid = grid_of(10.0, 0.01)
    rows = []
    for name, method in METHODS.items():
        samples = []
        for _ in range(15):
            started = time.perf_counter()
            method(model.rhs, model.x0, grid)
            samples.append(time.perf_counter() - started)
        calls = {"Эйлер": 1, "RK4": 4, "RK45": None}[name]
        rows.append({
            "метод": name,
            "вычислений f на шаг": calls if calls else "переменно",
            "время, мс (медиана)": f"{np.median(samples) * 1e3:.2f}",
            "ошибка при h = 0,01": "",
        })
    reference = exact(model, grid)
    for row in rows:
        error = float(np.max(np.abs(simulate(model, METHODS[row["метод"]], grid) - reference)))
        row["ошибка при h = 0,01"] = f"{error:.1e}"
    return rows


def plot_error_versus_step(curves: dict[str, dict[str, list[float]]]) -> None:
    figure, axes = plt.subplots(1, 3, figsize=(12, 3.8), sharey=True)
    for axis, (case, errors) in zip(axes, curves.items(), strict=True):
        for i, (name, values) in enumerate(errors.items()):
            axis.loglog(STEPS, values, color=INK[i], ls=LINES[i], marker=MARKS[i], mfc="white", lw=1.6, ms=6,
                        label=name)
        axis.set_title(case, fontsize=11)
        axis.set_xticks(STEPS, [f"{h:g}".replace(".", ",") for h in STEPS])
        axis.minorticks_off()
        axis.set_xlabel("шаг h, с")
        axis.grid(True, which="both", color="0.85", lw=0.6)
    axes[0].set_ylabel("макс. ошибка")
    axes[0].legend(frameon=False)
    figure.tight_layout()
    figure.savefig(FIGURES / "nir_error_vs_step.png", dpi=170)
    plt.close(figure)


def plot_euler_versus_rk4() -> None:
    model = model_of(oscillator_diagram())
    fine = grid_of(8.0, 0.001)
    coarse = grid_of(8.0, 0.1)
    figure, axis = plt.subplots(figsize=(7.5, 3.8))
    axis.plot(fine, exact(model, fine), color="0.6", lw=3, label="точное решение")
    runs = (("--", "o", "Эйлер", euler_integrate), ("-", "s", "RK4", rk4_integrate))
    for line, marker, name, method in runs:
        y = simulate(model, method, coarse)
        axis.plot(coarse, y, color="black", ls=line, marker=marker, mfc="white", lw=1.2, ms=4,
                  label=f"{name}, h = 0,1")
    axis.set_xlabel("время t, с")
    axis.set_ylabel("выход y(t)")
    axis.grid(True, color="0.85", lw=0.6)
    axis.legend(frameon=False)
    figure.tight_layout()
    figure.savefig(FIGURES / "nir_euler_vs_rk4.png", dpi=170)
    plt.close(figure)


def plot_euler_stability(traces: dict[float, tuple[np.ndarray, np.ndarray]]) -> None:
    figure, axis = plt.subplots(figsize=(7.5, 3.8))
    for i, h in enumerate((0.5, 1.5, 1.9, 2.1)):
        grid, y = traces[h]
        mask = grid <= 20.0
        axis.plot(grid[mask], y[mask], color=INK[i], ls=LINES[i], marker=MARKS[i], mfc="white", lw=1.4, ms=4,
                  label=f"h = {h:g}·T".replace(".", ","))
    axis.axhline(1.0, color="0.35", lw=1, ls="--")
    axis.set_ylim(-1.5, 3.5)
    axis.set_xlabel("время t, с")
    axis.set_ylabel("выход y(t)")
    axis.grid(True, color="0.85", lw=0.6)
    axis.legend(frameon=False, ncol=2)
    figure.tight_layout()
    figure.savefig(FIGURES / "nir_euler_stability.png", dpi=170)
    plt.close(figure)


def main() -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)
    accuracy, curves = accuracy_versus_step()
    tolerance = step_for_tolerance()
    stability, traces = euler_stability()
    timing = cost()
    write_csv("nir_accuracy.csv", accuracy)
    write_csv("nir_step_for_tolerance.csv", tolerance)
    write_csv("nir_euler_stability.csv", stability)
    write_csv("nir_cost.csv", timing)
    plot_error_versus_step(curves)
    plot_euler_versus_rk4()
    plot_euler_stability(traces)

    report = f"""# Численные методы вычислительного ядра: Эйлер, RK4, RK45

_Сгенерировано `backend/scripts/nir_solver_study.py` · Python {platform.python_version()} · {platform.platform()}._
Эталон — точное решение через матричную экспоненту. Таблицы — `docs/study/nir_*.csv`.

## 1. Точность от шага

{table(accuracy)}

![Ошибка от шага](figures/nir_error_vs_step.png)

## 2. Шаг для ошибки не больше 10⁻³ на интервале 8 с

{table(tolerance)}

![Эйлер и RK4 при одном шаге](figures/nir_euler_vs_rk4.png)

## 3. Устойчивость метода Эйлера на звене 1-го порядка (T = 1)

Один шаг Эйлера умножает отклонение от установившегося значения на (1 − h/T), поэтому при h > 2T расчёт
расходится, хотя само звено устойчиво.

{table(stability)}

![Эйлер при разных шагах](figures/nir_euler_stability.png)

## 4. Время расчёта (контур с ПИД, 10 с, h = 0,01)

{table(timing)}
"""
    (REPO / "docs" / "nir_solver_study.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
