from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.optimize import differential_evolution

from app.core.block_specs import get_numeric_parameter
from app.models.api import SimulationRequest
from app.models.diagram import Block, Diagram
from app.models.tuning import PIDTuneRequest, PIDTuneResponse
from app.simulation.hierarchy import flatten_diagram
from app.simulation.service import simulate_request


@dataclass(frozen=True)
class ObjectiveResult:
    score: float
    metrics: dict[str, float | None]


@dataclass(frozen=True)
class ReferenceDefinition:
    output_label: str
    target: float
    start_time: float
    input_block_id: str | None


def _controller_parameters(diagram: Diagram, block_id: str) -> dict[str, Any]:
    parts = block_id.split("::")
    blocks: list[Block] | list[dict[str, Any]] = diagram.blocks

    for index, part in enumerate(parts):
        candidate: Block | dict[str, Any] | None = None
        for block in blocks:
            current_id = block.id if isinstance(block, Block) else str(block.get("id", ""))
            if current_id == part:
                candidate = block
                break
        if candidate is None:
            raise ValueError(f"PID-регулятор '{block_id}' не найден.")

        block_type = candidate.type if isinstance(candidate, Block) else str(candidate.get("type", ""))
        parameters = candidate.parameters if isinstance(candidate, Block) else candidate.setdefault("parameters", {})
        if not isinstance(parameters, dict):
            raise ValueError(f"Блок '{part}' содержит некорректные параметры.")

        if index == len(parts) - 1:
            if block_type != "PIDController":
                raise ValueError(f"Блок '{block_id}' не является PIDController.")
            return parameters

        if block_type != "Subsystem":
            raise ValueError(f"Путь '{block_id}' проходит через блок, который не является Subsystem.")
        nested = parameters.get("diagram")
        if not isinstance(nested, dict) or not isinstance(nested.get("blocks"), list):
            raise ValueError(f"Подсистема '{part}' не содержит корректную схему.")
        blocks = nested["blocks"]

    raise ValueError(f"PID-регулятор '{block_id}' не найден.")


def _reference_definition(
    diagram: Diagram,
    *,
    scope_label: str | None,
    input_block_id: str | None,
) -> ReferenceDefinition:
    flattened = flatten_diagram(diagram)
    scopes = [block for block in flattened.blocks if block.type == "Scope"]
    if not scopes:
        raise ValueError("Для настройки PID требуется хотя бы один Scope.")

    selected_scope = None
    for scope in scopes:
        label = str(scope.parameters.get("label") or "").strip() or scope.id
        if scope_label is None or label == scope_label:
            selected_scope = scope
            scope_label = label
            break
    if selected_scope is None or scope_label is None:
        raise ValueError(f"Scope с именем '{scope_label}' не найден.")

    step_inputs = [block for block in flattened.blocks if block.type == "StepInput"]
    selected_input = None
    if input_block_id is not None:
        selected_input = next(
            (block for block in step_inputs if block.id == input_block_id),
            None,
        )
        if selected_input is None:
            raise ValueError(f"Ступенчатый вход '{input_block_id}' не найден.")
    elif len(step_inputs) == 1:
        selected_input = step_inputs[0]
    elif len(step_inputs) > 1:
        raise ValueError(
            "В схеме несколько StepInput; укажите reference_input_block_id для настройки PID."
        )

    if "reference" in selected_scope.parameters:
        target = get_numeric_parameter(selected_scope.parameters, "reference", 0.0)
    elif selected_input is not None:
        target = get_numeric_parameter(selected_input.parameters, "amplitude", 1.0)
    else:
        raise ValueError(
            "Не удалось определить задание: добавьте StepInput или reference у выбранного Scope."
        )
    start_time = (
        get_numeric_parameter(selected_input.parameters, "t0", 0.0)
        if selected_input is not None
        else 0.0
    )
    return ReferenceDefinition(
        output_label=scope_label,
        target=target,
        start_time=start_time,
        input_block_id=selected_input.id if selected_input is not None else None,
    )


def _settling_time(
    time: np.ndarray,
    error: np.ndarray,
    reference: float,
    start_time: float,
) -> float | None:
    tolerance = max(abs(reference) * 0.02, 1e-6)
    active = np.flatnonzero(time >= start_time)
    if active.size == 0:
        return None
    outside = active[np.abs(error[active]) > tolerance]
    if outside.size == 0:
        return max(0.0, float(time[int(active[0])] - start_time))
    last = int(outside[-1])
    if last >= time.size - 1:
        return None
    return max(0.0, float(time[last + 1] - start_time))


