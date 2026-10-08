from __future__ import annotations

from typing import Any

import numpy as np
from scipy.signal import ss2tf


def _interpolate_crossing(
    frequency: np.ndarray,
    values: np.ndarray,
    target: float,
) -> list[float]:
    crossings: list[float] = []
    log_frequency = np.log10(frequency)
    shifted = values - target
    for index in range(len(values) - 1):
        left = shifted[index]
        right = shifted[index + 1]
        if left == 0.0:
            crossings.append(float(frequency[index]))
            continue
        if left * right > 0.0 or right == left:
            continue
        ratio = -left / (right - left)
        log_w = log_frequency[index] + ratio * (
            log_frequency[index + 1] - log_frequency[index]
        )
        crossings.append(float(10.0**log_w))
    deduplicated: list[float] = []
    for crossing in crossings:
        if not deduplicated or not np.isclose(
            crossing,
            deduplicated[-1],
            rtol=1e-7,
            atol=0.0,
        ):
            deduplicated.append(crossing)
    return deduplicated


def _interpolate_at(
    frequency: np.ndarray,
    values: np.ndarray,
    point: float,
) -> float:
    return float(np.interp(np.log10(point), np.log10(frequency), values))


def _automatic_frequency_range(
    system: dict[str, Any],
    a: np.ndarray,
    b: np.ndarray,
    c: np.ndarray,
    d: np.ndarray,
) -> tuple[float, float]:
    characteristic_frequencies = [
        float(np.hypot(pole["real"], pole["imag"]))
        for pole in system.get("poles", [])
        if float(np.hypot(pole["real"], pole["imag"])) > 1e-9
    ]
    if a.size:
        numerator, _ = ss2tf(a, b, c, d, input=0)
        trimmed = np.trim_zeros(np.asarray(numerator[0], dtype=float), trim="f")
        if trimmed.size > 1:
            characteristic_frequencies.extend(
                float(abs(zero))
                for zero in np.roots(trimmed)
                if abs(zero) > 1e-9
            )
    if not characteristic_frequencies:
        return 1e-2, 1e2
    minimum = max(1e-10, min(characteristic_frequencies) / 100.0)
    maximum = min(1e10, max(characteristic_frequencies) * 100.0)
    if maximum <= minimum:
        maximum = minimum * 1e4
    return minimum, maximum


def _siso_response(
    frequency: np.ndarray,
    a: np.ndarray,
    b: np.ndarray,
    c: np.ndarray,
    d: np.ndarray,
) -> np.ndarray:
    response = np.zeros(frequency.size, dtype=complex)
    if a.size == 0:
        response[:] = complex(d[0, 0])
        return response

    identity = np.eye(a.shape[0], dtype=complex)
    input_vector = b[:, 0].astype(complex)
    output_vector = c[0, :].astype(complex)
    feedthrough = complex(d[0, 0])
    for index, omega in enumerate(frequency):
        state_response = np.linalg.solve(1j * omega * identity - a, input_vector)
        response[index] = output_vector @ state_response + feedthrough
    return response


def _phase_crossings(
    frequency: np.ndarray,
    phase_deg: np.ndarray,
) -> list[float]:
    minimum = float(np.min(phase_deg))
    maximum = float(np.max(phase_deg))
    first_level = int(np.ceil((minimum + 180.0) / 360.0))
    last_level = int(np.floor((maximum + 180.0) / 360.0))
    crossings: list[float] = []
    for level in range(first_level, last_level + 1):
        target = -180.0 + 360.0 * level
        if np.allclose(phase_deg, target, atol=1e-10, rtol=0.0):
            continue
        crossings.extend(_interpolate_crossing(frequency, phase_deg, target))
    return sorted(
        {
            round(value, 12): value
            for value in crossings
        }.values()
    )


