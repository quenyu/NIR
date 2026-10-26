"""Схемы примеров курсового проекта: контур с ПИ-регулятором, перекрёстные обратные связи и ЭГСП 8-го порядка.

Схемы собираются из блоков системы моделирования так же, как пользователь собирает их на холсте.
Параметры ЭГСП — из задания к практическим занятиям 01–02 «Моделирование и анализ ЭГСП»
(E = 10⁷ Па), структурная схема — рис. 1 занятия 02.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.tests.structural_cases import DiagramBuilder  # noqa: E402

# Физические параметры ЭГСП (занятие 01) в обозначениях занятия 02.
EGSP = {
    "k1": 50.0,             # k_ус, коэффициент усилителя
    "a1": 0.4, "a0": 80.0,  # L, R_a — обмотка ЭМП
    "b0": 1.0,              # k_Mi
    "c2": 0.3e-6, "c1": 7e-5, "c0": 0.1,   # J_я, h_я, k_Mφ — якорь ЭМП
    "d0": 1.0,
    "k4": 10.0,             # k_мос, механическая обратная связь
    "k2": 1e-3,             # k_Qφ
    "k3": 1.0 / 1e-6,       # 1 / k_Qypy
    "g1": 0.785e-4,         # F_з, площадь торца золотника
    "e2": 0.005, "e1": 0.25, "e0": 2.0,    # m_з, h_з, 2·C_гд — золотник
    "f0": 0.785e-4,         # F_з
    "k5": 4.3,              # k_Qx
    "h1": 647e-6 / (2 * 1e7), "h0": 1e-10,  # V/(2E), k_Qp — полости гидроцилиндра
    "l0": 1.0,
    "q1": 1.99e-3,          # F, площадь поршня
    "n2": 10.0, "n1": 10.0, "n0": 0.0,     # M, h, C — поршень с нагрузкой
    "r0": 1.99e-3,          # F
    "k6": 0.1,              # k_ос, датчик обратной связи
    "U": 0.01,              # ступенька 0,01 В
    "t_end": 0.7,
}


def _mass_with_velocity(force_gain: float, mass: float, damping: float, stiffness: float) -> DiagramBuilder:
    """m·ẍ + h·ẋ + c·x = F·u из сумматора, усилителей и двух интеграторов; наружу выходят x и ẋ."""

    inner = DiagramBuilder()
    inner.add("in", "SubsystemInput", port="in")
    inner.add("force", "Gain", k=force_gain)
    inner.add("balance", "Sum", signs=["+", "-", "-"])
    inner.add("per_mass", "Gain", k=1.0 / mass)
    inner.add("velocity", "Integrator", k=1.0, y0=0.0)
    inner.add("position", "Integrator", k=1.0, y0=0.0)
    inner.add("friction", "Gain", k=damping)
    inner.add("spring", "Gain", k=stiffness)
    inner.add("x", "SubsystemOutput", port="x")
    inner.add("v", "SubsystemOutput", port="v")
    inner.link("in", "force")
    inner.link("force", "balance", into="in1")
    inner.link("friction", "balance", into="in2")
    inner.link("spring", "balance", into="in3")
    inner.link("balance", "per_mass")
    inner.link("per_mass", "velocity")
    inner.link("velocity", "position")
    inner.link("velocity", "friction")
    inner.link("position", "spring")
    inner.link("position", "x")
    inner.link("velocity", "v")
    return inner


def egsp_diagram(p: dict = EGSP) -> dict:
    """ЭГСП по структурной схеме рис. 1 занятия 02: 8 переменных состояния, четыре вложенные обратные связи."""

    b = DiagramBuilder()
    b.add("U", "StepInput", amplitude=p["U"], t0=0.0)
    b.add("err", "Sum", signs=["+", "-"])
    b.add("amp", "Gain", k=p["k1"])
    b.add("coil", "TransferFunction", numerator=[p["b0"]], denominator=[p["a1"], p["a0"]])
    b.add("torque", "Sum", signs=["+", "-"])
    b.add("armature", "TransferFunction", numerator=[p["d0"]], denominator=[p["c2"], p["c1"], p["c0"]])
    b.add("flap", "Gain", k=p["k2"])
    b.add("flow", "Sum", signs=["+", "-"])
    b.add("pressure", "Gain", k=p["k3"])
    b.subsystem("spool", _mass_with_velocity(p["f0"], p["e2"], p["e1"], p["e0"]))
    b.add("spool_area", "Gain", k=p["g1"])
    b.add("mech_fb", "Gain", k=p["k4"])
    b.add("valve", "Gain", k=p["k5"])
    b.add("cyl_flow", "Sum", signs=["+", "-"])
    b.add("cylinder", "TransferFunction", numerator=[p["l0"]], denominator=[p["h1"], p["h0"]])
    b.subsystem("piston", _mass_with_velocity(p["r0"], p["n2"], p["n1"], p["n0"]))
    b.add("piston_area", "Gain", k=p["q1"])
    b.add("sensor", "Gain", k=p["k6"])
    b.add("Y", "Scope", label="Y")
    b.link("U", "err", into="in1")
    b.link("err", "amp")
    b.link("amp", "coil")
    b.link("coil", "torque", into="in1")
    b.link("torque", "armature")
    b.link("armature", "flap")
    b.link("flap", "flow", into="in1")
    b.link("flow", "pressure")
    b.link("pressure", "spool")
    b.link("spool", "spool_area", out="v")
    b.link("spool_area", "flow", into="in2")
    b.link("spool", "mech_fb", out="x")
    b.link("mech_fb", "torque", into="in2")
    b.link("spool", "valve", out="x")
    b.link("valve", "cyl_flow", into="in1")
    b.link("cyl_flow", "cylinder")
    b.link("cylinder", "piston")
    b.link("piston", "piston_area", out="v")
    b.link("piston_area", "cyl_flow", into="in2")
    b.link("piston", "sensor", out="x")
    b.link("sensor", "err", into="in2")
    b.link("piston", "Y", out="x")
    return b.build()


PI = {"kp": 2.0, "ki": 1.0, "T1": 1.0, "T2": 0.5, "t_end": 15.0}


def pi_diagram(p: dict = PI) -> dict:
    """ПИ-регулятор и объект из двух инерционных звеньев 1/((T₁s + 1)(T₂s + 1)), единичная обратная связь."""

    b = DiagramBuilder()
    b.add("r", "StepInput", amplitude=1.0, t0=0.0)
    b.add("e", "Sum", signs=["+", "-"])
    b.add("pi", "PIDController", kp=p["kp"], ki=p["ki"], kd=0.0, filter_n=100.0)
    b.add("lag1", "FirstOrderLag", k=1.0, T=p["T1"], y0=0.0)
    b.add("lag2", "FirstOrderLag", k=1.0, T=p["T2"], y0=0.0)
    b.add("y", "Scope", label="y")
    b.link("r", "e", into="in1")
    b.link("e", "pi")
    b.link("pi", "lag1")
    b.link("lag1", "lag2")
    b.link("lag2", "e", into="in2")
    b.link("lag2", "y")
    return b.build()


CROSS = {"T1": 1.0, "k2": 2.0, "T2": 0.5, "H1": 0.5, "H2": 1.0, "t_end": 10.0}


def crossed_diagram(p: dict = CROSS) -> dict:
    """Три звена G₁ = 1/(s+1), G₂ = 2/(0,5s+1), G₃ = 1/s и две перекрещивающиеся обратные связи.

    H₁ идёт с выхода G₂ на вход G₁, H₂ — с выхода G₃ на вход G₂: контуры перекрываются (общее звено G₂),
    но ни один не вложен в другой. Плюс главная единичная обратная связь.
    """

    b = DiagramBuilder()
    b.add("r", "StepInput", amplitude=1.0, t0=0.0)
    b.add("s1", "Sum", signs=["+", "-", "-"])
    b.add("g1", "FirstOrderLag", k=1.0, T=p["T1"], y0=0.0)
    b.add("s2", "Sum", signs=["+", "-"])
    b.add("g2", "FirstOrderLag", k=p["k2"], T=p["T2"], y0=0.0)
    b.add("g3", "Integrator", k=1.0, y0=0.0)
    b.add("h1", "Gain", k=p["H1"])
    b.add("h2", "Gain", k=p["H2"])
    b.add("y", "Scope", label="y")
    b.link("r", "s1", into="in1")
    b.link("g3", "s1", into="in2")
    b.link("h1", "s1", into="in3")
    b.link("s1", "g1")
    b.link("g1", "s2", into="in1")
    b.link("h2", "s2", into="in2")
    b.link("s2", "g2")
    b.link("g2", "g3")
    b.link("g2", "h1")
    b.link("g3", "h2")
    b.link("g3", "y")
    return b.build()


EXAMPLES = {
    "pi": ("Контур с ПИ-регулятором", pi_diagram, PI["t_end"]),
    "crossed": ("Перекрёстные обратные связи", crossed_diagram, CROSS["t_end"]),
    "egsp": ("ЭГСП 8-го порядка", egsp_diagram, EGSP["t_end"]),
}


# Подписи блоков на холсте (параметр name) — для показа примеров в приложении.
NAMES = {
    "egsp": {
        "err": "Сравнение U − k_ос·Y", "amp": "Усилитель k_ус", "coil": "Обмотка ЭМП", "torque": "Моменты на якоре",
        "armature": "Якорь ЭМП", "flap": "Заслонка k_Qφ", "flow": "Расход Q_у − F_з·ẋ", "pressure": "Перепад 1/k_Qp",
        "spool": "Золотник ЭГУ", "spool_area": "Площадь F_з",
        "mech_fb": "Обр. связь k_мос", "valve": "Распределитель k_Qx",
        "cyl_flow": "Расход Q − F·Ẏ", "cylinder": "Полости ГЦ", "piston": "Поршень с нагрузкой",
        "piston_area": "Площадь F",
        "sensor": "Датчик k_ос",
    },
    "pi": {"e": "Ошибка", "pi": "ПИ-регулятор", "lag1": "Звено 1/(s+1)", "lag2": "Звено 1/(0,5s+1)"},
    "crossed": {"s1": "Σ₁", "g1": "G₁", "s2": "Σ₂", "g2": "G₂", "g3": "G₃", "h1": "H₁", "h2": "H₂"},
}

SUBSYSTEM_TITLES = {"spool": "Золотник ЭГУ", "piston": "Поршень с нагрузкой"}


def named(name: str, diagram: dict) -> dict:
    for block in diagram["blocks"]:
        title = NAMES.get(name, {}).get(block["id"])
        if title:
            block["parameters"]["name"] = title
    return diagram


# Координаты блоков на холсте приложения.
POSITIONS = {
    "pi": {"r": (40, 200), "e": (280, 200), "pi": (520, 200), "lag1": (780, 200), "lag2": (1040, 200),
           "y": (1300, 200)},
    "crossed": {"r": (40, 220), "s1": (260, 220), "g1": (500, 220), "s2": (740, 220), "g2": (980, 220),
                "g3": (1220, 220), "y": (1480, 220), "h1": (740, 420), "h2": (980, 20)},
    "egsp": {"U": (20, 240), "err": (240, 240), "amp": (460, 240), "coil": (680, 240), "torque": (900, 240),
             "armature": (1120, 240), "flap": (1340, 240), "flow": (1560, 240), "pressure": (1780, 240),
             "spool": (2000, 240), "valve": (2240, 240), "cyl_flow": (2460, 240), "cylinder": (2680, 240),
             "piston": (2900, 240), "Y": (3160, 240), "spool_area": (1780, 40), "mech_fb": (1340, 440),
             "piston_area": (2680, 40), "sensor": (1560, 600)},
}
INNER_POSITIONS = {"in": (20, 200), "force": (240, 200), "balance": (460, 200), "per_mass": (680, 200),
                   "velocity": (900, 200), "position": (1120, 200), "x": (1360, 120), "v": (1360, 300),
                   "friction": (680, 400), "spring": (680, 560)}
INNER_NAMES = {"force": "Сила F·u", "balance": "Баланс сил", "per_mass": "Ускорение 1/m", "velocity": "Скорость ẋ",
               "position": "Положение x", "friction": "Трение h", "spring": "Жёсткость c"}


def preset(key: str) -> dict:
    title, build, t_end = EXAMPLES[key]
    diagram = named(key, build())
    for block in diagram["blocks"]:
        if block["type"] == "Subsystem":
            inner = block["parameters"]["diagram"]
            for child in inner["blocks"]:
                if child["id"] in INNER_NAMES:
                    child["parameters"]["name"] = INNER_NAMES[child["id"]]
            positions = {k: {"x": x, "y": y} for k, (x, y) in INNER_POSITIONS.items()}
            block["parameters"]["layout"] = {"positions": positions}
    return {"id": f"kp_{key}", "title": title, "diagram": diagram,
            "positions": {k: {"x": x, "y": y} for k, (x, y) in POSITIONS[key].items()}}


def write_presets(path: Path) -> None:
    import json

    body = json.dumps([preset(key) for key in EXAMPLES], ensure_ascii=False, indent=2)
    path.write_text(
        "// Сгенерировано backend/scripts/kp_examples.py — примеры курсового проекта (ПИ, перекрёстные связи, ЭГСП).\n"
        'import type { ExamplePreset } from "./examples";\n\n'
        f"export const KP_PRESETS: ExamplePreset[] = {body};\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    write_presets(BACKEND.parent / "frontend" / "src" / "pages" / "kpExamples.ts")
    print("ok")
