"""Проверка модуля запасов устойчивости (исследование для курсового проекта).

    cd backend && python scripts/kp_margins_study.py

Каждый результат модуля app/analysis/loop.py сверяется с независимым расчётом:
1. контур K/(s(s+1)(s+2)): запас по амплитуде 6/K и частота ω_π = √2 — аналитически,
   запас по фазе — по уравнению |L(jω)| = 1, решённому отдельно;
2. контур K/(s(s+1)): запас по фазе по формуле, запас по амплитуде бесконечен;
3. неустойчивый объект K/(s−1): критерий Найквиста с P = 1, устойчивость при K > 1;
4. разрез в разных связях одного контура даёт одинаковые запасы;
5. если увеличить усиление контура в GM раз, полюс замкнутой системы выходит на мнимую ось.
Устойчивость дополнительно проверяется критерием Гурвица и полюсами замкнутой системы.
Пишет docs/study/kp_margins_*.csv, docs/figures/kp_margins_*.png и docs/kp_margins_study.md.
"""

from __future__ import annotations

import csv
import math
import platform
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402

from app.analysis.loop import LoopRealization, analyze_loop  # noqa: E402
from app.models.api import LoopCut, LoopRequest  # noqa: E402
from app.models.diagram import Diagram  # noqa: E402
from app.tests.structural_cases import DiagramBuilder  # noqa: E402

STUDY = REPO / "docs" / "study"
FIGURES = REPO / "docs" / "figures"
# Чёрно-белая печать: серии различаются типом линии и маркером, а не цветом.
INK = ["black", "black", "0.45", "0.45"]
LINES = ["-", "--", "-.", ":"]
MARKS = ["o", "s", "^", "D"]
FEEDBACK = LoopCut(from_block="w", from_port="out", to_block="e", to_port="in2")


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


def loop_diagram(k: float, numerator: list[float], denominator: list[float]) -> Diagram:
    """Ступенька → сумматор(+,−) → усилитель K → W(s) → осциллограф, обратная связь с выхода W."""

    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    b.add("e", "Sum", signs=["+", "-"])
    b.add("k", "Gain", k=k)
    b.add("w", "TransferFunction", numerator=numerator, denominator=denominator)
    b.add("y", "Scope", label="y")
    b.link("u", "e", into="in1")
    b.link("e", "k")
    b.link("k", "w")
    b.link("w", "y")
    b.link("w", "e", into="in2")
    return Diagram.model_validate(b.build())


def run(diagram: Diagram, cut: LoopCut = FEEDBACK):
    return analyze_loop(LoopRequest(diagram=diagram, cut=cut))


def fmt(value, digits=6):
    return "∞" if value is None else f"{value:.{digits}f}"


def third_order() -> list[dict]:
    rows = []
    for k in (0.5, 1.0, 2.0, 4.0, 5.0, 6.5, 8.0):
        r = run(loop_diagram(k, [1.0], [1.0, 3.0, 2.0, 0.0]))
        # |L(jω)| = 1  ⇔  ω²(ω² + 1)(ω² + 4) = K²: корень многочлена от ω², найденный отдельно.
        roots = np.roots([1.0, 5.0, 4.0, -k * k])
        w2 = max(root.real for root in roots if abs(root.imag) < 1e-9 and root.real > 0)
        wc = math.sqrt(w2)
        pm = 90.0 - math.degrees(math.atan(wc)) - math.degrees(math.atan(wc / 2.0))
        rows.append({
            "K": k,
            "GM (программа)": fmt(r.gain_margin),
            "GM = 6/K": fmt(6.0 / k),
            "ω_π (программа)": fmt(r.phase_crossover),
            "ω_π = √2": fmt(math.sqrt(2.0)),
            "PM (программа), °": fmt(r.phase_margin, 3),
            "PM (формула), °": fmt(pm, 3),
            "Найквист": "устойчива" if r.nyquist_stable else "неустойчива",
            "Гурвиц": "устойчива" if r.hurwitz_stable else "неустойчива",
            "теория (K < 6)": "устойчива" if k < 6 else "неустойчива",
        })
    return rows


