from __future__ import annotations

import numpy as np


def _as_time_array(time: np.ndarray | list[float]) -> np.ndarray:
    array = np.asarray(time, dtype=float)
    if array.ndim != 1:
        raise ValueError("Временная сетка должна быть одномерной.")
    return array


def integrator_step_response(
    time: np.ndarray | list[float],
    *,
    k: float = 1.0,
    amplitude: float = 1.0,
    y0: float = 0.0,
) -> np.ndarray:
    t = _as_time_array(time)
    return y0 + (k * amplitude * t)


def first_order_step_response(
    time: np.ndarray | list[float],
    *,
    k: float,
    t_const: float,
    amplitude: float = 1.0,
    y0: float = 0.0,
) -> np.ndarray:
    if t_const <= 0.0:
        raise ValueError("Для FirstOrderLag требуется t_const > 0.")
    t = _as_time_array(time)
    steady_state = k * amplitude
    return steady_state + (y0 - steady_state) * np.exp(-t / t_const)


def underdamped_second_order_step_response(
    time: np.ndarray | list[float],
    *,
    k: float,
    wn: float,
    zeta: float,
    amplitude: float = 1.0,
) -> np.ndarray:
    if wn <= 0.0:
        raise ValueError("Для SecondOrderOscillator требуется wn > 0.")
    if not 0.0 <= zeta < 1.0:
        raise ValueError("Формула применима только для недо-демпфированного случая: 0 <= zeta < 1.")

    t = _as_time_array(time)
    wd = wn * np.sqrt(1.0 - zeta**2)
    zeta_term = zeta / np.sqrt(1.0 - zeta**2)
    gain = k * amplitude
    return gain * (
        1.0 - np.exp(-zeta * wn * t) * (np.cos(wd * t) + zeta_term * np.sin(wd * t))
    )


def butterworth_lpf_step_response(
    time: np.ndarray | list[float],
    *,
    order: int,
    cutoff_freq: float,
    amplitude: float = 1.0,
) -> np.ndarray:
    """Эталонный step-response ФНЧ Баттерворта через scipy.signal."""
    from scipy.signal import lti

    from app.core.block_specs import butterworth_coefficients

    t = _as_time_array(time)
    numerator, denominator = butterworth_coefficients(order, cutoff_freq)
    system = lti(numerator, denominator)
    input_signal = np.full(t.shape, float(amplitude), dtype=float)
    _, y, _ = system.output(input_signal, t)
    return y.flatten()
