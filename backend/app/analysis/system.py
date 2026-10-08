from __future__ import annotations

from typing import Any

import numpy as np

from app.models.diagram import Diagram
from app.analysis.verification import verify_state_space_assembly
from app.simulation.compiler import CompiledDiagram, compile_diagram


def _stability_status(poles: np.ndarray, tolerance: float = 1e-9) -> str:
    if poles.size == 0:
        return "not_applicable"
    real_parts = np.real(poles)
    if np.any(real_parts > tolerance):
        return "unstable"
    if np.any(np.abs(real_parts) <= tolerance):
        return "marginal"
    return "stable"


def _scope_vector(
    compiled: CompiledDiagram,
    state: np.ndarray,
    source_values: dict[str, float],
) -> np.ndarray:
    outputs = compiled.evaluate_outputs(0.0, state, source_values)
    return np.asarray(
        [outputs[(scope.source_block, scope.source_port)] for scope in compiled.scopes],
        dtype=float,
    )


def _state_mapping(compiled: CompiledDiagram) -> list[dict[str, Any]]:
    mapping: list[dict[str, Any]] = []
    ordered_slices = sorted(
        compiled.dynamic_state_slices.items(),
        key=lambda item: item[1].start,
    )

    for block_id, state_slice in ordered_slices:
        block = compiled.blocks_by_id[block_id]
        path_parts = block_id.split("::")
        width = state_slice.stop - state_slice.start
        for local_index in range(width):
            mapping.append(
                {
                    "global_index": state_slice.start + local_index,
                    "label": (
                        block_id if width == 1 else f"{block_id}.x{local_index + 1}"
                    ),
                    "block_id": block_id,
                    "local_block_id": path_parts[-1],
                    "block_type": block.type,
                    "subsystem_path": path_parts[:-1],
                    "local_index": local_index,
                }
            )

    return mapping


def _state_labels(compiled: CompiledDiagram) -> list[str]:
    return [entry["label"] for entry in _state_mapping(compiled)]


def explain_model_assembly(compiled: CompiledDiagram) -> dict[str, Any]:
    """Explain how flattened block states form the global LTI model."""

    state_dimension = int(compiled.initial_state.size)
    input_dimension = sum(
        block.type == "StepInput" for block in compiled.diagram.blocks
    )
    output_dimension = len(compiled.scopes)

    return {
        "index_base": 0,
        "input_convention": (
            "Каждый StepInput трактуется как независимый нормированный внешний вход u. "
            "Его amplitude и t0 относятся к временному сценарию и не входят в матрицы B и D."
        ),
        "state_mapping": _state_mapping(compiled),
        "matrix_dimensions": {
            "A": {
                "shape": [state_dimension, state_dimension],
                "explanation": "Влияние состояния x на производную dx/dt.",
            },
            "B": {
                "shape": [state_dimension, input_dimension],
                "explanation": "Влияние внешних входов u на производную dx/dt.",
            },
            "C": {
                "shape": [output_dimension, state_dimension],
                "explanation": "Формирование наблюдаемых выходов y из состояния x.",
            },
            "D": {
                "shape": [output_dimension, input_dimension],
                "explanation": "Прямая передача внешних входов u на выходы y.",
            },
        },
    }


def _controllability_rank(a: np.ndarray, b: np.ndarray) -> int:
    n = a.shape[0]
    if n == 0 or b.shape[1] == 0:
        return 0
    blocks = [b]
    current = b
    for _ in range(1, n):
        current = a @ current
        blocks.append(current)
    return int(np.linalg.matrix_rank(np.hstack(blocks)))


def _observability_rank(a: np.ndarray, c: np.ndarray) -> int:
    n = a.shape[0]
    if n == 0 or c.shape[0] == 0:
        return 0
    blocks = [c]
    current = c
    for _ in range(1, n):
        current = current @ a
        blocks.append(current)
    return int(np.linalg.matrix_rank(np.vstack(blocks)))


def assemble_state_space(
    diagram: Diagram,
    *,
    compiled: CompiledDiagram | None = None,
) -> dict[str, Any]:
    """Build an explicit LTI state-space model for the complete diagram.

    StepInput blocks are treated as independent normalized external inputs. The
    matrix extraction evaluates the already compiled linear signal graph on
    basis state/input vectors, so feedback paths and direct feedthrough are
    included in the resulting A, B, C and D matrices.
    """

    compiled = compiled or compile_diagram(diagram)
    input_ids = [
        block.id for block in compiled.diagram.blocks if block.type == "StepInput"
    ]
    output_labels = [scope.label for scope in compiled.scopes]

    n = int(compiled.initial_state.size)
    m = len(input_ids)
    p = len(compiled.scopes)

    zero_state = np.zeros(n, dtype=float)
    zero_sources = {block_id: 0.0 for block_id in input_ids}
    baseline_rhs = compiled.rhs(0.0, zero_state, zero_sources)
    baseline_output = _scope_vector(compiled, zero_state, zero_sources)

    a = np.zeros((n, n), dtype=float)
    b = np.zeros((n, m), dtype=float)
    c = np.zeros((p, n), dtype=float)
    d = np.zeros((p, m), dtype=float)

    for column in range(n):
        state = zero_state.copy()
        state[column] = 1.0
        a[:, column] = compiled.rhs(0.0, state, zero_sources) - baseline_rhs
        c[:, column] = _scope_vector(compiled, state, zero_sources) - baseline_output

    for column, input_id in enumerate(input_ids):
        sources = zero_sources.copy()
        sources[input_id] = 1.0
        b[:, column] = compiled.rhs(0.0, zero_state, sources) - baseline_rhs
        d[:, column] = _scope_vector(compiled, zero_state, sources) - baseline_output

    poles = np.linalg.eigvals(a) if n > 0 else np.asarray([], dtype=complex)
    characteristic_polynomial = np.poly(a).real.tolist() if n > 0 else [1.0]
    spectral_abscissa = float(np.max(np.real(poles))) if poles.size > 0 else None
    stability_degree = (
        float(-spectral_abscissa)
        if spectral_abscissa is not None and spectral_abscissa < 0.0
        else None
    )
    controllability_rank = _controllability_rank(a, b)
    observability_rank = _observability_rank(a, c)

    return {
        "model_type": "continuous_lti",
        "state_dimension": n,
        "input_dimension": m,
        "output_dimension": p,
        "state_labels": _state_labels(compiled),
        "input_blocks": input_ids,
        "input_convention": "normalized_step_channels",
        "output_labels": output_labels,
        "matrices": {
            "A": a.tolist(),
            "B": b.tolist(),
            "C": c.tolist(),
            "D": d.tolist(),
        },
        "verification": verify_state_space_assembly(
            compiled,
            a,
            b,
            c,
            d,
            input_ids,
        ),
        "poles": [
            {"real": float(np.real(pole)), "imag": float(np.imag(pole))}
            for pole in poles
        ],
        "modes": [
            {
                "natural_frequency": float(abs(pole)),
                "damping_ratio": (
                    float(-np.real(pole) / abs(pole)) if abs(pole) > 1e-12 else None
                ),
            }
            for pole in poles
        ],
        "characteristic_polynomial": characteristic_polynomial,
        "spectral_abscissa": spectral_abscissa,
        "stability_degree": stability_degree,
        "stability": _stability_status(poles),
        "controllability": {
            "rank": controllability_rank,
            "applicable": n > 0,
            "full_rank": None if n == 0 else bool(controllability_rank == n),
        },
        "observability": {
            "rank": observability_rank,
            "applicable": n > 0,
            "full_rank": None if n == 0 else bool(observability_rank == n),
        },
    }
