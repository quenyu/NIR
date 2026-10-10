from __future__ import annotations

import math
from collections.abc import Sequence


def step_input(t: float, amplitude: float, t0: float) -> float:
    return amplitude if t >= t0 else 0.0


def gain_output(k: float, x: float) -> float:
    return k * x


def sum_output(values: Sequence[float], signs: Sequence[str]) -> float:
    if len(values) != len(signs):
        raise ValueError("Списки values и signs должны иметь одинаковую длину.")
    total = 0.0
    for value, sign in zip(values, signs, strict=True):
        if sign == "+":
            total += value
        elif sign == "-":
            total -= value
        else:
            raise ValueError(f"Неподдерживаемый знак '{sign}'.")
    return total


def integrator_derivative(k: float, x: float) -> float:
    return k * x


def first_order_lag_derivative(k: float, t_const: float, x: float, y: float) -> float:
    if t_const <= 0.0:
        raise ValueError("Для FirstOrderLag требуется T > 0.")
    return (k * x - y) / t_const


def second_order_oscillator_derivative(
    k: float, wn: float, zeta: float, x: float, y: float, y_dot: float
) -> tuple[float, float]:
    if wn <= 0.0:
        raise ValueError("Для SecondOrderOscillator требуется wn > 0.")
    if zeta < 0.0:
        raise ValueError("Для SecondOrderOscillator требуется zeta >= 0.")
    dy = y_dot
    ddy = (k * wn * wn * x) - (2.0 * zeta * wn * y_dot) - (wn * wn * y)
    if math.isnan(ddy):
        raise ValueError("Вычисленная производная имеет значение NaN.")
    return dy, ddy