def _evaluate(
    diagram: Diagram,
    controller_block_id: str,
    gains: tuple[float, float, float] | np.ndarray,
    *,
    scope_label: str | None,
    reference: ReferenceDefinition,
    t_end: float,
    dt: float,
) -> ObjectiveResult:
    candidate = diagram.model_copy(deep=True)
    controller_parameters = _controller_parameters(candidate, controller_block_id)
    kp, ki, kd = (float(value) for value in gains)
    controller_parameters.update({"kp": kp, "ki": ki, "kd": kd})

    try:
        response = simulate_request(
            SimulationRequest(
                diagram=candidate,
                t_end=t_end,
                dt=dt,
                solver="rk4",
            )
        )
    except (ValueError, RuntimeError, FloatingPointError):
        return ObjectiveResult(1e12, {})

    if response.system_analysis.get("stability") != "stable":
        return ObjectiveResult(1e10, {"stable": 0.0})

    selected_label = scope_label or reference.output_label
    if selected_label is None or selected_label not in response.outputs:
        return ObjectiveResult(1e12, {})

    time = np.asarray(response.time, dtype=float)
    output = np.asarray(response.outputs[selected_label], dtype=float)
    if output.size != time.size or not np.all(np.isfinite(output)) or np.max(np.abs(output)) > 1e8:
        return ObjectiveResult(1e12, {})

    reference_values = np.where(
        time >= reference.start_time,
        reference.target,
        0.0,
    )
    error = reference_values - output
    iae = float(np.trapezoid(np.abs(error), time))
    ise = float(np.trapezoid(error * error, time))
    final_error = float(error[-1])
    active_output = output[time >= reference.start_time]
    if abs(reference.target) > 1e-12 and active_output.size:
        if reference.target > 0.0:
            overshoot = max(
                0.0,
                (float(np.max(active_output)) - reference.target)
                / abs(reference.target)
                * 100.0,
            )
        else:
            overshoot = max(
                0.0,
                (reference.target - float(np.min(active_output)))
                / abs(reference.target)
                * 100.0,
            )
    else:
        overshoot = 0.0
    settling = _settling_time(
        time,
        error,
        reference.target,
        reference.start_time,
    )

    score = (
        iae
        + 0.20 * ise
        + 0.025 * overshoot
        + 2.0 * abs(final_error)
        + 1e-4 * (kp * kp + ki * ki + kd * kd)
    )
    if settling is None:
        score += t_end
    else:
        score += 0.05 * settling

    return ObjectiveResult(
        float(score),
        {
            "iae": iae,
            "ise": ise,
            "final_error": final_error,
            "overshoot_percent": overshoot,
            "settling_time": settling,
            "stable": 1.0,
            "reference": reference.target,
            "reference_start_time": reference.start_time,
        },
    )


def tune_pid(request: PIDTuneRequest) -> PIDTuneResponse:
    controller_parameters = _controller_parameters(request.diagram, request.controller_block_id)
    initial = {
        "kp": get_numeric_parameter(controller_parameters, "kp", 1.0),
        "ki": get_numeric_parameter(controller_parameters, "ki", 0.0),
        "kd": get_numeric_parameter(controller_parameters, "kd", 0.0),
        "filter_n": get_numeric_parameter(controller_parameters, "filter_n", 20.0),
    }
    evaluation_count = 0
    reference = _reference_definition(
        request.diagram,
        scope_label=request.scope_label,
        input_block_id=request.reference_input_block_id,
    )
    if reference.start_time >= request.t_end:
        raise ValueError(
            "Момент начала задания должен быть меньше горизонта настройки PID."
        )

    def objective(values: np.ndarray) -> float:
        nonlocal evaluation_count
        evaluation_count += 1
        return _evaluate(
            request.diagram,
            request.controller_block_id,
            values,
            scope_label=reference.output_label,
            reference=reference,
            t_end=request.t_end,
            dt=request.dt,
        ).score

    initial_result = _evaluate(
        request.diagram,
        request.controller_block_id,
        (initial["kp"], initial["ki"], initial["kd"]),
        scope_label=reference.output_label,
        reference=reference,
        t_end=request.t_end,
        dt=request.dt,
    )

    result = differential_evolution(
        objective,
        bounds=[request.kp_bounds, request.ki_bounds, request.kd_bounds],
        maxiter=request.max_iterations,
        popsize=5,
        seed=request.seed,
        # A local polishing phase adds hundreds of full simulations. The
        # evolutionary result is already accurate enough for interactive use.
        polish=False,
        updating="immediate",
        workers=1,
        tol=1e-3,
    )
    tuned_values = tuple(float(value) for value in result.x)
    tuned_result = _evaluate(
        request.diagram,
        request.controller_block_id,
        tuned_values,
        scope_label=reference.output_label,
        reference=reference,
        t_end=request.t_end,
        dt=request.dt,
    )

    if tuned_result.score >= initial_result.score:
        tuned_values = (initial["kp"], initial["ki"], initial["kd"])
        tuned_result = initial_result

    improvement = (
        max(0.0, (initial_result.score - tuned_result.score) / initial_result.score * 100.0)
        if initial_result.score > 1e-12 and np.isfinite(initial_result.score)
        else 0.0
    )

    return PIDTuneResponse(
        success=True,
        controller_block_id=request.controller_block_id,
        initial_parameters=initial,
        tuned_parameters={
            "kp": tuned_values[0],
            "ki": tuned_values[1],
            "kd": tuned_values[2],
            "filter_n": initial["filter_n"],
        },
        initial_score=initial_result.score,
        tuned_score=tuned_result.score,
        improvement_percent=improvement,
        metrics=tuned_result.metrics,
        evaluations=evaluation_count,
        warnings=(
            [
                "Модель PID использует фильтрованную производную, но не содержит "
                "насыщения исполнительного механизма и anti-windup.",
                "Настройка является численной оптимизацией на выбранном сценарии, "
                "а не доказательством робастной устойчивости.",
            ]
            + (
                []
                if result.success
                else [
                    "Оптимизатор остановлен по лимиту итераций; возвращено лучшее найденное решение."
                ]
            )
        ),
    )
