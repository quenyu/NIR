"""Numerical study of the Control Lab core, reproducible with one command:

    cd backend && python scripts/numerical_study.py

Writes CSV tables to docs/study/, figures to docs/figures/ and the report to
docs/numerical_study.md. Sections:

1. compiler correctness: assembled models of reference diagrams against the
   transfer matrices of block-diagram algebra;
2. integration accuracy against the exact matrix-exponential solution:
   error versus step, observed order of RK4, RK45 error;
3. RK4 stability boundary on the imaginary axis versus the theoretical 2*sqrt(2);
4. controllability: Kalman rank versus the PBH test (Butterworth filters);
5. cost: assembly and simulation time versus model order.
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
from scipy.signal import tf2ss  # noqa: E402

from app.analysis.stability import rk4_step_check  # noqa: E402
from app.analysis.system import controllability  # noqa: E402
from app.core.block_specs import butterworth_coefficients  # noqa: E402
from app.models.diagram import Diagram  # noqa: E402
from app.simulation.model import compile_model  # noqa: E402
from app.simulation.solvers import exact_lti_integrate, rk4_integrate, solve_ivp_integrate  # noqa: E402
from app.tests.structural_cases import (  # noqa: E402
    EVALUATION_POINTS,
    DiagramBuilder,
    all_cases,
    model_transfer,
    nested_feedback_case,
    pid_loop_case,
)

STUDY = REPO / "docs" / "study"
FIGURES = REPO / "docs" / "figures"
SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"]  # validated categorical order


def write_csv(name: str, rows: list[dict]) -> None:
    STUDY.mkdir(parents=True, exist_ok=True)
    with (STUDY / name).open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def table(rows: list[dict], columns: list[str]) -> str:
    lines = ["| " + " | ".join(columns) + " |", "|" + "---|" * len(columns)]
    for row in rows:
        lines.append("| " + " | ".join(str(row[c]) for c in columns) + " |")
    return "\n".join(lines)


def model_of(diagram: dict):
    return compile_model(Diagram.model_validate(diagram)).model


def outputs(model, grid, states):
    sources = np.stack([model.source_values(t) for t in grid], axis=1)
    return model.c @ states + model.d @ sources


def compiler_correctness() -> list[dict]:
    rows = []
    for case in all_cases():
        model = model_of(case.diagram)
        errors = []
        for s in EVALUATION_POINTS:
            expected = case.transfer(s)
            actual = model_transfer(model.a, model.b, model.c, model.d, s)
            errors.append(float(np.max(np.abs(actual - expected)) / max(1.0, float(np.max(np.abs(expected))))))
        rows.append({
            "схема": case.name,
            "n": model.state_dimension,
            "входы": len(model.sources),
            "выходы": len(model.scopes),
            "алг. петли": len(model.algebraic_loops),
            "макс. отн. ошибка G(s)": f"{max(errors):.1e}",
        })
    return rows


def accuracy_versus_step() -> tuple[list[dict], dict[str, list[tuple[float, float]]]]:
    rows, curves = [], {}
    for case in (pid_loop_case(), nested_feedback_case()):
        model = model_of(case.diagram)
        curve = []
        for dt in (0.2, 0.1, 0.05, 0.025, 0.0125):
            grid = np.arange(0.0, 8.0 + dt / 2, dt)
            exact = outputs(model, grid, exact_lti_integrate(model.a, model.b, model.source_values, model.x0, grid))
            rk4 = outputs(model, grid, rk4_integrate(model.rhs, model.x0, grid))
            rk45 = outputs(model, grid, solve_ivp_integrate(model.rhs, model.x0, grid))
            e4 = float(np.max(np.abs(rk4 - exact)))
            e45 = float(np.max(np.abs(rk45 - exact)))
            curve.append((dt, e4))
            rows.append({"схема": case.name, "dt": dt, "ошибка RK4": f"{e4:.2e}", "ошибка RK45": f"{e45:.2e}"})
        orders = [np.log2(curve[i][1] / curve[i + 1][1]) for i in range(len(curve) - 1)]
        for row, order in zip(rows[-len(curve) + 1:], orders, strict=True):
            row["порядок RK4"] = f"{order:.2f}"
        rows[-len(curve)]["порядок RK4"] = "—"
        curves[case.name] = curve
    return rows, curves


def rk4_boundary() -> list[dict]:
    rows = []
    for omega in (1.0, 10.0, 100.0):
        a, _, _, _ = tf2ss([omega**2], [1.0, 0.0, omega**2])
        limit = rk4_step_check(np.asarray(a), 10.0 / omega)["max_step"]  # probe beyond the boundary
        rows.append({
            "ω, рад/с": omega,
            "h_max (численно)": f"{limit:.6f}",
            "h_max·ω": f"{limit * omega:.6f}",
            "2√2": f"{2 * np.sqrt(2):.6f}",
        })
    return rows


def kalman_rank(a: np.ndarray, b: np.ndarray) -> int:
    blocks, current = [b], b
    for _ in range(a.shape[0] - 1):
        current = a @ current
        blocks.append(current)
    return int(np.linalg.matrix_rank(np.hstack(blocks)))


def kalman_condition(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.cond(np.hstack([np.linalg.matrix_power(a, k) @ b for k in range(a.shape[0])])))


def controllability_tests() -> list[dict]:
    rows = []
    for order in range(2, 11):
        numerator, denominator = butterworth_coefficients(order, 10.0)
        a, b, _, _ = (np.asarray(m, dtype=float) for m in tf2ss(numerator, denominator))
        pbh = controllability(a, b)
        rows.append({
            "порядок n": order,
            "ранг Калмана": kalman_rank(a, b),
            "ранг PBH": pbh["rank"],
            "запас PBH": f"{pbh['margin']:.1e}",
            "cond(матрица Калмана)": f"{kalman_condition(a, b):.1e}",
        })
    return rows


def chain(order: int) -> dict:
    b = DiagramBuilder()
    previous = b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    for index in range(order):
        current = b.add(f"lag{index}", "FirstOrderLag", k=1.0, T=0.2 + 0.01 * index, y0=0.0)
        b.link(previous, current)
        previous = current
    b.add("y", "Scope", label="y")
    b.link(previous, "y")
    return b.build()


def cost_versus_order() -> list[dict]:
    rows = []
    for order in (2, 8, 32, 64, 128):
        diagram = Diagram.model_validate(chain(order))
        start = time.perf_counter()
        model = compile_model(diagram).model
        assembled = time.perf_counter() - start
        grid = np.linspace(0.0, 10.0, 1001)
        start = time.perf_counter()
        rk4_integrate(model.rhs, model.x0, grid)
        rk4_time = time.perf_counter() - start
        start = time.perf_counter()
        solve_ivp_integrate(model.rhs, model.x0, grid)
        rk45_time = time.perf_counter() - start
        rows.append({
            "n": order,
            "сборка, мс": f"{assembled * 1e3:.2f}",
            "RK4 (1000 шагов), мс": f"{rk4_time * 1e3:.1f}",
            "RK45, мс": f"{rk45_time * 1e3:.1f}",
        })
    return rows


def plot_error_versus_step(curves: dict[str, list[tuple[float, float]]]) -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)
    figure, axis = plt.subplots(figsize=(7.2, 4.2), constrained_layout=True)
    for index, (name, curve) in enumerate(curves.items()):
        steps, errors = zip(*curve, strict=True)
        axis.loglog(steps, errors, marker="o", markersize=5, linewidth=2, color=SERIES[index], label=name)
    reference = np.array([0.0125, 0.2])
    scale = curves[next(iter(curves))][-1][1] / reference[0] ** 4
    axis.loglog(reference, scale * reference**4, linestyle="--", linewidth=1, color="#8c8f95", label="наклон 4")
    axis.set_xlabel("шаг h, с")
    axis.set_ylabel("max |y_RK4 − y_точн|")
    axis.grid(True, which="both", color="#e5e5e5", linewidth=0.6)
    axis.legend(frameon=False)
    figure.savefig(FIGURES / "rk4_order.png", dpi=160)
    plt.close(figure)


def main() -> None:
    sections = {
        "compiler": compiler_correctness(),
        "boundary": rk4_boundary(),
        "controllability": controllability_tests(),
        "cost": cost_versus_order(),
    }
    accuracy, curves = accuracy_versus_step()
    sections["accuracy"] = accuracy
    for name, rows in sections.items():
        write_csv(f"{name}.csv", rows)
    plot_error_versus_step(curves)

    report = f"""# Численное исследование ядра Control Lab

