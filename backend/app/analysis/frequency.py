"""Frequency response W(jw) = C (jw I - A)^-1 B + D of the assembled model.

One record per channel (StepInput -> Scope). These are characteristics of the
channel as drawn; for a closed loop they describe the closed-loop transfer,
so stability margins are deliberately not derived from them: margins need the
open-loop transfer L(s) of a broken loop, which a block diagram does not
identify by itself.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.simulation.assembly import LinearModel

POINTS = 320
MAX_CHANNELS = 16
# Frequencies closer than this (relative) to an imaginary-axis pole are left
# out: |W| is unbounded there and the solve would be meaningless.
POLE_GUARD_RTOL = 1e-6


def _frequency_range(poles: np.ndarray) -> tuple[float, float]:
    radii = [abs(p) for p in poles if abs(p) > 1e-9]
    if not radii:
        return 1e-2, 1e2
    low = max(1e-6, min(radii) / 100.0)
    high = min(1e8, max(radii) * 100.0)
    return low, max(high, low * 1e3)


def _phase_degrees(response: np.ndarray) -> np.ndarray:
    phase = np.full(response.size, np.nan)
    finite = np.isfinite(response)
    # Unwrap each continuous run separately; gaps at guarded frequencies
    # must not glue unrelated branches together.
    start = None
    for index in range(response.size + 1):
        inside = index < response.size and finite[index]
        if inside and start is None:
            start = index
        if not inside and start is not None:
            phase[start:index] = np.rad2deg(np.unwrap(np.angle(response[start:index])))
            start = None
    return phase


def analyze_frequency_response(model: LinearModel) -> dict[str, Any]:
    m, p = len(model.sources), len(model.scopes)
    if m == 0 or p == 0:
        return {"available": False, "reason": "Нужны минимум один вход StepInput и один Scope."}

    a, b, c, d = model.a, model.b, model.c, model.d
    n = model.state_dimension
    poles = np.linalg.eigvals(a) if n else np.zeros(0, dtype=complex)
    w_min, w_max = _frequency_range(poles)
    omega = np.logspace(np.log10(w_min), np.log10(w_max), POINTS)
    axis_poles = [abs(pole.imag) for pole in poles if abs(pole.real) <= 1e-9 * max(1.0, abs(pole))]

    responses = np.full((omega.size, p, m), np.nan + 0j)
    for index, w in enumerate(omega):
        if any(abs(w - wp) <= POLE_GUARD_RTOL * max(w, wp) for wp in axis_poles):
            continue
        if n == 0:
            responses[index] = d
            continue
        try:
            responses[index] = c @ np.linalg.solve(1j * w * np.eye(n) - a, b) + d
        except np.linalg.LinAlgError:
            continue

    channels = []
    for i in range(m):
        for o in range(p):
            if len(channels) == MAX_CHANNELS:
                break
            w_jw = responses[:, o, i]
            magnitude = np.abs(w_jw)
            channels.append(
                {
                    "input_block": model.sources[i].block_id,
                    "output_label": model.scopes[o].label,
                    "magnitude_db": [
                        None if not np.isfinite(v) else float(20.0 * np.log10(max(v, 1e-300))) for v in magnitude
                    ],
                    "phase_deg": [None if not np.isfinite(v) else float(v) for v in _phase_degrees(w_jw)],
                    "real": [None if not np.isfinite(v) else float(v.real) for v in w_jw],
                    "imag": [None if not np.isfinite(v) else float(v.imag) for v in w_jw],
                }
            )

    return {
        "available": True,
        "frequency_rad_s": omega.tolist(),
        "frequency_range_rad_s": [float(w_min), float(w_max)],
        "channels": channels,
        "truncated": m * p > MAX_CHANNELS,
        "interpretation": (
            "Частотные характеристики канала «вход → выход» схемы в том виде, как она собрана. "
            "Для замкнутого контура это характеристики замкнутой системы; запасы устойчивости "
            "по ним не определяются."
        ),
    }
