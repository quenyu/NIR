from __future__ import annotations

import numpy as np

from app.analysis.frequency import analyze_frequency_response
from app.analysis.quality import compute_quality_metrics, steady_state_outputs, step_instant
from app.analysis.stability import rk4_step_check
from app.analysis.system import analyze_model, explain_model_assembly
from app.models.api import SimulationRequest, SimulationResponse
from app.simulation.assembly import LinearModel
from app.simulation.model import compile_model
from app.simulation.solvers import rk4_integrate, solve_ivp_integrate


def build_time_grid(request: SimulationRequest) -> np.ndarray:
    if request.t_eval is not None:
        return np.array(request.t_eval, dtype=float)

    assert request.dt is not None  # guaranteed by request validation
    count = int(np.floor((request.t_end - request.t_start) / request.dt)) + 1
    times = request.t_start + request.dt * np.arange(count, dtype=float)
    # A remainder shorter than a millionth of dt is rounding, not a real step.
    if request.t_end - times[-1] > 1e-6 * request.dt:
        times = np.append(times, request.t_end)
    else:
        times[-1] = request.t_end
    return times


def _format_modes(modes: list[complex]) -> str:
    return ", ".join(f"{p.real:.4g}{p.imag:+.4g}j" for p in modes[:4])


def _integrate(
    model: LinearModel,
    solver: str,
    t_eval: np.ndarray,
    breakpoints: list[float],
    warnings: list[str],
) -> np.ndarray:
    if model.state_dimension == 0:
        return np.zeros((0, t_eval.size))
    if solver == "solve_ivp":
        return solve_ivp_integrate(model.rhs, model.x0, t_eval, breakpoints=breakpoints)

    grid = np.unique(np.concatenate((t_eval, np.asarray(breakpoints, dtype=float))))
    check = rk4_step_check(model.a, float(np.max(np.diff(grid))))
    if not check["stable"]:
        raise ValueError(
            "Шаг RK4 вне области устойчивости метода для мод "
            f"{_format_modes(check['unstable_modes'])}: численное решение росло бы, "
            f"хотя сама система не неустойчива. Уменьшите dt до {check['max_step']:.3g} "
            "или выберите solve_ivp."
        )
    if check["inaccurate_growing_modes"]:
        warnings.append(
            "Для растущих мод "
            f"{_format_modes(check['inaccurate_growing_modes'])} множитель роста RK4 за шаг "
            "отличается от точного более чем на 1 %: уменьшите dt для количественной точности."
        )
    trajectory = rk4_integrate(model.rhs, model.x0, grid, breakpoints=breakpoints)
    # Every requested time is an exact node of the merged grid.
    return trajectory[:, np.searchsorted(grid, t_eval)]


def simulate_request(request: SimulationRequest) -> SimulationResponse:
    compiled = compile_model(request.diagram)
    model = compiled.model
    t_eval = build_time_grid(request)
    breakpoints = model.step_breakpoints(float(t_eval[0]), float(t_eval[-1]))
    warnings: list[str] = []

    trajectory = _integrate(model, request.solver, t_eval, breakpoints, warnings)
    sources = np.stack([model.source_values(float(t)) for t in t_eval], axis=1) if model.sources \
        else np.zeros((0, t_eval.size))
    readings = model.c @ trajectory + model.d @ sources
    outputs = {scope.label: readings[index].tolist() for index, scope in enumerate(model.scopes)}

    system_analysis = analyze_model(model)
    stability = system_analysis["stability"]
    steady = steady_state_outputs(model, stability)
    steady_values = {
        scope.label: (None if steady is None else float(steady[index]))
        for index, scope in enumerate(model.scopes)
    }
    unavailable_reason = None
    if steady is None:
        unavailable_reason = (
            "Установившееся значение не существует: система неустойчива."
            if stability == "unstable"
            else "Установившееся значение не определено: система на границе устойчивости."
        )
    if len({s.t0 for s in model.sources if s.amplitude != 0.0}) > 1:
        warnings.append(
            "Ступенчатые входы включаются в разные моменты: показатели качества "
            "отсчитываются от первой ступеньки."
        )

    return SimulationResponse(
        success=True,
        time=t_eval.tolist(),
        outputs=outputs,
        metadata={
            "requested_solver": request.solver,
            "used_solver": "static" if model.state_dimension == 0 else request.solver,
            "state_dimension": model.state_dimension,
            "block_count": len(compiled.flat.blocks),
            "scope_count": len(model.scopes),
            "step_breakpoints": breakpoints,
            "provenance": explain_model_assembly(model),
        },
        system_analysis=system_analysis,
        frequency_analysis=analyze_frequency_response(model),
        quality_metrics=compute_quality_metrics(
            t_eval,
            outputs,
            steady_values=steady_values,
            t_step=step_instant(model, float(t_eval[0])),
            unavailable_reason=unavailable_reason,
            references={s.label: s.reference for s in model.scopes if s.reference is not None},
        ),
        warnings=warnings,
        validation_errors=[],
    )
