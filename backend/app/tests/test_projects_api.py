from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.storage.projects import ProjectRepository, get_project_repository
from app.tests.helpers import first_order_step_diagram


def project_request(title: str = "Дипломная модель") -> dict[str, object]:
    return {
        "title": title,
        "payload": {
            "diagram": first_order_step_diagram(),
            "layout": {
                "positions": {
                    "step1": {"x": 40, "y": 100},
                    "lag1": {"x": 280, "y": 100},
                    "scope1": {"x": 520, "y": 100},
                },
                "viewport": {"x": 0, "y": 0, "zoom": 1},
            },
            "simulation": {
                "solver": "solve_ivp",
                "t_start": 0,
                "t_end": 6,
                "dt": 0.01,
            },
        },
    }


def test_project_crud_and_optimistic_versioning(tmp_path: Path) -> None:
    repository = ProjectRepository(tmp_path / "projects.db")
    app.dependency_overrides[get_project_repository] = lambda: repository
    try:
        with TestClient(app) as client:
            created_response = client.post("/projects", json=project_request())
            assert created_response.status_code == 201
            created = created_response.json()
            assert created["version"] == 1
            assert created["block_count"] == 3

            list_response = client.get("/projects")
            assert list_response.status_code == 200
            assert [item["id"] for item in list_response.json()["projects"]] == [created["id"]]

            fetched = client.get(f"/projects/{created['id']}").json()
            assert fetched["payload"]["diagram"]["blocks"][1]["id"] == "lag1"

            update_payload = project_request("Обновлённая модель")
            update_payload["expected_version"] = 1
            updated_response = client.put(f"/projects/{created['id']}", json=update_payload)
            assert updated_response.status_code == 200
            updated = updated_response.json()
            assert updated["version"] == 2
            assert updated["title"] == "Обновлённая модель"

            conflict_response = client.put(f"/projects/{created['id']}", json=update_payload)
            assert conflict_response.status_code == 409
            assert conflict_response.json()["detail"]["current_version"] == 2

            delete_response = client.delete(f"/projects/{created['id']}")
            assert delete_response.status_code == 204
            assert client.get(f"/projects/{created['id']}").status_code == 404
    finally:
        app.dependency_overrides.pop(get_project_repository, None)


def test_server_rejects_invalid_project_diagram(tmp_path: Path) -> None:
    repository = ProjectRepository(tmp_path / "projects.db")
    app.dependency_overrides[get_project_repository] = lambda: repository
    request = project_request()
    request["payload"]["diagram"]["connections"] = []
    try:
        with TestClient(app) as client:
            response = client.post("/projects", json=request)
            assert response.status_code == 422
            assert response.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_project_repository, None)
