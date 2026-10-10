"""Исследование метода автоматического построения модели САУ по структурной схеме (НИР).

    cd backend && python scripts/nir_assembly_study.py

Пишет таблицы docs/study/nir_assembly_*.csv, графики docs/figures/nir_assembly_*.png и
сводку docs/nir_assembly_study.md. Разделы:

1. корректность: модели 16 эталонных схем против правил структурных преобразований,
   сравнение с поблочным подходом (прежний компилятор, app/tests/reference_evaluator.py);
2. алгебраические контуры: обусловленность κ и точность решения в зависимости от коэффициента петли;
3. иерархия: вложенная и плоская схемы дают одну модель; время раскрытия от глубины вложенности;
4. затраты: время сборки от порядка модели и от числа контуров.
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
sys.path.insert(0, str(BACKEND / "scripts"))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402

from app.models.diagram import Diagram  # noqa: E402
from app.simulation.assembly import MAX_LOOP_CONDITION  # noqa: E402
from app.simulation.hierarchy import flatten_diagram  # noqa: E402
from app.simulation.model import DiagramCompilationError, compile_model  # noqa: E402
from app.simulation.solvers import exact_lti_integrate  # noqa: E402
from app.tests.reference_evaluator import compile_diagram, probe_state_space  # noqa: E402
from app.tests.structural_cases import (  # noqa: E402
    EVALUATION_POINTS,
    DiagramBuilder,
    all_cases,
    flat_equivalent_of_subsystem_feedback,
    model_transfer,
    static_loop_case,
    subsystem_feedback_case,
)

STUDY = REPO / "docs" / "study"
FIGURES = REPO / "docs" / "figures"
SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"]  # проверенный порядок цветов


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


def median_ms(action, repeats: int = 15) -> float:
    samples = []
    for _ in range(repeats):
        start = time.perf_counter()
        action()
        samples.append(time.perf_counter() - start)
    return float(np.median(samples)) * 1e3


def relative_error(a, b, c, d, transfer) -> float:
    errors = []
    for s in EVALUATION_POINTS:
        expected = transfer(s)
        actual = model_transfer(a, b, c, d, s)
        errors.append(float(np.max(np.abs(actual - expected)) / max(1.0, float(np.max(np.abs(expected))))))
    return max(errors)


def correctness() -> list[dict]:
    rows = []
    for case in all_cases():
        model = compile_model(Diagram.model_validate(case.diagram)).model
        error = relative_error(model.a, model.b, model.c, model.d, case.transfer)
        try:
            probed = probe_state_space(compile_diagram(Diagram.model_validate(case.diagram)))
            legacy = f"{relative_error(probed['A'], probed['B'], probed['C'], probed['D'], case.transfer):.1e}"
        except Exception:  # noqa: BLE001 - the block-by-block approach refuses such diagrams
            legacy = "не собирает"
        rows.append({
            "схема": case.name,
            "порядок n": model.state_dimension,
            "входы × выходы": f"{len(model.sources)} × {len(model.scopes)}",
            "алг. контуры": len(model.algebraic_loops),
            "ошибка метода": f"{error:.1e}",
            "поблочный подход": legacy,
        })
    return rows


def algebraic_loops() -> tuple[list[dict], list[tuple[float, float, float]]]:
    """Положительная обратная связь без динамики: y = k·(u + y), точное решение y = k/(1 − k)."""

    rows, curve = [], []
    for k in (0.5, 0.9, 0.99, 0.999, 0.999999, 1.0 - 1e-12, 1.0, 1.5, 3.0):
        case = static_loop_case(k, ("+", "+"))
        exact = k / (1.0 - k) if k != 1.0 else float("inf")
        formula = (1.0 + abs(k)) / abs(1.0 - k) if k != 1.0 else float("inf")
        row = {"k": f"{k:.12g}", "κ скалярной петли": f"{formula:.3g}"}
        try:
            model = compile_model(Diagram.model_validate(case.diagram)).model
            value = float(model.d[0, 0])
            kappa = model.algebraic_loops[0].condition_number
            error = abs(value - exact) / max(1.0, abs(exact))
            # Чувствительность: насколько относительная погрешность k усиливается в решении петли.
            delta = 1e-9
            shifted = compile_model(Diagram.model_validate(static_loop_case(k * (1 + delta), ("+", "+")).diagram)).model
            amplification = abs(float(shifted.d[0, 0]) - value) / abs(value) / delta
            row.update({"κ (программа)": f"{kappa:.3g}", "y программы": f"{value:.10g}",
                        "y точное": f"{exact:.10g}", "отн. ошибка": f"{error:.1e}",
                        "усиление погрешности k": f"{amplification:.3g}", "итог": "решён"})
            curve.append((kappa, amplification, k))
        except DiagramCompilationError as exc:
            reason = "вырожден" if "не имеет решения" in exc.errors[0] else "плохо обусловлен"
            row.update({"κ (программа)": "—", "y программы": "—", "y точное": f"{exact:.4g}",
                        "отн. ошибка": "—", "усиление погрешности k": "—", "итог": f"отказ: {reason}"})
        rows.append(row)
    return rows, curve


def nested_lag(depth: int) -> dict:
    inner = DiagramBuilder()
    inner.add("in", "SubsystemInput", port="in")
    inner.add("g", "FirstOrderLag", k=2.0, T=0.5, y0=0.0)
    inner.add("out", "SubsystemOutput", port="out")
    inner.link("in", "g")
    inner.link("g", "out")
    for level in range(1, depth):
        outer = DiagramBuilder()
        outer.add("in", "SubsystemInput", port="in")
        outer.subsystem(f"level{level}", inner)
        outer.add("out", "SubsystemOutput", port="out")
        outer.link("in", f"level{level}")
        outer.link(f"level{level}", "out")
        inner = outer
    top = DiagramBuilder()
    top.add("u", "StepInput", amplitude=1.0, t0=0.0)
    top.subsystem("system", inner)
    top.add("e", "Sum", signs=["+", "-"])
    top.add("y", "Scope", label="y")
    top.link("u", "e", into="in1")
    top.link("e", "system")
    top.link("system", "y")
    top.link("system", "e", into="in2")
    return top.build()


def trajectory(diagram: dict, grid: np.ndarray) -> np.ndarray:
    model = compile_model(Diagram.model_validate(diagram)).model
    states = exact_lti_integrate(model.a, model.b, model.source_values, model.x0, grid)
    sources = np.stack([model.source_values(t) for t in grid], axis=1)
    return model.c @ states + model.d @ sources


def hierarchy() -> tuple[list[dict], list[dict]]:
    grid = np.linspace(0.0, 6.0, 601)
    nested = trajectory(subsystem_feedback_case().diagram, grid)
    flat = trajectory(flat_equivalent_of_subsystem_feedback().diagram, grid)
    equivalence = [{
        "сравнение": "контур через подсистему ↔ та же схема без подсистем",
        "макс. расхождение y(t)": f"{float(np.max(np.abs(nested - flat))):.1e}",
    }]
    reference = trajectory(nested_lag(1), grid)
    rows = []
    for depth in (1, 2, 4, 8, 16, 32):
        diagram = nested_lag(depth)
        flatten_ms = median_ms(lambda diagram=diagram: flatten_diagram(Diagram.model_validate(diagram)))
        compile_ms = median_ms(lambda diagram=diagram: compile_model(Diagram.model_validate(diagram)))
        model = compile_model(Diagram.model_validate(diagram)).model
        deviation = float(np.max(np.abs(trajectory(diagram, grid) - reference)))
        rows.append({
            "глубина вложенности": depth,
            "блоков после раскрытия": len(flatten_diagram(Diagram.model_validate(diagram)).blocks),
            "порядок n": model.state_dimension,
            "раскрытие, мс": f"{flatten_ms:.2f}",
            "сборка целиком, мс": f"{compile_ms:.2f}",
            "отличие y(t) от глубины 1": f"{deviation:.1e}",
        })
    return equivalence, rows


def chain(order: int, loops: bool) -> dict:
    """Цепочка звеньев 1-го порядка; при loops=True каждое звено охвачено своей обратной связью."""

    b = DiagramBuilder()
    previous = b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    for index in range(order):
        lag = b.add(f"lag{index}", "FirstOrderLag", k=1.0, T=0.2 + 0.01 * index, y0=0.0)
        if loops:
            b.add(f"e{index}", "Sum", signs=["+", "-"])
            b.link(previous, f"e{index}", into="in1")
            b.link(f"e{index}", lag)
            b.link(lag, f"e{index}", into="in2")
        else:
            b.link(previous, lag)
        previous = lag
    b.add("y", "Scope", label="y")
    b.link(previous, "y")
    return b.build()


def cost() -> list[dict]:
    rows = []
    for order in (2, 8, 32, 64, 128, 256):
        row: dict = {"порядок n": order}
        for loops, title in ((False, "без контуров"), (True, "контур у каждого звена")):
            diagram = Diagram.model_validate(chain(order, loops))
            row[f"блоков ({title})"] = len(diagram.blocks)
            row[f"сборка, мс ({title})"] = f"{median_ms(lambda diagram=diagram: compile_model(diagram)):.2f}"
        rows.append(row)
    return rows


def plot_loop_conditioning(curve: list[tuple[float, float, float]]) -> None:
    figure, axis = plt.subplots(figsize=(7.5, 3.8))
    kappas = [c[0] for c in curve]
    amplification = [c[1] for c in curve]
    axis.loglog(kappas, amplification, "o", color=SERIES[0], ms=8, label="усиление погрешности k (расчёт)")
    ks = np.geomspace(3, 1e8, 50)
    axis.loglog(ks, ks, color=SERIES[1], lw=2, label="верхняя оценка: κ")
    axis.axvline(MAX_LOOP_CONDITION, color="#d62828", lw=1, ls="--", label="порог отказа κ = 1/√ε")
    axis.set_xlabel("обусловленность петли κ")
    axis.set_ylabel("усиление погрешности")
    axis.grid(True, which="both", color="#e5e5e5", lw=0.6)
    axis.legend(frameon=False)
    figure.tight_layout()
    figure.savefig(FIGURES / "nir_assembly_loops.png", dpi=170)
    plt.close(figure)


def plot_cost(rows: list[dict]) -> None:
    figure, axis = plt.subplots(figsize=(7.5, 3.8))
    orders = [row["порядок n"] for row in rows]
    for color, title in zip(SERIES, ("без контуров", "контур у каждого звена"), strict=False):
        axis.loglog(orders, [float(row[f"сборка, мс ({title})"]) for row in rows], "o-", color=color, lw=2,
                    label=title)
    axis.set_xlabel("порядок модели n")
    axis.set_ylabel("время сборки, мс")
    axis.grid(True, which="both", color="#e5e5e5", lw=0.6)
    axis.legend(frameon=False)
    figure.tight_layout()
    figure.savefig(FIGURES / "nir_assembly_cost.png", dpi=170)
    plt.close(figure)


def main() -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)
    correct = correctness()
    loops, curve = algebraic_loops()
    equivalence, depth = hierarchy()
    timing = cost()
    write_csv("nir_assembly_correctness.csv", correct)
    write_csv("nir_assembly_loops.csv", loops)
    write_csv("nir_assembly_equivalence.csv", equivalence)
    write_csv("nir_assembly_depth.csv", depth)
    write_csv("nir_assembly_cost.csv", timing)
    plot_loop_conditioning(curve)
    plot_cost(timing)
    report = f"""# Исследование метода построения модели по структурной схеме

_Сгенерировано `backend/scripts/nir_assembly_study.py` · Python {platform.python_version()} · {platform.platform()}._

## 1. Корректность на эталонных схемах

{table(correct)}

## 2. Алгебраические контуры: y = k·(u + y)

Порог отказа: κ > {MAX_LOOP_CONDITION:.3g}.

{table(loops)}

![Ошибка от обусловленности](figures/nir_assembly_loops.png)

## 3. Иерархия

{table(equivalence)}

{table(depth)}

## 4. Время сборки

{table(timing)}

![Время сборки](figures/nir_assembly_cost.png)
"""
    (REPO / "docs" / "nir_assembly_study.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