def second_order() -> list[dict]:
    rows = []
    for k in (0.5, 1.0, 4.0, 10.0):
        r = run(loop_diagram(k, [1.0], [1.0, 1.0, 0.0]))
        wc = math.sqrt((-1.0 + math.sqrt(1.0 + 4.0 * k * k)) / 2.0)
        rows.append({
            "K": k,
            "ω_с (программа)": fmt(r.gain_crossover, 5),
            "ω_с (формула)": fmt(wc, 5),
            "PM (программа), °": fmt(r.phase_margin, 3),
            "PM = 90° − arctg ω_с": fmt(90.0 - math.degrees(math.atan(wc)), 3),
            "GM": fmt(r.gain_margin, 3),
        })
    return rows


def unstable_plant() -> list[dict]:
    rows = []
    for k in (0.5, 0.9, 1.5, 3.0, 10.0):
        r = run(loop_diagram(k, [1.0], [1.0, -1.0]))
        rows.append({
            "K": k,
            "P": r.open_loop_unstable_poles,
            "N": r.encirclements,
            "Z = N + P": r.encirclements + r.open_loop_unstable_poles,
            "неуст. полюсов замкнутой": r.closed_loop_unstable_poles,
            "Найквист": "устойчива" if r.nyquist_stable else "неустойчива",
            "теория (K > 1)": "устойчива" if k > 1 else "неустойчива",
            "GM (нижний)": fmt(r.gain_margin, 4),
            "1/K": fmt(1.0 / k, 4),
        })
    return rows


def cut_independence() -> list[dict]:
    diagram = loop_diagram(2.0, [1.0], [1.0, 3.0, 2.0, 0.0])
    rows = []
    for cut in analyze_loop(LoopRequest(diagram=diagram)).candidates:
        r = run(diagram, cut)
        rows.append({
            "разрез": f"{cut.from_block}.{cut.from_port} → {cut.to_block}.{cut.to_port}",
            "GM": fmt(r.gain_margin, 9),
            "PM, °": fmt(r.phase_margin, 6),
            "ω_с": fmt(r.gain_crossover, 6),
            "Найквист": "устойчива" if r.nyquist_stable else "неустойчива",
        })
    return rows


def boundary_check() -> list[dict]:
    rows = []
    for name, diagram in (
        ("K/(s(s+1)(s+2)), K = 2", loop_diagram(2.0, [1.0], [1.0, 3.0, 2.0, 0.0])),
        ("K/(s(s+1)(s+2)), K = 4", loop_diagram(4.0, [1.0], [1.0, 3.0, 2.0, 0.0])),
        ("K/((s+1)³), K = 2", loop_diagram(2.0, [1.0], [1.0, 3.0, 3.0, 1.0])),
        ("K/(s−1), K = 3", loop_diagram(3.0, [1.0], [1.0, -1.0])),
    ):
        r = run(diagram)
        realization = LoopRealization(diagram, FEEDBACK)
        poles = np.linalg.eigvals(realization.closed_matrix(r.gain_margin))
        rightmost = max(poles, key=lambda p: p.real)
        rows.append({
            "контур": name,
            "GM": fmt(r.gain_margin, 6),
            "max Re λ при K·GM": f"{rightmost.real:.1e}",
            "частота колебаний при K·GM": fmt(abs(rightmost.imag), 6),
            "ω_π": fmt(r.phase_crossover, 6),
        })
    return rows


def plot_nyquist() -> None:
    figure, axes = plt.subplots(1, 2, figsize=(11, 4.6))
    for axis, k, title in ((axes[0], 2.0, "K = 2: устойчива"), (axes[1], 6.5, "K = 6,5: неустойчива")):
        r = run(loop_diagram(k, [1.0], [1.0, 3.0, 2.0, 0.0]))
        re, im = np.array(r.nyquist_real), np.array(r.nyquist_imag)
        keep = (np.abs(re) < 6) & (np.abs(im) < 6)
        axis.plot(re[keep], im[keep], color="black", lw=1.8, label="ω > 0")
        axis.plot(re[keep], -im[keep], color="black", lw=1, ls=":", label="ω < 0")
        axis.plot([-1], [0], "x", color="black", ms=10, mew=2, label="точка −1")
        if r.gain_margin:
            axis.plot([-1 / r.gain_margin], [0], "o", color="black", mfc="white", ms=7, label="пересечение оси, −1/GM")
        axis.axhline(0, color="0.5", lw=0.8)
        axis.axvline(0, color="0.5", lw=0.8)
        axis.set_xlim(-3, 1)
        axis.set_ylim(-2.5, 2.5)
        axis.set_title(title, fontsize=11)
        axis.set_xlabel("Re L(jω)")
        axis.set_ylabel("Im L(jω)")
        axis.grid(True, color="0.85", lw=0.6)
        axis.legend(frameon=False, fontsize=9, loc="lower left")
    figure.tight_layout()
    figure.savefig(FIGURES / "kp_margins_nyquist.png", dpi=170)
    plt.close(figure)


