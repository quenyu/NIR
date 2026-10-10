from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.analysis.sweep import sweep_poles
from app.models.api import SweepRequest
from app.models.diagram import Diagram
from app.simulation.model import DiagramCompilationError
from app.tests.structural_cases import DiagramBuilder


def _loop(plant_denominator: list[float]) -> dict:
    """Unity negative feedback around K * 1/plant_denominator(s)."""

    b = DiagramBuilder()
    b.add("r", "StepInput", amplitude=1.0, t0=0.0)
    b.add("e", "Sum", signs=["+", "-"])
    b.add("k", "Gain", k=1.0)
    b.add("plant", "TransferFunction", numerator=[1.0], denominator=plant_denominator)
    b.add("y", "Scope", label="y")
    b.link("r", "e", into="in1")
    b.link("e", "k")
    b.link("k", "plant")
    b.link("plant", "y")
    b.link("plant", "e", into="in2")
    return b.build()


def _request(diagram: dict, values: list[float], block: str = "k", parameter: str = "k") -> SweepRequest:
    return SweepRequest(diagram=Diagram.model_validate(diagram), block_id=block, parameter=parameter, values=values)


def _poles(point) -> np.ndarray:
    return np.sort_complex(np.array([p["real"] + 1j * p["imag"] for p in point.poles]))


def test_first_order_locus_is_one_minus_k() -> None:
    values = [0.0, 0.5, 1.0, 3.0, 10.0]
    response = sweep_poles(_request(_loop([1.0, -1.0]), values))

    assert [point.value for point in response.points] == values
    for point in response.points:
        # Assembly and eigvals are exact up to rounding for a scalar A.
        assert _poles(point)[0] == pytest.approx(1.0 - point.value, abs=1e-12)
    assert [point.stability for point in response.points] == [
        "unstable", "unstable", "marginal", "stable", "stable",
    ]


def test_second_order_locus_matches_characteristic_roots() -> None:
    """Plant 1/(s^2 + 2s): closed loop s^2 + 2s + K, roots -1 ± sqrt(1 - K)."""

    values = [0.25, 1.0, 5.0]
    response = sweep_poles(_request(_loop([1.0, 2.0, 0.0]), values))
    for point in response.points:
        expected = np.sort_complex(np.roots([1.0, 2.0, point.value]))
        # A double root (K = 1) is computed with a spread of about sqrt(eps).
        assert np.allclose(_poles(point), expected, atol=1e-7)


def test_singular_algebraic_loop_is_reported_per_value() -> None:
    """y = u + k y has no solution at k = 1; other values assemble."""

    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    b.add("s", "Sum", signs=["+", "+"])
    b.add("k", "Gain", k=0.5)
    b.add("y", "Scope", label="y")
    b.link("u", "s", into="in1")
    b.link("s", "k")
    b.link("k", "s", into="in2")
    b.link("k", "y")

    response = sweep_poles(_request(b.build(), [0.5, 1.0]))
    assert response.points[0].error is None
    assert response.points[0].poles == []
    assert response.points[1].poles is None
    assert response.points[1].error


def test_unknown_block_or_non_numeric_parameter_is_rejected() -> None:
    with pytest.raises(DiagramCompilationError):
        sweep_poles(_request(_loop([1.0, -1.0]), [1.0, 2.0], block="missing"))
    with pytest.raises(DiagramCompilationError):
        sweep_poles(_request(_loop([1.0, -1.0]), [1.0, 2.0], block="plant", parameter="numerator"))


def test_sweep_endpoint(client: TestClient) -> None:
    payload = {"diagram": _loop([1.0, -1.0]), "block_id": "k", "parameter": "k", "values": [2.0, 4.0]}
    response = client.post("/analyze/sweep", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert [point["poles"][0]["real"] for point in body["points"]] == pytest.approx([-1.0, -3.0])

    response = client.post("/analyze/sweep", json={**payload, "values": [1.0]})
    assert response.status_code == 422
    assert response.json()["code"] == "request_invalid"

    response = client.post("/analyze/sweep", json={**payload, "block_id": "missing"})
    assert response.status_code == 422
    assert response.json()["code"] == "diagram_invalid"
