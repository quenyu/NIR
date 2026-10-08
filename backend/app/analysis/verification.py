from __future__ import annotations

from typing import Any

import numpy as np

from app.simulation.compiler import CompiledDiagram


def _graph_output(
    compiled: CompiledDiagram,
    state: np.ndarray,
    source_values: dict[str, float],
) -> np.ndarray:
    outputs = compiled.evaluate_outputs(0.0, state, source_values)
    return np.asarray(
        [outputs[(scope.source_block, scope.source_port)] for scope in compiled.scopes],
        dtype=float,
    )


def _deterministic_probes(n: int, m: int) -> list[tuple[np.ndarray, np.ndarray]]:
    state_indices = np.arange(1, n + 1, dtype=float)
    input_indices = np.arange(1, m + 1, dtype=float)
    return [
        (
            ((-1.0) ** state_indices) * state_indices / (n + 1.0),
            input_indices / (m + 1.0),
        ),
        (
            np.cos(state_indices),
            -np.sin(input_indices),
        ),
    ]


def verify_state_space_assembly(
    compiled: CompiledDiagram,
    a: np.ndarray,
    b: np.ndarray,
    c: np.ndarray,
    d: np.ndarray,
    input_ids: list[str],
    tolerance: float = 1e-9,
) -> dict[str, Any]:
    """Check that A, B, C, D reproduce the compiled linear block graph."""

    n = int(compiled.initial_state.size)
    m = len(input_ids)
    p = len(compiled.scopes)
    expected_shapes = {
        "A": [n, n],
        "B": [n, m],
        "C": [p, n],
        "D": [p, m],
    }
    matrices = {"A": a, "B": b, "C": c, "D": d}
    dimensions_valid = all(
        matrix.shape == tuple(expected_shapes[name])
        for name, matrix in matrices.items()
    )
    finite = all(np.isfinite(matrix).all() for matrix in matrices.values())

    state_residuals: list[float] = []
    output_residuals: list[float] = []
    zero_state_residual: float | None = None
    zero_output_residual: float | None = None

    if dimensions_valid and finite:
        zero_state = np.zeros(n, dtype=float)
        zero_input = np.zeros(m, dtype=float)
        zero_sources = dict(zip(input_ids, zero_input, strict=True))
        zero_state_residual = float(
            np.max(np.abs(compiled.rhs(0.0, zero_state, zero_sources)))
        ) if n else 0.0
        zero_output = _graph_output(compiled, zero_state, zero_sources)
        zero_output_residual = (
            float(np.max(np.abs(zero_output))) if zero_output.size else 0.0
        )
        state_residuals.append(zero_state_residual)
        output_residuals.append(zero_output_residual)

        for state, input_vector in _deterministic_probes(n, m):
            sources = dict(zip(input_ids, input_vector, strict=True))
            graph_state = compiled.rhs(0.0, state, sources)
            graph_output = _graph_output(compiled, state, sources)
            assembled_state = a @ state + b @ input_vector
            assembled_output = c @ state + d @ input_vector
            state_residuals.append(
                float(np.max(np.abs(graph_state - assembled_state)))
                if graph_state.size
                else 0.0
            )
            output_residuals.append(
                float(np.max(np.abs(graph_output - assembled_output)))
                if graph_output.size
                else 0.0
            )

    max_state_residual = max(state_residuals, default=None)
    max_output_residual = max(output_residuals, default=None)
    verified = bool(
        dimensions_valid
        and finite
        and max_state_residual is not None
        and max_output_residual is not None
        and max_state_residual <= tolerance
        and max_output_residual <= tolerance
    )

    return {
        "status": "verified" if verified else "failed",
        "passed": verified,
        "method": "deterministic_mixed_probes",
        "description": (
            "Автоматически проверена согласованность матричной модели с "
            "вычислительным графом: F(0,0)=G(0,0)=0 и две смешанные пробы "
            "F(x,u)=Ax+Bu, G(x,u)=Cx+Du без интегрирования по времени."
        ),
        "dimensions_valid": dimensions_valid,
        "finite": finite,
        "expected_shapes": expected_shapes,
        "probe_count": 2,
        "tolerance": tolerance,
        "zero_state_residual": zero_state_residual,
        "zero_output_residual": zero_output_residual,
        "max_state_residual": max_state_residual,
        "max_output_residual": max_output_residual,
    }
