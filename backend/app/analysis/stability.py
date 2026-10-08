from __future__ import annotations

from typing import Any

import numpy as np

from app.core.block_specs import get_transfer_function_coefficients
from app.models.diagram import Diagram
from app.simulation.hierarchy import flatten_diagram


def _stability_status(poles: np.ndarray, tolerance: float) -> str:
    if poles.size == 0:
        return "stable"

    real_parts = np.real(poles)
    if np.any(real_parts > tolerance):
        return "unstable"
    if np.any(np.abs(real_parts) <= tolerance):
        return "marginal"
    return "stable"


def _overall_status(statuses: list[str]) -> str:
    if not statuses:
        return "not_applicable"
    if "unstable" in statuses:
        return "unstable"
    if "marginal" in statuses:
        return "marginal"
    return "stable"


def analyze_transfer_function_stability(
    diagram: Diagram,
    *,
    tolerance: float = 1e-9,
) -> dict[str, Any]:
    transfer_functions: list[dict[str, Any]] = []

    for block in flatten_diagram(diagram).blocks:
        if block.type != "TransferFunction":
            continue

        _, denominator = get_transfer_function_coefficients(block.parameters)
        poles = np.roots(np.array(denominator, dtype=float)) if len(denominator) > 1 else np.array([])
        status = _stability_status(poles, tolerance)
        transfer_functions.append(
            {
                "block_id": block.id,
                "status": status,
                "poles": [
                    {"real": float(np.real(pole)), "imag": float(np.imag(pole))}
                    for pole in poles
                ],
            }
        )

    return {
        "overall_status": _overall_status(
            [item["status"] for item in transfer_functions]
        ),
        "transfer_functions": transfer_functions,
    }