_Сгенерировано `backend/scripts/numerical_study.py` · Python {platform.python_version()} · {platform.platform()}._
Таблицы лежат в `docs/study/*.csv`; числа ниже не редактируются вручную.

## 1. Корректность компиляции структурных схем

Для каждой эталонной схемы из `app/tests/structural_cases.py` собранная модель (A, B, C, D) сравнивается с
передаточной матрицей, полученной правилами структурных преобразований, в четырёх точках s:
`max |C(sI − A)⁻¹B + D − G(s)| / max(1, |G(s)|)`.

{table(sections["compiler"], list(sections["compiler"][0]))}

Вложенные схемы дают те же передаточные функции, что и их плоские эквиваленты. Алгебраические петли
(бипропер-звено и статическая петля) решаются точно.

## 2. Точность интегрирования относительно точного решения

Эталон — решение `x(t+h) = e^(Ah) x(t) + ∫e^(As)ds · B r`, точное для ступенчатых входов.
Порядок RK4 = log₂(e(h)/e(h/2)); теоретическое значение 4.

{table(accuracy, ["схема", "dt", "ошибка RK4", "порядок RK4", "ошибка RK45"])}

![Ошибка RK4 от шага](figures/rk4_order.png)

## 3. Граница устойчивости RK4 на мнимой оси

Для незатухающего осциллятора ω максимальный устойчивый шаг находится бисекцией по |R(hλ)| ≤ 1.
Теория: h·ω ≤ 2√2.

{table(sections["boundary"], list(sections["boundary"][0]))}

## 4. Управляемость: ранг Калмана и тест PBH

{table(sections["controllability"], list(sections["controllability"][0]))}

Матрица Калмана быстро теряет обусловленность. При n ≥ 8 численный ранг занижается, хотя
фильтр Баттерворта управляем при любом порядке. Тест PBH на сбалансированной реализации даёт правильный ранг.

## 5. Вычислительные затраты

Цепочка из n апериодических звеньев, 1000 шагов на интервале 10 с. Однократный замер wall-clock:
цифры показывают порядок величины; время RK45 зависит от числа шагов, выбранных адаптивно.

{table(sections["cost"], list(sections["cost"][0]))}
"""
    (REPO / "docs" / "numerical_study.md").write_text(report, encoding="utf-8")
    print("written docs/numerical_study.md")


if __name__ == "__main__":
    main()
