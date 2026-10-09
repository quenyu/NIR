"""Diagram -> validated flat diagram -> assembled linear model, in one pass."""

from __future__ import annotations

from dataclasses import dataclass

from app.models.diagram import Diagram
from app.simulation.assembly import LinearModel, ModelAssemblyError, assemble_linear_model
from app.validation.validator import validate_structure


class DiagramCompilationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("Не удалось скомпилировать схему.")
        self.errors = errors


@dataclass(frozen=True)
class CompiledModel:
    flat: Diagram
    model: LinearModel


def compile_model(diagram: Diagram) -> CompiledModel:
    flat, errors = validate_structure(diagram)
    if flat is None:
        raise DiagramCompilationError(errors)
    try:
        return CompiledModel(flat=flat, model=assemble_linear_model(flat))
    except ModelAssemblyError as exc:
        raise DiagramCompilationError(exc.errors) from exc
    except ValueError as exc:  # parameter combinations a block cannot realize
        raise DiagramCompilationError([str(exc)]) from exc


def diagram_errors(diagram: Diagram) -> list[str]:
    try:
        compile_model(diagram)
    except DiagramCompilationError as exc:
        return exc.errors
    return []
