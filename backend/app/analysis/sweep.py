"""Root locus of a block diagram: poles of A as one block parameter varies.

Each value is compiled from scratch, so the locus is exact for any parameter
that enters the model (a gain, a time constant, a PID coefficient), not only a
loop gain. A value for which the diagram cannot be assembled (an algebraic loop
that becomes singular) is reported with its reason instead of poles.
"""

from __future__ import annotations

import numpy as np

from app.analysis.stability import classify_stability
from app.models.api import SweepPoint, SweepRequest, SweepResponse
from app.simulation.model import DiagramCompilationError, compile_model


def _numeric_parameter(request: SweepRequest) -> None:
    block = next((block for block in request.diagram.blocks if block.id == request.block_id), None)
    if block is None:
        raise DiagramCompilationError([f"Блок {request.block_id} не найден на верхнем уровне схемы."])
    value = block.parameters.get(request.parameter)
    if isinstance(value, bool) or not isinstance(value, int | float):
        name = f"{request.block_id}.{request.parameter}"
        raise DiagramCompilationError([f"Параметр {name} не является числом и не может быть параметром годографа."])


def sweep_poles(request: SweepRequest) -> SweepResponse:
    _numeric_parameter(request)
    points: list[SweepPoint] = []
    for value in request.values:
        diagram = request.diagram.model_copy(deep=True)
        block = next(block for block in diagram.blocks if block.id == request.block_id)
        block.parameters[request.parameter] = float(value)
        try:
            model = compile_model(diagram).model
        except DiagramCompilationError as exc:
            points.append(SweepPoint(value=value, error="; ".join(exc.errors)))
            continue
        poles = np.linalg.eigvals(model.a) if model.state_dimension else np.zeros(0, dtype=complex)
        points.append(
            SweepPoint(
                value=value,
                poles=[{"real": float(p.real), "imag": float(p.imag)} for p in poles],
                stability=classify_stability(model.a)["status"],
            )
        )
    return SweepResponse(block_id=request.block_id, parameter=request.parameter, points=points)
