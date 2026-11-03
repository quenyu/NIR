"""Схемы, на которых в дипломе проверяется анализ: устойчивость, качество, частотные характеристики, запасы.

Три схемы курсового проекта (ПИ-регулятор, перекрёстные связи, ЭГСП) дополнены примерами с заранее
известным ответом:

* контур 3-го порядка K/(s(s+1)(s+2)): по критерию Гурвица устойчив при 0 < K < 6, поэтому K = 2
  даёт устойчивую систему, K = 10 — неустойчивую, а K = 6 — границу (полюса ±j√2);
* колебательное звено без затухания 1/(s²+1): полюса ±j, граница устойчивости;
* два интегратора подряд 1/s²: двойной полюс в нуле, система неустойчива (выход растёт как t);
* звено 1/(s+1), за которым стоит (s+1)/(s+2): нуль сокращает полюс, мода −1 ненаблюдаема.

Для схем с обратной связью указан разрез — связь, по которой контур размыкается для расчёта
запасов устойчивости.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))

from kp_examples import crossed_diagram, egsp_diagram, pi_diagram  # noqa: E402

from app.tests.structural_cases import DiagramBuilder  # noqa: E402


def third_order(k: float) -> dict:
    """Единичная отрицательная обратная связь вокруг K/(s(s+1)(s+2))."""

    b = DiagramBuilder()
    b.add("r", "StepInput", amplitude=1.0, t0=0.0)
    b.add("e", "Sum", signs=["+", "-"])
    b.add("k", "Gain", k=k)
    b.add("i", "Integrator", k=1.0, y0=0.0)
    b.add("l1", "FirstOrderLag", k=1.0, T=1.0, y0=0.0)
    b.add("l2", "FirstOrderLag", k=0.5, T=0.5, y0=0.0)   # 0,5/(0,5s+1) = 1/(s+2)
    b.add("y", "Scope", label="y")
    b.link("r", "e", into="in1")
    b.link("e", "k")
    b.link("k", "i")
    b.link("i", "l1")
    b.link("l1", "l2")
    b.link("l2", "e", into="in2")
    b.link("l2", "y")
    return b.build()


def undamped() -> dict:
    """Колебательное звено без затухания 1/(s²+1), без обратной связи."""

    b = DiagramBuilder()
    b.add("r", "StepInput", amplitude=1.0, t0=0.0)
    b.add("w", "TransferFunction", numerator=[1.0], denominator=[1.0, 0.0, 1.0])
    b.add("y", "Scope", label="y")
    b.link("r", "w")
    b.link("w", "y")
    return b.build()


def double_integrator() -> dict:
    """Два интегратора подряд: 1/s²."""

    b = DiagramBuilder()
    b.add("r", "StepInput", amplitude=1.0, t0=0.0)
    b.add("i1", "Integrator", k=1.0, y0=0.0)
    b.add("i2", "Integrator", k=1.0, y0=0.0)
    b.add("y", "Scope", label="y")
    b.link("r", "i1")
    b.link("i1", "i2")
    b.link("i2", "y")
    return b.build()


def cancellation() -> dict:
    """1/(s+1), затем (s+1)/(s+2): нуль второго звена сокращает полюс первого."""

    b = DiagramBuilder()
    b.add("r", "StepInput", amplitude=1.0, t0=0.0)
    b.add("g1", "FirstOrderLag", k=1.0, T=1.0, y0=0.0)
    b.add("g2", "TransferFunction", numerator=[1.0, 1.0], denominator=[1.0, 2.0])
    b.add("y", "Scope", label="y")
    b.link("r", "g1")
    b.link("g1", "g2")
    b.link("g2", "y")
    return b.build()


# имя: (название, схема, разрез контура (откуда, порт, куда, порт) или None, время моделирования)
CASES = {
    "pi": ("Контур с ПИ-регулятором", pi_diagram, ("lag2", "out", "e", "in2"), 15.0),
    "crossed": ("Перекрёстные обратные связи", crossed_diagram, ("g3", "out", "s1", "in2"), 10.0),
    "egsp": ("ЭГСП 8-го порядка", egsp_diagram, ("sensor", "out", "err", "in2"), 0.7),
    "k2": ("Контур 3-го порядка, K = 2", lambda: third_order(2.0), ("l2", "out", "e", "in2"), 40.0),
    "k10": ("Контур 3-го порядка, K = 10", lambda: third_order(10.0), ("l2", "out", "e", "in2"), 10.0),
    "undamped": ("Колебательное звено без затухания", undamped, None, 20.0),
    "double": ("Два интегратора", double_integrator, None, 5.0),
    "cancel": ("Сокращение нуля и полюса", cancellation, None, 5.0),
}

# Значения K для корневого годографа контура 3-го порядка (блок k, параметр k).
SWEEP_K = [0.5, 1.0, 2.0, 4.0, 6.0, 8.0, 10.0]
