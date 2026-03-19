from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.models.api import (
    SimulationRequest,
    SimulationResponse,
    ValidateRequest,
    ValidateResponse,
)
from app.simulation.compiler import DiagramCompilationError
from app.simulation.service import simulate_request
from app.validation.validator import validate_diagram

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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

