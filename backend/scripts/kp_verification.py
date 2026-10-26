"""Верификация подсистемы построения модели: программа против Simulink и MATLAB/GNU Octave (курсовой проект).

    cd backend && python scripts/kp_verification.py

Для каждой схемы из kp_examples.py:

1. программа строит модель A, B, C, D по схеме (то, что делает вкладка «Матрицы») и моделирует
   переходный процесс тем же путём, что и кнопка «Запустить» (RK45);
2. та же схема собрана из блоков в Simulink (verification/simulink/kp_simulink.m): сигнал его
   осциллографа — docs/study/simulink_*.csv — накладывается на график программы;
3. скрипты verification/<имя>.m независимо строят передаточную функцию сворачиванием структурной
   схемы в MATLAB/Octave (tf, feedback): сравниваются коэффициенты и полюса;
4. дополнительно та же схема собрана в Xcos (verification/xcos, бесплатный аналог Simulink).

Если Octave установлен, .m-скрипты запускаются заново; иначе берутся сохранённые docs/study/octave_*.csv.
Пишет docs/study/kp_verification*.csv, docs/figures/kp_verif_*.png и сводку docs/kp_verification.md.
"""

from __future__ import annotations

import csv
import platform
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.signal import ss2tf

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
from kp_examples import EXAMPLES  # noqa: E402
from matplotlib import pyplot as plt  # noqa: E402

from app.models.api import SimulationRequest  # noqa: E402
from app.models.diagram import Diagram  # noqa: E402
from app.simulation.model import compile_model  # noqa: E402
from app.simulation.service import simulate_request  # noqa: E402

STUDY = REPO / "docs" / "study"
FIGURES = REPO / "docs" / "figures"
VERIFICATION = BACKEND / "verification"
SCRIPTS = {"pi": "pi_loop", "crossed": "crossed", "egsp": "egsp"}


def run_octave() -> bool:
    octave = shutil.which("octave")
    if octave is None:
        return False
    for script in SCRIPTS.values():
        subprocess.run([octave, "--no-gui", "-q", f"{script}.m"], cwd=VERIFICATION, check=True,
                       capture_output=True)
    return True


def read_octave(name: str) -> dict[str, np.ndarray]:
    with (STUDY / f"octave_{name}.csv").open(encoding="utf-8") as stream:
        rows = {row[0]: np.array([float(v) for v in row[1:]]) for row in csv.reader(stream)}
    rows["poles"] = rows["pole_re"] + 1j * rows["pole_im"]
    return rows


def read_curve(prefix: str, name: str) -> tuple[np.ndarray, np.ndarray] | None:
    path = STUDY / f"{prefix}_{name}.csv"
    if not path.exists():
        return None
    data = np.loadtxt(path, delimiter=",")
    return data[:, 0], data[:, 1]


def simulate(diagram: dict, t: np.ndarray) -> np.ndarray:
    response = simulate_request(SimulationRequest.model_validate(
        {"diagram": diagram, "t_start": 0.0, "t_end": float(t[-1]), "t_eval": t.tolist(), "solver": "solve_ivp"}))
    return np.array(next(iter(response.outputs.values())))


def deviation(ours: np.ndarray, theirs: np.ndarray) -> str:
    return f"{float(np.max(np.abs(ours - theirs))) / float(np.max(np.abs(theirs))):.1e}"


def program_transfer(model) -> tuple[np.ndarray, np.ndarray]:
    num, den = ss2tf(model.a, model.b, model.c, model.d)
    num = np.trim_zeros(num[0] / den[0], "f")
    den = den / den[0]
    num[np.abs(num) < 1e-12 * np.max(np.abs(num))] = 0.0
    return np.trim_zeros(num, "f"), den


def match_poles(ours: np.ndarray, theirs: np.ndarray) -> float:
    """Наибольшее относительное расстояние между полюсами после попарного сопоставления."""

    remaining = list(theirs)
    worst = 0.0
    for pole in sorted(ours, key=lambda p: (p.real, p.imag)):
        index = int(np.argmin([abs(pole - other) for other in remaining]))
        worst = max(worst, abs(pole - remaining[index]) / max(1.0, abs(pole)))
        remaining.pop(index)
    return worst