def analyze_frequency_response(
    system: dict[str, Any],
    *,
    points: int = 320,
) -> dict[str, Any]:
    if points < 32:
        raise ValueError("Для частотного анализа требуется минимум 32 точки.")

    matrices = system["matrices"]
    a = np.asarray(matrices["A"], dtype=float)
    b = np.asarray(matrices["B"], dtype=float)
    c = np.asarray(matrices["C"], dtype=float)
    d = np.asarray(matrices["D"], dtype=float)
    n = int(system["state_dimension"])
    m = int(system["input_dimension"])
    p = int(system["output_dimension"])

    if m == 0 or p == 0:
        return {
            "available": False,
            "reason": "Для частотного анализа необходимы минимум один вход и один выход.",
        }

    w_min, w_max = _automatic_frequency_range(system, a, b, c, d)
    for _ in range(6):
        endpoints = np.asarray([w_min, w_max], dtype=float)
        endpoint_response = _siso_response(endpoints, a, b, c, d)
        low_magnitude = abs(endpoint_response[0])
        high_magnitude = abs(endpoint_response[1])
        has_integrator = any(
            abs(float(pole["real"])) <= 1e-12 and abs(float(pole["imag"])) <= 1e-12
            for pole in system.get("poles", [])
        )
        expanded = False
        if has_integrator and low_magnitude < 1.0 and w_min > 1e-12:
            w_min = max(1e-12, w_min / 100.0)
            expanded = True
        high_frequency_gain = abs(float(d[0, 0]))
        if high_magnitude > 1.0 and high_frequency_gain < 1.0 - 1e-10 and w_max < 1e12:
            w_max = min(1e12, w_max * 100.0)
            expanded = True
        if not expanded:
            break

    frequency = np.logspace(np.log10(w_min), np.log10(w_max), points)
    response = _siso_response(frequency, a, b, c, d)

    magnitude = np.abs(response)
    magnitude_db = 20.0 * np.log10(np.maximum(magnitude, 1e-15))
    phase_deg = np.rad2deg(np.unwrap(np.angle(response)))
    phase_deg -= 360.0 * np.floor((phase_deg[0] + 180.0) / 360.0)

    continuum_gain_crossover = np.allclose(magnitude_db, 0.0, atol=1e-10, rtol=0.0)
    gain_crossovers = (
        []
        if continuum_gain_crossover
        else _interpolate_crossing(frequency, magnitude_db, 0.0)
    )
    phase_margins = [
        180.0 + _interpolate_at(frequency, phase_deg, crossover)
        for crossover in gain_crossovers
    ]
    phase_crossovers = _phase_crossings(frequency, phase_deg)
    gain_margins_db = [
        -_interpolate_at(frequency, magnitude_db, crossover)
        for crossover in phase_crossovers
    ]

    return {
        "available": True,
        "channel_kind": "siso_channel",
        "channel_warning": (
            "Показан только первый канал общей MIMO-модели."
            if m > 1 or p > 1
            else None
        ),
        "input_block": system["input_blocks"][0],
        "output_label": system["output_labels"][0],
        "frequency_rad_s": frequency.tolist(),
        "magnitude": magnitude.tolist(),
        "magnitude_db": magnitude_db.tolist(),
        "phase_deg": phase_deg.tolist(),
        "nyquist_real": np.real(response).tolist(),
        "nyquist_imag": np.imag(response).tolist(),
        "gain_crossovers_rad_s": gain_crossovers,
        "phase_crossovers_rad_s": phase_crossovers,
        "phase_margins_deg": phase_margins,
        "gain_margins_db": gain_margins_db,
        "critical_phase_margin_deg": min(phase_margins) if phase_margins else None,
        "critical_gain_margin_db": min(gain_margins_db) if gain_margins_db else None,
        "gain_crossover_status": (
            "indeterminate_continuum" if continuum_gain_crossover else "finite_search"
        ),
        "frequency_range_rad_s": [float(w_min), float(w_max)],
        "interpretation": (
            "Показанные crossover-метрики являются запасами устойчивости только тогда, "
            "когда выбранный канал действительно является разомкнутой петлевой "
            "передаточной функцией L(s). Для замкнутой передаточной функции это лишь "
            "формальные пересечения уровней 0 дБ и -180°."
        ),
    }
