from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import JSONResponse

from app.models.api import (
    AnalyzeRequest,
    AnalyzeResponse,
    SimulationRequest,
    SimulationResponse,
    ValidateRequest,
    ValidateResponse,
)
from app.models.experiments import (
    ExperimentCatalogResponse,
    ExperimentRunRequest,
    ExperimentRunResponse,
)
from app.models.tuning import PIDTuneRequest, PIDTuneResponse
from app.models.learning import SafeLearningRequest, SafeLearningResponse
from app.models.observer import ObserverExperimentRequest, ObserverExperimentResponse
from app.models.output_feedback import OutputFeedbackRequest, OutputFeedbackResponse
from app.models.projects import (
    ProjectCreateRequest,
    ProjectListResponse,
    ProjectRecord,
    ProjectUpdateRequest,
)
from app.analysis.pid_tuning import tune_pid
from app.analysis.safe_learning import run_safe_learning
from app.analysis.observer import run_observer_experiment
from app.analysis.output_feedback import run_output_feedback_experiment
from app.experiments.service import get_experiments_catalog, run_experiment
from app.analysis.system import assemble_state_space
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


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze_endpoint(payload: AnalyzeRequest) -> AnalyzeResponse | JSONResponse:
    errors = validate_diagram(payload.diagram)
    if errors:
        response = AnalyzeResponse(success=False, validation_errors=errors)
        return JSONResponse(status_code=422, content=response.model_dump())

    try:
        return AnalyzeResponse(
            success=True,
            analysis=assemble_state_space(payload.diagram),
        )
    except DiagramCompilationError as exc:
        response = AnalyzeResponse(success=False, validation_errors=exc.errors)
        return JSONResponse(status_code=422, content=response.model_dump())


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


@router.get("/experiments/catalog", response_model=ExperimentCatalogResponse)
def experiments_catalog_endpoint() -> ExperimentCatalogResponse:
    return get_experiments_catalog()


@router.post("/experiments/run", response_model=ExperimentRunResponse)
def experiments_run_endpoint(payload: ExperimentRunRequest) -> ExperimentRunResponse:
    try:
        return run_experiment(payload)
    except (ValueError, RuntimeError, FloatingPointError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/tune/pid", response_model=PIDTuneResponse)
def tune_pid_endpoint(payload: PIDTuneRequest) -> PIDTuneResponse:
    errors = validate_diagram(payload.diagram)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    try:
        return tune_pid(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/learn/safe-controller", response_model=SafeLearningResponse)
def safe_controller_learning_endpoint(payload: SafeLearningRequest) -> SafeLearningResponse:
    errors = validate_diagram(payload.diagram)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    try:
        return run_safe_learning(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/analyze/observer", response_model=ObserverExperimentResponse)
def observer_experiment_endpoint(
    payload: ObserverExperimentRequest,
) -> ObserverExperimentResponse:
    errors = validate_diagram(payload.diagram)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    try:
        return run_observer_experiment(payload)
    except (ValueError, RuntimeError, FloatingPointError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/analyze/output-feedback", response_model=OutputFeedbackResponse)
def output_feedback_experiment_endpoint(
    payload: OutputFeedbackRequest,
) -> OutputFeedbackResponse:
    errors = validate_diagram(payload.diagram)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    try:
        return run_output_feedback_experiment(payload)
    except (ValueError, RuntimeError, FloatingPointError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