def relative(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.max(np.abs(a - b) / np.maximum(np.abs(b), 1e-300)))


def fmt_poly(coefficients: np.ndarray) -> str:
    return " ".join(f"{c:.6g}" for c in coefficients)


def plot(name: str, title: str, t: np.ndarray, ours: np.ndarray, theirs: np.ndarray, unit: str) -> None:
    figure, axis = plt.subplots(figsize=(7.5, 3.6))
    axis.plot(t, ours, color="black", lw=1.8, label="Control Lab (осциллограф)")
    step = max(1, len(t) // 40)
    axis.plot(t[::step], theirs[::step], "o", color="black", mfc="white", ms=6, lw=0,
              label="Simulink (Scope)")
    axis.set_xlabel("t, с")
    axis.set_ylabel(unit)
    axis.grid(True, color="0.85", lw=0.6)
    axis.legend(frameon=False, loc="lower right")
    figure.tight_layout()
    figure.savefig(FIGURES / f"kp_verif_{name}.png", dpi=170)
    plt.close(figure)


def verify() -> tuple[list[dict], dict[str, dict]]:
    summary, details = [], {}
    for name, (title, build, _t_end) in EXAMPLES.items():
        diagram = build()
        model = compile_model(Diagram.model_validate(diagram)).model
        num, den = program_transfer(model)
        octave = read_octave(name)
        poles = np.linalg.eigvals(model.a)
        row = {
            "схема": title,
            "порядок n": model.state_dimension,
            "блоков": len(compile_model(Diagram.model_validate(diagram)).flat.blocks),
            "знаменатель: макс. отн. расхождение": f"{relative(den, octave['den']):.1e}",
            "числитель: макс. отн. расхождение": f"{relative(num, octave['num']):.1e}",
            "полюса: макс. отн. расхождение": f"{match_poles(poles, octave['poles']):.1e}",
        }
        curves = {}
        for prefix, column in (("simulink", "Simulink"), ("xcos", "Xcos"), ("octave", "Octave lsim")):
            curve = read_curve(prefix, name) if prefix != "octave" else (octave["t"], octave["y"])
            if curve is None:
                row[f"y(t) против {column}"] = "нет данных"
                continue
            t, theirs = curve
            ours = simulate(diagram, t)
            row[f"y(t) против {column}"] = deviation(ours, theirs)
            curves[prefix] = (t, ours, theirs)
        summary.append(row)
        details[name] = {"title": title, "model": model, "num": num, "den": den, "octave": octave, "poles": poles}
        t, ours, theirs = curves.get("simulink", curves["octave"])
        plot(name, title, t, ours, theirs, "Y, м" if name == "egsp" else "y(t)")
    return summary, details


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


def main() -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)
    fresh = run_octave()
    summary, details = verify()
    write_csv("kp_verification.csv", summary)
    coefficients = []
    for name, item in details.items():
        for power, (ours, theirs) in enumerate(zip(item["den"], item["octave"]["den"], strict=True)):
            coefficients.append({"схема": name, "коэффициент": f"a{len(item['den']) - 1 - power}",
                                 "программа": f"{ours:.10g}", "MATLAB/Octave": f"{theirs:.10g}"})
    write_csv("kp_verification_coefficients.csv", coefficients)
    np.savetxt(STUDY / "kp_egsp_A.csv", details["egsp"]["model"].a, delimiter=",", fmt="%.10g")
    sections = []
    for name, item in details.items():
        sections.append(
            f"### {item['title']}\n\nЗнаменатель (программа): `{fmt_poly(item['den'])}`  \n"
            f"Знаменатель (MATLAB/Octave): `{fmt_poly(item['octave']['den'])}`  \n"
            f"Числитель (программа / MATLAB/Octave): `{fmt_poly(item['num'])}` / "
            f"`{fmt_poly(item['octave']['num'])}`\n\n![{item['title']}](figures/kp_verif_{name}.png)\n")
    report = f"""# Верификация подсистемы построения модели

_Сгенерировано `backend/scripts/kp_verification.py` · Python {platform.python_version()} · \
{'Octave запущен' if fresh else 'результаты Octave из docs/study/octave_*.csv'}._

{table(summary)}

{chr(10).join(sections)}"""
    (REPO / "docs" / "kp_verification.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
