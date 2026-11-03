"""Проверка анализа Control Lab по MATLAB (дипломная работа).

    cd backend && python scripts/vkr_verification.py [папка с matlab_vkr_*.csv]

Для каждой схемы из vkr_examples.py программа считает то же, что и пользователь видит в интерфейсе:
полюса и вывод об устойчивости, установившееся значение и показатели качества переходного процесса,
частотную характеристику, запасы устойчивости по разрезу контура, ранги управляемости и
наблюдаемости, а для контура 3-го порядка — корневой годограф по K. Скрипт verification/vkr/
vkr_analysis.m считает те же величины стандартными функциями MATLAB (pole, dcgain, stepinfo, bode,
margin, ctrb, obsv) по передаточным функциям, собранным заново. Здесь сравниваются оба ответа.

Пишет docs/study/vkr_*.csv, рисунки docs/figures/vkr_*.png и сводку docs/vkr_verification.md.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402
from vkr_examples import CASES, SWEEP_K, third_order  # noqa: E402

from app.analysis.loop import analyze_loop  # noqa: E402
from app.analysis.sweep import sweep_poles  # noqa: E402
from app.analysis.system import analyze_model  # noqa: E402
from app.models.api import LoopCut, LoopRequest, SimulationRequest, SweepRequest  # noqa: E402
from app.models.diagram import Diagram  # noqa: E402
from app.simulation.model import compile_model  # noqa: E402
from app.simulation.service import simulate_request  # noqa: E402

STUDY = REPO / "docs" / "study"
FIGURES = REPO / "docs" / "figures"
SAMPLES = 20001   # точек переходного процесса: шаг t_end/20000 задаёт точность времён качества

# Вывод об устойчивости, который следует из теории (обоснование — в vkr_examples.py).
EXPECTED_STABILITY = {"pi": "stable", "crossed": "stable", "egsp": "stable", "k2": "stable", "k10": "unstable",
                      "undamped": "marginal", "double": "unstable", "cancel": "stable"}
STABILITY_RU = {"stable": "устойчива", "unstable": "неустойчива", "marginal": "на границе"}


def read_matlab(folder: Path, name: str) -> dict[str, np.ndarray]:
    with (folder / f"matlab_vkr_{name}.csv").open(encoding="utf-8") as stream:
        return {row[0]: np.array([float(v) for v in row[1:]]) for row in csv.reader(stream)}


def match_poles(ours: np.ndarray, theirs: np.ndarray) -> float:
    """Наибольшее расстояние между полюсами после попарного сопоставления, отнесённое к max(1, |p|)."""

    remaining = list(theirs)
    worst = 0.0
    for pole in sorted(ours, key=lambda p: (p.real, p.imag)):
        index = int(np.argmin([abs(pole - other) for other in remaining]))
        worst = max(worst, abs(pole - remaining[index]) / max(1.0, abs(pole)))
        remaining.pop(index)
    return worst


def rel(ours: float, theirs: float) -> float:
    return abs(ours - theirs) / max(abs(theirs), 1e-300)


def wrap180(angle: float) -> float:
    """Угол в диапазон (−180°, 180°]: MATLAB и Octave могут вернуть запас по фазе со сдвигом на 360°."""

    return (angle + 180.0) % 360.0 - 180.0


def frequency_response(model, w: np.ndarray) -> np.ndarray:
    """W(jω) = C (jωI − A)⁻¹ B + D первого канала «вход → осциллограф» — так считает вкладка «Частотные»."""

    a, b, c, d = model.a, model.b[:, 0], model.c[0, :], model.d[0, 0]
    n = a.shape[0]
    return np.array([c @ np.linalg.solve(1j * x * np.eye(n) - a, b) + d for x in w])


def quality(diagram: dict, t_end: float) -> dict:
    t = np.linspace(0.0, t_end, SAMPLES)
    response = simulate_request(SimulationRequest.model_validate(
        {"diagram": diagram, "t_start": 0.0, "t_end": t_end, "t_eval": t.tolist(), "solver": "solve_ivp"}))
    return next(iter(response.quality_metrics.values())), t, np.array(next(iter(response.outputs.values())))


def loop_margins(diagram: dict, cut: tuple[str, str, str, str]):
    request = LoopRequest(diagram=Diagram.model_validate(diagram), cut=LoopCut(
        from_block=cut[0], from_port=cut[1], to_block=cut[2], to_port=cut[3]))
    return analyze_loop(request)


def fmt(value: float | None, digits: int = 4) -> str:
    return "—" if value is None or (isinstance(value, float) and np.isnan(value)) else f"{value:.{digits}g}"


def verify(folder: Path) -> dict[str, list[dict]]:
    tables: dict[str, list[dict]] = {"stability": [], "quality": [], "frequency": [], "margins": [], "ranks": []}
    curves = {}
    for name, (title, build, cut, t_end) in CASES.items():
        diagram = build()
        model = compile_model(Diagram.model_validate(diagram)).model
        analysis = analyze_model(model)
        matlab = read_matlab(folder, name)
        poles = np.linalg.eigvals(model.a)
        amplitude = model.sources[0].amplitude

        # полюса и вывод об устойчивости
        tables["stability"].append({
            "схема": title, "порядок": model.state_dimension,
            "полюса: расхождение с MATLAB": f"{match_poles(poles, matlab['pole_re'] + 1j * matlab['pole_im']):.1e}",
            "вывод программы": STABILITY_RU[analysis["stability"]],
            "ожидается по теории": STABILITY_RU[EXPECTED_STABILITY[name]],
            "наибольшая Re полюса": f"{float(np.max(poles.real)):.4g}",
        })

        # установившееся значение и показатели качества (только устойчивые схемы)
        if "overshoot" in matlab:
            metrics, t, y = quality(diagram, t_end)
            tables["quality"].append({
                "схема": title,
                "y∞ / U: программа": fmt(metrics["target_value"] / amplitude, 8),
                "dcgain MATLAB": fmt(float(matlab["dcgain"][0]), 8),
                "σ, %: программа": fmt(metrics["overshoot_percent"]),
                "σ, %: MATLAB": fmt(float(matlab["overshoot"][0])),
                "tн, с: программа": fmt(metrics["rise_time"]), "tн, с: MATLAB": fmt(float(matlab["rise"][0])),
                "tр, с: программа": fmt(metrics["settling_time"]), "tр, с: MATLAB": fmt(float(matlab["settling"][0])),
                "шаг сетки, с": fmt(t_end / (SAMPLES - 1), 2),
            })

        # частотная характеристика на сетке MATLAB
        w = matlab["w"]
        response = frequency_response(model, w)
        mag = 20.0 * np.log10(np.abs(response))
        phase = np.degrees(np.unwrap(np.angle(response)))
        phase_shift = 360.0 * np.round((matlab["phase_deg"][0] - phase[0]) / 360.0)   # ветвь фазы MATLAB
        tables["frequency"].append({
            "схема": title, "точек": len(w),
            "ЛАЧХ: макс. |Δ|, дБ": f"{float(np.max(np.abs(mag - matlab['mag_db']))):.1e}",
            "ЛФЧХ: макс. |Δ|, °": f"{float(np.max(np.abs(phase + phase_shift - matlab['phase_deg']))):.1e}",
        })
        curves[name] = (title, w, mag, phase + phase_shift, matlab["mag_db"], matlab["phase_deg"])

        # запасы устойчивости по разрезу контура
        if cut is not None:
            loop = loop_margins(diagram, cut)
            gm, pm, wcg, wcp = (float(v) for v in matlab["margin"])
            tables["margins"].append({
                "схема": title,
                "Lзап (разы): программа": fmt(loop.gain_margin, 6), "Lзап: MATLAB": fmt(gm, 6),
                "ωπ: программа": fmt(loop.phase_crossover, 6), "ωπ: MATLAB": fmt(wcg, 6),
                "φзап, °: программа": fmt(loop.phase_margin, 6), "φзап: MATLAB": fmt(wrap180(pm), 6),
                "ωср: программа": fmt(loop.gain_crossover, 6), "ωср: MATLAB": fmt(wcp, 6),
                # критерий Найквиста: Z = N + P должно совпасть с числом правых полюсов замкнутой системы
                "Найквист Z = N + P": f"{loop.encirclements + loop.open_loop_unstable_poles} = "
                                      f"{loop.encirclements} + {loop.open_loop_unstable_poles}",
                "правых полюсов замкнутой": loop.closed_loop_unstable_poles,
                "определители Гурвица": ", ".join(f"{v:.4g}" for v in loop.hurwitz),
            })

        # ранги управляемости и наблюдаемости (тест PBH в программе, ctrb/obsv в MATLAB)
        tables["ranks"].append({
            "схема": title, "n": model.state_dimension, "n MATLAB": int(matlab["order"][0]),
            "управляемость: программа": analysis["controllability"]["rank"],
            "MATLAB": int(matlab["ctrb_rank"][0]),
            "наблюдаемость: программа": analysis["observability"]["rank"],
            "MATLAB ": int(matlab["obsv_rank"][0]),
        })

    tables["sweep"] = sweep(folder)
    plot_bode(curves)
    plot_steps()
    return tables


def sweep(folder: Path) -> list[dict]:
    rows = np.loadtxt(folder / "matlab_vkr_sweep.csv", delimiter=",", ndmin=2)
    response = sweep_poles(SweepRequest(diagram=Diagram.model_validate(third_order(1.0)), block_id="k",
                                        parameter="k", values=SWEEP_K))
    table, ours_all, theirs_all = [], [], []
    for point, row in zip(response.points, rows, strict=True):
        ours = np.array([p["real"] + 1j * p["imag"] for p in point.poles])
        theirs = row[1:4] + 1j * row[4:7]
        ours_all.append(ours)
        theirs_all.append(theirs)
        table.append({"K": fmt(point.value), "полюса программы": ", ".join(
            f"{p.real:.4f}{p.imag:+.4f}j" for p in sorted(ours, key=lambda p: (p.real, p.imag))),
            "расхождение с MATLAB": f"{match_poles(ours, theirs):.1e}",
            "вывод программы": STABILITY_RU[point.stability]})
    plot_locus(ours_all, theirs_all)
    return table


def plot_bode(curves: dict) -> None:
    for name in ("pi", "egsp"):
        title, w, mag, phase, mag_m, phase_m = curves[name]
        figure, (top, bottom) = plt.subplots(2, 1, figsize=(7.5, 5.6), sharex=True)
        for axis, ours, theirs, label in ((top, mag, mag_m, "L, дБ"), (bottom, phase, phase_m, "φ, °")):
            axis.semilogx(w, ours, color="black", lw=1.8, label="Control Lab")
            axis.semilogx(w, theirs, "o", color="black", mfc="white", ms=5, label="MATLAB (bode)")
            axis.set_ylabel(label)
            axis.grid(True, which="both", color="0.85", lw=0.6)
        top.legend(frameon=False)
        bottom.set_xlabel("ω, рад/с")
        figure.tight_layout()
        figure.savefig(FIGURES / f"vkr_bode_{name}.png", dpi=170)
        plt.close(figure)


def plot_locus(ours: list[np.ndarray], theirs: list[np.ndarray]) -> None:
    figure, axis = plt.subplots(figsize=(6.5, 4.8))
    dense = sweep_poles(SweepRequest(diagram=Diagram.model_validate(third_order(1.0)), block_id="k", parameter="k",
                                     values=list(np.linspace(0.05, 12.0, 160))))
    branch = np.array([[p["real"] + 1j * p["imag"] for p in sorted(
        point.poles, key=lambda p: (p["imag"], p["real"]))] for point in dense.points])
    for k in range(branch.shape[1]):
        axis.plot(branch[:, k].real, branch[:, k].imag, color="black", lw=1.2)
    for value, points in zip(SWEEP_K, theirs, strict=True):
        axis.plot(points.real, points.imag, "o", color="black", mfc="white", ms=6)
        if value in (2.0, 6.0, 10.0):
            top = points[np.argmax(points.imag)]
            axis.annotate(f"K = {value:g}", (top.real, top.imag), textcoords="offset points", xytext=(6, 4))
    axis.axvline(0.0, color="0.4", lw=0.8)
    axis.axhline(0.0, color="0.85", lw=0.6)
    axis.set_xlabel("Re s")
    axis.set_ylabel("Im s")
    axis.set_xlim(-4.0, 1.0)
    axis.grid(True, color="0.9", lw=0.6)
    figure.tight_layout()
    figure.savefig(FIGURES / "vkr_locus.png", dpi=170)
    plt.close(figure)


def plot_steps() -> None:
    figure, axes = plt.subplots(1, 2, figsize=(9.0, 3.4))
    for axis, name in zip(axes, ("k2", "k10"), strict=True):
        title, build, _, t_end = CASES[name]
        _, t, y = quality(build(), t_end)
        axis.plot(t, y, color="black", lw=1.5)
        axis.set_title(title, fontsize=10)
        axis.set_xlabel("t, с")
        axis.grid(True, color="0.88", lw=0.6)
    axes[0].set_ylabel("y(t)")
    figure.tight_layout()
    figure.savefig(FIGURES / "vkr_steps_k.png", dpi=170)
    plt.close(figure)


def write_csv(name: str, rows: list[dict]) -> None:
    with (STUDY / name).open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def markdown(rows: list[dict]) -> str:
    columns = list(rows[0])
    lines = ["| " + " | ".join(columns) + " |", "|" + "---|" * len(columns)]
    return "\n".join(lines + ["| " + " | ".join(str(r[c]) for c in columns) + " |" for r in rows])


def main() -> None:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else STUDY
    FIGURES.mkdir(parents=True, exist_ok=True)
    tables = verify(folder)
    for key, rows in tables.items():
        if rows:
            write_csv(f"vkr_{key}.csv", rows)
    report = "# Проверка анализа по MATLAB\n\n_Сгенерировано `backend/scripts/vkr_verification.py`._\n\n" + "\n\n".join(
        f"## {key}\n\n{markdown(rows)}" for key, rows in tables.items() if rows)
    (REPO / "docs" / "vkr_verification.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
