from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import JSONResponse

from app.models.api import (
    SimulationRequest,
    SimulationResponse,
    ValidateRequest,
    ValidateResponse,
)
from app.models.projects import (
    ProjectCreateRequest,
    ProjectListResponse,
    ProjectRecord,
    ProjectUpdateRequest,
)
from app.simulation.compiler import DiagramCompilationError
from app.simulation.service import simulate_request
from app.validation.validator import validate_diagram
from app.storage.projects import (
    ProjectNotFoundError,
    ProjectRepository,
    ProjectVersionConflictError,
    get_project_repository,
)

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _validate_project_diagram(payload: ProjectCreateRequest | ProjectUpdateRequest) -> None:
    errors = validate_diagram(payload.payload.diagram)
    if errors:
        raise HTTPException(status_code=422, detail=errors)


@router.get("/projects", response_model=ProjectListResponse)
def list_projects(
    repository: ProjectRepository = Depends(get_project_repository),
) -> ProjectListResponse:
    return ProjectListResponse(projects=repository.list())


@router.post("/projects", response_model=ProjectRecord, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreateRequest,
    repository: ProjectRepository = Depends(get_project_repository),
) -> ProjectRecord:
    _validate_project_diagram(payload)
    return repository.create(payload)


@router.get("/projects/{project_id}", response_model=ProjectRecord)
def get_project(
    project_id: str,
    repository: ProjectRepository = Depends(get_project_repository),
) -> ProjectRecord:
    try:
        return repository.get(project_id)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Проект не найден.") from exc


@router.put("/projects/{project_id}", response_model=ProjectRecord)
def update_project(
    project_id: str,
    payload: ProjectUpdateRequest,
    repository: ProjectRepository = Depends(get_project_repository),
) -> ProjectRecord:
    _validate_project_diagram(payload)
    try:
        return repository.update(project_id, payload)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Проект не найден.") from exc
    except ProjectVersionConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Проект уже изменён в другой сессии.",
                "current_version": exc.current_version,
            },
        ) from exc


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: str,
    repository: ProjectRepository = Depends(get_project_repository),
) -> Response:
    try:
        repository.delete(project_id)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Проект не найден.") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/validate", response_model=ValidateResponse)
def validate_endpoint(payload: ValidateRequest) -> ValidateResponse:
    errors = validate_diagram(payload.diagram)
    return ValidateResponse(valid=not errors, errors=errors)


@router.post("/simulate", response_model=SimulationResponse)
def simulate_endpoint(payload: SimulationRequest) -> SimulationResponse | JSONResponse:
    errors = validate_diagram(payload.diagram)
    if errors:
        response = SimulationResponse(
            success=False,
            time=[],
            outputs={},
            metadata={"requested_solver": payload.solver},
            validation_errors=errors,
        )
        return JSONResponse(status_code=422, content=response.model_dump())

    try:
        return simulate_request(payload)
    except DiagramCompilationError as exc:
        response = SimulationResponse(
            success=False,
            time=[],
            outputs={},
            metadata={"requested_solver": payload.solver},
            validation_errors=exc.errors,
        )
        return JSONResponse(status_code=422, content=response.model_dump())
    except (ValueError, RuntimeError, FloatingPointError) as exc:
        response = SimulationResponse(
            success=False,
            time=[],
            outputs={},
            metadata={"requested_solver": payload.solver},
            validation_errors=[str(exc)],
        )
        return JSONResponse(status_code=422, content=response.model_dump())
