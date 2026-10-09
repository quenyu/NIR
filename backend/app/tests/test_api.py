from __future__ import annotations


from fastapi.testclient import TestClient

from app.models.api import MAX_SIMULATION_POINTS
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

    provenance = payload["metadata"]["provenance"]
    assert provenance["state_mapping"] == [
        {
            "global_index": 0,
            "label": "lag1",
            "block_id": "lag1",
            "local_block_id": "lag1",
            "block_type": "FirstOrderLag",
            "subsystem_path": [],
            "local_index": 0,
        }
    ]
    assert provenance["matrix_dimensions"]["A"]["shape"] == [1, 1]
    assert provenance["matrix_dimensions"]["B"]["shape"] == [1, 1]
    assert provenance["matrix_dimensions"]["C"]["shape"] == [1, 1]
    assert provenance["matrix_dimensions"]["D"]["shape"] == [1, 1]


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
    assert payload["code"] == "diagram_invalid"
    assert any("не подключен" in item["message"] for item in payload["errors"])


def test_simulate_endpoint_rejects_non_finite_dt(client: TestClient) -> None:
    response = client.post(
        "/simulate",
        json={
            "diagram": first_order_step_diagram(),
            "t_start": 0.0,
            "t_end": 1.0,
            "dt": "nan",
            "solver": "rk4",
        },
    )

    assert response.status_code == 422
    assert "конечным числом" in response.text


def test_simulate_endpoint_rejects_excessive_time_grid(client: TestClient) -> None:
    response = client.post(
        "/simulate",
        json={
            "diagram": first_order_step_diagram(),
            "t_start": 0.0,
            "t_end": 1.0,
            "dt": 1.0 / MAX_SIMULATION_POINTS,
            "solver": "rk4",
        },
    )

    assert response.status_code == 422
    assert str(MAX_SIMULATION_POINTS) in response.text


def test_simulate_endpoint_requires_t_eval_to_include_interval_endpoints(
    client: TestClient,
) -> None:
    response = client.post(
        "/simulate",
        json={
            "diagram": first_order_step_diagram(),
            "t_start": 0.0,
            "t_end": 1.0,
            "t_eval": [0.1, 0.5, 1.0],
            "solver": "solve_ivp",
        },
    )

    assert response.status_code == 422
    assert "совпадать с 't_start'" in response.text


def test_request_schema_errors_use_the_common_format(client: TestClient) -> None:
    response = client.post("/simulate", json={"diagram": {"blocks": "oops"}})
    payload = response.json()

    assert response.status_code == 422
    assert payload["code"] == "request_invalid"
    assert all(isinstance(item["message"], str) for item in payload["errors"])
    assert any(item["path"] and item["path"].startswith("diagram") for item in payload["errors"])


def test_unstable_rk4_step_is_reported_as_solver_settings(client: TestClient) -> None:
    diagram = integrator_step_diagram()
    for block in diagram["blocks"]:
        if block["type"] == "Integrator":
            block["type"] = "FirstOrderLag"
            block["parameters"] = {"k": 1.0, "T": 0.001, "y0": 0.0}
    response = client.post(
        "/simulate", json={"diagram": diagram, "t_end": 1.0, "dt": 0.1, "solver": "rk4"}
    )

    assert response.status_code == 422
    assert response.json()["code"] == "solver_settings"
