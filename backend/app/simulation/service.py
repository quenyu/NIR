from __future__ import annotations

import numpy as np

from app.models.api import SimulationRequest, SimulationResponse
from app.simulation.compiler import compile_diagram
from app.simulation.solvers import rk4_integrate, solve_ivp_integrate


def build_time_grid(request: SimulationRequest) -> np.ndarray:
    if request.t_eval is not None:
        return np.array(request.t_eval, dtype=float)

    assert request.dt is not None  # guaranteed by request validation
    duration = request.t_end - request.t_start
    count = int(np.floor(duration / request.dt)) + 1
    times = request.t_start + request.dt * np.arange(count, dtype=float)
    if times[-1] < request.t_end:
        times = np.append(times, request.t_end)
    else:
        times[-1] = request.t_end
    return times


def simulate_request(request: SimulationRequest) -> SimulationResponse:
    compiled = compile_diagram(request.diagram)
    t_eval = build_time_grid(request)
    x0 = compiled.initial_state

    if x0.size == 0:
        trajectory = np.zeros((0, t_eval.size), dtype=float)
        used_solver = "static"
    elif request.solver == "rk4":
        trajectory = rk4_integrate(compiled.rhs, x0, t_eval)
        used_solver = "rk4"
    else:
        trajectory = solve_ivp_integrate(compiled.rhs, x0, t_eval)
        used_solver = "solve_ivp"

    outputs: dict[str, list[float]] = {scope.label: [] for scope in compiled.scopes}
    for idx, t_now in enumerate(t_eval):
        x_now = trajectory[:, idx] if x0.size > 0 else np.zeros(0, dtype=float)
        scope_values = compiled.evaluate_scopes(float(t_now), x_now)
        for label, value in scope_values.items():
            outputs[label].append(float(value))

    metadata = {
        "requested_solver": request.solver,
        "used_solver": used_solver,
        "state_dimension": int(x0.size),
        "block_count": len(request.diagram.blocks),
        "scope_count": len(compiled.scopes),
    }

    return SimulationResponse(
        success=True,
        time=[float(value) for value in t_eval],
        outputs=outputs,
        metadata=metadata,
        validation_errors=[],
    )

