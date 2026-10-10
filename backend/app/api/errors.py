"""One error format for every endpoint: {"code", "message", "errors": [...]}.

Only failures caused by the request (an invalid diagram or settings, a model
the solver cannot integrate) are 4xx. Unexpected exceptions stay 500.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.simulation.model import DiagramCompilationError
from app.simulation.service import SolverSettingsError
from app.simulation.solvers import SolverError
from app.storage.projects import (
    ProjectCorruptedError,
    ProjectNotFoundError,
    ProjectPayloadTooLargeError,
    ProjectVersionConflictError,
)


def error_response(
    status_code: int,
    code: str,
    message: str,
    errors: list[dict[str, Any]] | None = None,
    **extra: Any,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "errors": errors or [], **extra},
    )


def _messages(messages: list[str]) -> list[dict[str, Any]]:
    return [{"path": None, "message": message} for message in messages]


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def request_invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"path": ".".join(str(part) for part in item["loc"][1:]) or None, "message": item["msg"]}
            for item in exc.errors()
        ]
        return error_response(422, "request_invalid", "Запрос содержит некорректные данные.", errors)

    @app.exception_handler(DiagramCompilationError)
    async def diagram_invalid(_: Request, exc: DiagramCompilationError) -> JSONResponse:
        return error_response(422, "diagram_invalid", "Схема содержит ошибки.", _messages(exc.errors))

    @app.exception_handler(SolverSettingsError)
    async def solver_settings(_: Request, exc: SolverSettingsError) -> JSONResponse:
        return error_response(422, "solver_settings", str(exc), _messages([str(exc)]))

    @app.exception_handler(SolverError)
    async def solver_failed(_: Request, exc: SolverError) -> JSONResponse:
        return error_response(422, "solver_failed", str(exc), _messages([str(exc)]))

    @app.exception_handler(ProjectNotFoundError)
    async def project_not_found(_: Request, __: ProjectNotFoundError) -> JSONResponse:
        return error_response(404, "project_not_found", "Проект не найден.")

    @app.exception_handler(ProjectVersionConflictError)
    async def project_conflict(_: Request, exc: ProjectVersionConflictError) -> JSONResponse:
        return error_response(409, "project_conflict", str(exc), current_version=exc.current_version)

    @app.exception_handler(ProjectPayloadTooLargeError)
    async def project_too_large(_: Request, exc: ProjectPayloadTooLargeError) -> JSONResponse:
        return error_response(413, "project_too_large", str(exc))

    @app.exception_handler(ProjectCorruptedError)
    async def project_corrupted(_: Request, exc: ProjectCorruptedError) -> JSONResponse:
        return error_response(500, "project_corrupted", str(exc))

    @app.exception_handler(sqlite3.OperationalError)
    async def storage_unavailable(_: Request, __: sqlite3.OperationalError) -> JSONResponse:
        return error_response(503, "storage_unavailable", "Хранилище проектов временно недоступно.")
