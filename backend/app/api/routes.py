from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from app.models.api import SimulationRequest, SimulationResponse, ValidateRequest, ValidateResponse
from app.models.projects import (
    ProjectCreateRequest,
    ProjectListResponse,
    ProjectRecord,
    ProjectUpdateRequest,
)
from app.simulation.model import compile_model, diagram_errors
from app.simulation.service import simulate_request
from app.storage.projects import ProjectRepository, get_project_repository

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/projects", response_model=ProjectListResponse)
def list_projects(repository: ProjectRepository = Depends(get_project_repository)) -> ProjectListResponse:
    return ProjectListResponse(projects=repository.list())


@router.post("/projects", response_model=ProjectRecord, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreateRequest,
    repository: ProjectRepository = Depends(get_project_repository),
) -> ProjectRecord:
    compile_model(payload.payload.diagram)  # a saved project must be a valid diagram
    return repository.create(payload)


@router.get("/projects/{project_id}", response_model=ProjectRecord)
def get_project(project_id: str, repository: ProjectRepository = Depends(get_project_repository)) -> ProjectRecord:
    return repository.get(project_id)


@router.put("/projects/{project_id}", response_model=ProjectRecord)
def update_project(
    project_id: str,
    payload: ProjectUpdateRequest,
    repository: ProjectRepository = Depends(get_project_repository),
) -> ProjectRecord:
    compile_model(payload.payload.diagram)
    return repository.update(project_id, payload)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, repository: ProjectRepository = Depends(get_project_repository)) -> Response:
    repository.delete(project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/validate", response_model=ValidateResponse)
def validate_endpoint(payload: ValidateRequest) -> ValidateResponse:
    errors = diagram_errors(payload.diagram)
    return ValidateResponse(valid=not errors, errors=errors)


@router.post("/simulate", response_model=SimulationResponse)
def simulate_endpoint(payload: SimulationRequest) -> SimulationResponse:
    return simulate_request(payload)
