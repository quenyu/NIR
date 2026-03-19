from __future__ import annotations

from fastapi.testclient import TestClient

from app.tests.helpers import first_order_step_diagram, integrator_step_diagram


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_validate_endpoint_success(client: TestClient) -> None:
    response = client.post("/validate", json={"diagram": first_order_step_diagram()})
    payload = response.json()

    assert response.status_code == 200
    assert payload["valid"] is True
    assert payload["errors"] == []


def test_validate_endpoint_failure(client: TestClient) -> None:
    invalid = integrator_step_diagram()
    invalid["connections"] = []

    response = client.post("/validate", json={"diagram": invalid})
    payload = response.json()

    assert response.status_code == 200
    assert payload["valid"] is False
    assert any("Обязательный вход 'in' блока 'int1'" in message for message in payload["errors"])


def test_simulate_endpoint_success_shape(client: TestClient) -> None:
    response = client.post(
        "/simulate",
        json={
            "diagram": first_order_step_diagram(),
            "t_start": 0.0,
            "t_end": 2.0,
            "dt": 0.02,
            "solver": "rk4",
        },
    )
    payload = response.json()

    assert response.status_code == 200
    assert payload["success"] is True
    assert "time" in payload
    assert "outputs" in payload
    assert "metadata" in payload
    assert "y" in payload["outputs"]
    assert len(payload["time"]) == len(payload["outputs"]["y"])


def test_simulate_endpoint_failure_returns_validation_errors(client: TestClient) -> None:
    invalid = integrator_step_diagram()
    invalid["connections"] = []

    response = client.post(
        "/simulate",
        json={
            "diagram": invalid,
            "t_start": 0.0,
            "t_end": 1.0,
            "dt": 0.01,
            "solver": "solve_ivp",
        },
    )
    payload = response.json()

    assert response.status_code == 422
    assert payload["success"] is False
    assert payload["validation_errors"]