def plot_bode() -> None:
    r = run(loop_diagram(2.0, [1.0], [1.0, 3.0, 2.0, 0.0]))
    w = np.array(r.frequency)
    figure, (top, bottom) = plt.subplots(2, 1, figsize=(8, 5.6), sharex=True)
    top.semilogx(w, r.magnitude_db, color="black", lw=1.8)
    top.axhline(0, color="0.5", lw=0.8, ls="--")
    top.axvline(r.gain_crossover, color="0.4", lw=1, ls=":")
    gm_db = r.gain_margin_db
    top.annotate("", (r.phase_crossover, -gm_db), (r.phase_crossover, 0),
                 arrowprops={"arrowstyle": "<->", "color": "black", "lw": 1.3})
    top.text(r.phase_crossover * 1.5, 12, f"GM = {gm_db:.2f} дБ".replace(".", ","), color="black")
    top.set_ylabel("L(ω), дБ")
    top.grid(True, which="both", color="0.85", lw=0.6)
    bottom.semilogx(w, r.phase_deg, color="black", lw=1.8)
    bottom.axhline(-180, color="0.5", lw=0.8, ls="--")
    bottom.axvline(r.phase_crossover, color="0.4", lw=1, ls=":")
    phase_at_wc = -180 + r.phase_margin
    bottom.annotate("", (r.gain_crossover, phase_at_wc), (r.gain_crossover, -180),
                    arrowprops={"arrowstyle": "<->", "color": "black", "lw": 1.3})
    bottom.text(r.gain_crossover * 0.08, -170, f"PM = {r.phase_margin:.1f}°".replace(".", ","), color="black")
    bottom.set_ylabel("φ(ω), °")
    bottom.set_xlabel("ω, рад/с")
    bottom.grid(True, which="both", color="0.85", lw=0.6)
    figure.tight_layout()
    figure.savefig(FIGURES / "kp_margins_bode.png", dpi=170)
    plt.close(figure)


def plot_gain_margin(rows: list[dict]) -> None:
    ks = np.linspace(0.4, 8.5, 200)
    figure, axis = plt.subplots(figsize=(7.5, 3.8))
    axis.plot(ks, 6 / ks, color="black", lw=1.6, label="формула GM = 6/K")
    axis.plot([r["K"] for r in rows], [float(r["GM (программа)"]) for r in rows], "o", color="black", mfc="white", ms=8,
              label="программа")
    axis.axhline(1, color="black", lw=1, ls="--", label="граница устойчивости, GM = 1")
    axis.set_xlabel("коэффициент усиления K")
    axis.set_ylabel("запас по амплитуде GM, раз")
    axis.set_ylim(0, 8)
    axis.grid(True, color="0.85", lw=0.6)
    axis.legend(frameon=False)
    figure.tight_layout()
    figure.savefig(FIGURES / "kp_margins_gain.png", dpi=170)
    plt.close(figure)


def main() -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)
    third, second, unstable = third_order(), second_order(), unstable_plant()
    cuts, boundary = cut_independence(), boundary_check()
    write_csv("kp_margins_third_order.csv", third)
    write_csv("kp_margins_second_order.csv", second)
    write_csv("kp_margins_unstable_plant.csv", unstable)
    write_csv("kp_margins_cuts.csv", cuts)
    write_csv("kp_margins_boundary.csv", boundary)
    plot_nyquist()
    plot_bode()
    plot_gain_margin(third)
    report = f"""# Проверка модуля запасов устойчивости

_Сгенерировано `backend/scripts/kp_margins_study.py` · Python {platform.python_version()} · {platform.platform()}._

## 1. Контур K/(s(s+1)(s+2))

{table(third)}

![Запас по амплитуде](figures/kp_margins_gain.png)

![Годографы Найквиста](figures/kp_margins_nyquist.png)

![ЛАЧХ и ЛФЧХ с запасами](figures/kp_margins_bode.png)

## 2. Контур K/(s(s+1))

{table(second)}

## 3. Неустойчивый объект K/(s−1)

{table(unstable)}

## 4. Разрез в разных связях одного контура (K = 2)

{table(cuts)}

## 5. Усиление контура в GM раз выводит полюс на мнимую ось

{table(boundary)}
"""
    (REPO / "docs" / "kp_margins_study.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
