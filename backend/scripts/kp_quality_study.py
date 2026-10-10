"""Проверка модуля показателей качества переходного процесса (исследование для КП).

    cd backend && python scripts/kp_quality_study.py

Схемы прогоняются через тот же путь, что и запрос /simulate (simulate_request), и
показатели качества из ответа сравниваются с известными формулами:

* звено 1-го порядка K/(Ts+1): t_н = T·ln 9, t_рег(2 %) = T·ln 50, перерегулирования нет — точные значения;
* колебательное звено: σ = 100·exp(−πζ/√(1−ζ²)) % — точная формула; t_рег ≈ 4/(ζω₀) — инженерная оценка.

Пишет docs/study/kp_*.csv, docs/figures/kp_*.png и docs/kp_quality_study.md.
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

from app.models.api import SimulationRequest  # noqa: E402
from app.simulation.service import simulate_request  # noqa: E402
from app.tests.structural_cases import DiagramBuilder  # noqa: E402

STUDY = REPO / "docs" / "study"
FIGURES = REPO / "docs" / "figures"
SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"]  # проверенный порядок цветов
WN = 2.0


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


def run(block_type: str, t_end: float, **parameters: float) -> tuple[np.ndarray, np.ndarray, dict]:
    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    b.add("plant", block_type, **parameters)
    b.add("scope", "Scope", label="y")
    b.link("u", "plant")
    b.link("plant", "scope")
    request = SimulationRequest.model_validate({"diagram": b.build(), "t_end": t_end, "dt": 0.001})
    response = simulate_request(request).model_dump()
    return np.asarray(response["time"]), np.asarray(response["outputs"]["y"]), response["quality_metrics"]["y"]


def first_order() -> list[dict]:
    rows = []
    for t_const in (0.5, 1.0, 2.0, 5.0):
        _, _, metrics = run("FirstOrderLag", 12.0 * t_const, k=2.0, T=t_const, y0=0.0)
        rows.append({
            "T, с": t_const,
            "y∞ (программа)": f"{metrics['target_value']:.4f}",
            "y∞ = K": "2.0000",
            "t_н (программа), с": f"{metrics['rise_time']:.3f}",
            "t_н = T·ln 9, с": f"{t_const * math.log(9):.3f}",
            "t_рег (программа), с": f"{metrics['settling_time']:.3f}",
            "t_рег = T·ln 50, с": f"{t_const * math.log(50):.3f}",
            "σ, %": f"{metrics['overshoot_percent']:.2f}",
        })
    return rows


def oscillator() -> tuple[list[dict], dict[float, tuple[np.ndarray, np.ndarray, dict]]]:
    rows, traces = [], {}
    for zeta in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        t_end = max(10.0, 14.0 / (zeta * WN))
        time, y, metrics = run("SecondOrderOscillator", t_end, k=1.0, wn=WN, zeta=zeta, y0=0.0, v0=0.0)
        traces[zeta] = (time, y, metrics)
        sigma = 100.0 * math.exp(-math.pi * zeta / math.sqrt(1.0 - zeta**2))
        estimate = 4.0 / (zeta * WN)
        rows.append({
            "ζ": zeta,
            "σ (программа), %": f"{metrics['overshoot_percent']:.2f}",
            "σ (формула), %": f"{sigma:.2f}",
            "t_рег (программа), с": f"{metrics['settling_time']:.2f}",
            "t_рег ≈ 4/(ζω₀), с": f"{estimate:.2f}",
            "t_н (программа), с": f"{metrics['rise_time']:.3f}",
        })
    return rows, traces


def plot_overshoot(rows: list[dict]) -> None:
    zetas = np.linspace(0.05, 0.95, 200)
    figure, axis = plt.subplots(figsize=(7.5, 3.8))
    axis.plot(zetas, 100.0 * np.exp(-np.pi * zetas / np.sqrt(1.0 - zetas**2)), color=SERIES[0], lw=2, label="формула")
    computed = [float(r["σ (программа), %"]) for r in rows]
    axis.plot([r["ζ"] for r in rows], computed, "o", color=SERIES[1], ms=8, label="программа")
    axis.set_xlabel("коэффициент затухания ζ")
    axis.set_ylabel("перерегулирование σ, %")
    axis.grid(True, color="#e5e5e5", lw=0.6)
    axis.legend(frameon=False)
    figure.tight_layout()
    figure.savefig(FIGURES / "kp_overshoot_vs_zeta.png", dpi=170)
    plt.close(figure)


def plot_family(traces: dict[float, tuple[np.ndarray, np.ndarray, dict]]) -> None:
    figure, axis = plt.subplots(figsize=(7.5, 3.8))
    for color, zeta in zip(SERIES, (0.1, 0.3, 0.5, 0.7), strict=True):
        time, y, _ = traces[zeta]
        mask = time <= 10.0
        axis.plot(time[mask], y[mask], color=color, lw=2, label=f"ζ = {zeta:g}".replace(".", ","))
    axis.axhline(1.0, color="#6b6b6b", lw=1, ls="--")
    axis.set_xlabel("время t, с")
    axis.set_ylabel("выход y(t)")
    axis.grid(True, color="#e5e5e5", lw=0.6)
    axis.legend(frameon=False, ncol=2)
    figure.tight_layout()
    figure.savefig(FIGURES / "kp_step_family.png", dpi=170)
    plt.close(figure)


def plot_annotated(traces: dict[float, tuple[np.ndarray, np.ndarray, dict]]) -> None:
    time, y, metrics = traces[0.3]
    mask = time <= 8.0
    y_inf = metrics["target_value"]
    band = metrics["settling_band_percent"] / 100.0 * y_inf
    figure, axis = plt.subplots(figsize=(7.5, 4.0))
    axis.fill_between(time[mask], y_inf - band, y_inf + band, color="#e8e8e8", label="зона ±2 %")
    axis.plot(time[mask], y[mask], color=SERIES[0], lw=2, label="y(t), ζ = 0,3")
    axis.axhline(y_inf, color="#6b6b6b", lw=1, ls="--")
    peak = int(np.argmax(y))
    axis.annotate(f"σ = {metrics['overshoot_percent']:.1f} %".replace(".", ","), (time[peak], y[peak]),
                  xytext=(time[peak] + 0.7, y[peak] - 0.04), arrowprops={"arrowstyle": "->", "color": "#333"})
    axis.axvline(metrics["settling_time"], color=SERIES[1], lw=1.5, ls=":")
    settling = f"t_рег = {metrics['settling_time']:.2f} с".replace(".", ",")
    axis.text(metrics["settling_time"] + 0.1, 0.2, settling, color="#333")
    axis.text(7.0, y_inf + 0.05, "y∞", color="#333")
    axis.set_ylim(-0.05, 1.55)
    axis.set_xlabel("время t, с")
    axis.set_ylabel("выход y(t)")
    axis.grid(True, color="#e5e5e5", lw=0.6)
    axis.legend(frameon=False, loc="lower right")
    figure.tight_layout()
    figure.savefig(FIGURES / "kp_metrics_annotated.png", dpi=170)
    plt.close(figure)


def main() -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)
    lag = first_order()
    osc, traces = oscillator()
    write_csv("kp_first_order.csv", lag)
    write_csv("kp_oscillator.csv", osc)
    plot_overshoot(osc)
    plot_family(traces)
    plot_annotated(traces)
    report = f"""# Проверка модуля показателей качества

_Сгенерировано `backend/scripts/kp_quality_study.py` · Python {platform.python_version()} · {platform.platform()}._
Расчёт идёт через `simulate_request` — тот же путь, что и запрос `/simulate`; шаг сетки 0,001 с.

## 1. Звено 1-го порядка K/(Ts + 1), K = 2

{table(lag)}

## 2. Колебательное звено, ω₀ = {WN:g} рад/с

{table(osc)}

![Перерегулирование от ζ](figures/kp_overshoot_vs_zeta.png)

![Переходные характеристики](figures/kp_step_family.png)

![Показатели на графике](figures/kp_metrics_annotated.png)
"""
    (REPO / "docs" / "kp_quality_study.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
