from __future__ import annotations

import numpy as np

from app.analysis.quality import compute_quality_metrics
from app.analysis.stability import analyze_transfer_function_stability
from app.analysis.system import assemble_state_space, explain_model_assembly
from app.analysis.frequency import analyze_frequency_response
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


def _step_breakpoints(compiled, start: float, end: float) -> list[float]:
    breakpoints: set[float] = set()
    for block in compiled.diagram.blocks:
        if block.type != "StepInput":
            continue
        raw_value = block.parameters.get("t0", 0.0)
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        if start < value < end:
            breakpoints.add(value)
    return sorted(breakpoints)


def _assert_rk4_absolute_stability(system_analysis: dict, maximum_step: float) -> None:
    unstable_numerical_modes: list[complex] = []
    for pole_record in system_analysis.get("poles", []):
        pole = complex(float(pole_record["real"]), float(pole_record["imag"]))
        if pole.real >= 0.0:
            continue
        z = pole * maximum_step
        amplification = 1.0 + z + z**2 / 2.0 + z**3 / 6.0 + z**4 / 24.0
        if abs(amplification) >= 1.0 + 1e-12:
            unstable_numerical_modes.append(pole)
    if unstable_numerical_modes:
        modes = ", ".join(
            f"{value.real:.4g}{value.imag:+.4g}j"
            for value in unstable_numerical_modes[:4]
        )
        raise ValueError(
            "Шаг RK4 находится вне области абсолютной устойчивости для мод: "
            f"{modes}. Уменьшите dt или выберите solve_ivp."
        )


def simulate_request(request: SimulationRequest) -> SimulationResponse:
    compiled = compile_diagram(request.diagram)
    t_eval = build_time_grid(request)
    x0 = compiled.initial_state
    system_analysis = assemble_state_space(request.diagram, compiled=compiled)
    breakpoints = _step_breakpoints(compiled, float(t_eval[0]), float(t_eval[-1]))

    if x0.size == 0:
        trajectory = np.zeros((0, t_eval.size), dtype=float)
        used_solver = "static"
    elif request.solver == "rk4":
        integration_grid = np.unique(
            np.concatenate((t_eval, np.asarray(breakpoints, dtype=float)))
        )
        _assert_rk4_absolute_stability(
            system_analysis,
            float(np.max(np.diff(integration_grid))),
        )
        integrated = rk4_integrate(
            compiled.rhs,
            x0,
            integration_grid,
            breakpoints=breakpoints,
        )
        output_indices = np.searchsorted(integration_grid, t_eval)
        if not np.allclose(
            integration_grid[output_indices],
            t_eval,
            rtol=0.0,
            atol=1e-12,
        ):
            raise RuntimeError("Не удалось сопоставить внутреннюю и выходную сетки RK4.")
        trajectory = integrated[:, output_indices]
        used_solver = "rk4"
    else:
        trajectory = solve_ivp_integrate(
            compiled.rhs,
            x0,
            t_eval,
            breakpoints=breakpoints,
        )
        used_solver = "solve_ivp"

    outputs: dict[str, list[float]] = {scope.label: [] for scope in compiled.scopes}
    references = {
        scope.label: scope.reference
        for scope in compiled.scopes
        if scope.reference is not None
    }
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
        "step_breakpoints": breakpoints,
        "provenance": explain_model_assembly(compiled),
    }

    warnings: list[str] = []
    if any(scope.reference is None for scope in compiled.scopes):
        warnings.append(
            "Для Scope без reference показатели перерегулирования и времени "
            "регулирования используют последний отсчёт как оценку установившегося значения."
        )
    if references and any(
        float(block.parameters.get("t0", 0.0)) > float(t_eval[0])
        for block in compiled.diagram.blocks
        if block.type == "StepInput"
    ):
        warnings.append(
            "В схеме есть задержанный StepInput: общие показатели качества Scope "
            "считаются от начала моделирования, поскольку Scope.reference не задаёт "
            "однозначную связь с конкретным входом. Настройка PID учитывает t0 выбранного входа."
        )

    return SimulationResponse(
        success=True,
        time=[float(value) for value in t_eval],
        outputs=outputs,
        metadata=metadata,
        stability_analysis=analyze_transfer_function_stability(request.diagram),
        system_analysis=system_analysis,
        frequency_analysis=analyze_frequency_response(system_analysis),
        quality_metrics=compute_quality_metrics(
            t_eval,
            outputs,
            references=references or None,
        ),
        warnings=warnings,
        validation_errors=[],
    )
