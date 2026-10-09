"""Structural properties of the assembled model: poles, stability, PBH tests."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.analysis.stability import (
    AXIS_RTOL,
    balanced,
    classify_stability,
    eigenvalue_clusters,
)
from app.simulation.assembly import LinearModel, state_mapping

# A PBH matrix [lambda I - A, B] whose smallest singular value is below this
# fraction of its largest is rank-deficient: the mode is not reachable.
# sqrt(eps) absorbs the error of a computed (possibly double) eigenvalue.
PBH_RANK_RTOL = AXIS_RTOL
# Below this relative margin the property holds formally but a small change of
# parameters can destroy it; the result is flagged as poorly conditioned.
PBH_WEAK_MARGIN = 1e-6


def _pbh(a: np.ndarray, b: np.ndarray, *, observability: bool) -> dict[str, Any]:
    """Popov-Belevitch-Hautus test on the balanced realization.

    Balancing is a diagonal similarity T: (T^-1 A T, T^-1 B, C T). Ranks of
    [lambda I - A, B] and [lambda I - A; C] are invariant under it, while the
    singular values become far less sensitive to the scaling of states.
    """

    n = a.shape[0]
    if n == 0 or b.size == 0:
        return {"applicable": False, "rank": 0, "full_rank": None, "margin": None,
                "weak": False, "deficient_modes": [], "method": "pbh"}

    a_bal, t = balanced(a)
    if observability:
        # C T, transposed: observability of (A, C) is controllability of (A^T, C^T).
        other = (b @ t).T
        a_bal = a_bal.T
    else:
        other = np.linalg.solve(t, b)

    deficit = 0
    margins: list[float] = []
    deficient: list[dict[str, float]] = []
    for value, multiplicity in eigenvalue_clusters(a_bal):
        test = np.hstack([value * np.eye(n) - a_bal, other.astype(complex)])
        singular_values = np.linalg.svd(test, compute_uv=False)
        relative = singular_values / singular_values[0]
        margin = float(relative[n - 1])
        margins.append(margin)
        missing = int(np.sum(relative[:n] <= PBH_RANK_RTOL))
        if missing:
            deficit += min(missing, multiplicity)
            deficient.append({"real": float(value.real), "imag": float(value.imag)})

    rank = n - deficit
    margin = min(margins) if margins else None
    return {
        "applicable": True,
        "rank": rank,
        "full_rank": rank == n,
        "margin": margin,
        "weak": rank == n and margin is not None and margin < PBH_WEAK_MARGIN,
        "deficient_modes": deficient,
        "method": "pbh",
    }


def controllability(a: np.ndarray, b: np.ndarray) -> dict[str, Any]:
    return _pbh(a, b, observability=False)


def observability(a: np.ndarray, c: np.ndarray) -> dict[str, Any]:
    return _pbh(a, c, observability=True)


def analyze_model(model: LinearModel) -> dict[str, Any]:
    a, b, c, d = model.a, model.b, model.c, model.d
    n = model.state_dimension
    poles = np.linalg.eigvals(a) if n else np.zeros(0, dtype=complex)
    spectral_abscissa = float(np.max(poles.real)) if n else None
    stability = classify_stability(a)

    return {
        "model_type": "continuous_lti",
        "state_dimension": n,
        "input_dimension": len(model.sources),
        "output_dimension": len(model.scopes),
        "state_labels": [entry.label for entry in model.states],
        "input_blocks": [source.block_id for source in model.sources],
        "input_convention": "normalized_step_channels",
        "output_labels": [scope.label for scope in model.scopes],
        "matrices": {"A": a.tolist(), "B": b.tolist(), "C": c.tolist(), "D": d.tolist()},
        "poles": [{"real": float(p.real), "imag": float(p.imag)} for p in poles],
        "modes": [
            {
                "natural_frequency": float(abs(p)),
                "damping_ratio": float(-p.real / abs(p)) if abs(p) > 1e-12 else None,
            }
            for p in poles
        ],
        "characteristic_polynomial": np.poly(a).real.tolist() if n else [1.0],
        "spectral_abscissa": spectral_abscissa,
        "stability_degree": (
            -spectral_abscissa
            if spectral_abscissa is not None and stability["status"] == "stable"
            else None
        ),
        "stability": stability["status"],
        "stability_reason": stability["reason"],
        "controllability": controllability(a, b),
        "observability": observability(a, c),
        "algebraic_loops": [
            {"blocks": loop.blocks, "condition_number": loop.condition_number}
            for loop in model.algebraic_loops
        ],
    }


def explain_model_assembly(model: LinearModel) -> dict[str, Any]:
    """How flattened block states form the global LTI model (for the UI)."""

    n = model.state_dimension
    m = len(model.sources)
    p = len(model.scopes)
    return {
        "index_base": 0,
        "input_convention": (
            "Каждый StepInput — независимый нормированный внешний вход u. "
            "Его amplitude и t0 относятся к временному сценарию и не входят в матрицы B и D."
        ),
        "state_mapping": state_mapping(model),
        "matrix_dimensions": {
            "A": {"shape": [n, n], "explanation": "Влияние состояния x на производную dx/dt."},
            "B": {"shape": [n, m], "explanation": "Влияние внешних входов u на производную dx/dt."},
            "C": {"shape": [p, n], "explanation": "Формирование наблюдаемых выходов y из состояния x."},
            "D": {"shape": [p, m], "explanation": "Прямая передача внешних входов u на выходы y."},
        },
    }
