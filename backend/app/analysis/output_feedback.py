from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.linalg import solve_discrete_are
from scipy.signal import cont2discrete

from app.analysis.observer import _kalman_gain, _luenberger_gain
from app.analysis.system import assemble_state_space
from app.models.output_feedback import (
    OutputFeedbackDesign,
    OutputFeedbackMetrics,
    OutputFeedbackRequest,
    OutputFeedbackResponse,
    OutputFeedbackTrace,
)


def _matrix_rank_reachability(a: np.ndarray, b: np.ndarray) -> int:
    n = a.shape[0]
    columns = [b]
    current = b
    for _ in range(1, n):
        current = a @ current
        columns.append(current)
    return int(np.linalg.matrix_rank(np.hstack(columns)))


def _matrix_rank_observability(a: np.ndarray, c: np.ndarray) -> int:
    n = a.shape[0]
    rows = [c]
    current = c
    for _ in range(1, n):
        current = current @ a
        rows.append(current)
    return int(np.linalg.matrix_rank(np.vstack(rows)))


def _complex_rows(values: np.ndarray) -> list[dict[str, float]]:
    return [
        {"real": float(np.real(value)), "imag": float(np.imag(value))}
        for value in values
    ]


def _discrete_lqr(
    ad: np.ndarray,
    bd: np.ndarray,
    state_weight: float,
    control_weight: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    q = state_weight * np.eye(ad.shape[0], dtype=float)
    r = np.asarray([[control_weight]], dtype=float)
    try:
        p = solve_discrete_are(ad, bd, q, r)
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            "Не удалось решить дискретное уравнение Риккати для LQR. "
            "Проверьте управляемость выбранного входа."
        ) from exc
    gain = np.linalg.solve(r + bd.T @ p @ bd, bd.T @ p @ ad)
    poles = np.linalg.eigvals(ad - bd @ gain)
    return gain, poles, p


@dataclass(frozen=True)
class _Run:
    states: np.ndarray
    estimates: np.ndarray | None
    outputs: np.ndarray
    controls: np.ndarray
    state_norms: np.ndarray
    estimation_error_norms: np.ndarray | None
    saturation_count: int


@dataclass(frozen=True)
class _TrackingDesign:
    prefilter_gain: float
    equilibrium_state_per_reference: np.ndarray
    equilibrium_control_per_reference: float


def _tracking_prefilter(
    *,
    ad: np.ndarray,
    bd: np.ndarray,
    c: np.ndarray,
    direct_gain: float,
    feedback_gain: np.ndarray,
) -> _TrackingDesign:
    """Return the SISO static prefilter for u = -K x_hat + N r."""
    closed_loop = ad - bd @ feedback_gain
    try:
        state_per_feedforward = np.linalg.solve(
            np.eye(ad.shape[0], dtype=float) - closed_loop,
            bd[:, 0],
        )
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            "Не удалось вычислить установившийся режим для постоянного задания."
        ) from exc
    output_per_feedforward = float(
        ((c - direct_gain * feedback_gain) @ state_per_feedforward).item()
        + direct_gain
    )
    if not np.isfinite(output_per_feedforward) or abs(output_per_feedforward) <= 1e-10:
        raise ValueError(
            "Для выбранных входа и выхода статический префильтр задания не существует: "
            "замкнутый канал имеет нулевой коэффициент передачи на постоянном сигнале."
        )
    prefilter_gain = 1.0 / output_per_feedforward
    equilibrium_state_per_reference = state_per_feedforward * prefilter_gain
    equilibrium_control_per_reference = float(
        prefilter_gain
        - (feedback_gain @ equilibrium_state_per_reference).item()
    )
    return _TrackingDesign(
        prefilter_gain=float(prefilter_gain),
        equilibrium_state_per_reference=equilibrium_state_per_reference,
        equilibrium_control_per_reference=equilibrium_control_per_reference,
    )


def _simulate_controller(
    *,
    ad: np.ndarray,
    bd: np.ndarray,
    c: np.ndarray,
    direct_gain: float,
    feedback_gain: np.ndarray,
    observer_gain: np.ndarray | None,
    initial_state: np.ndarray,
    process_noise: np.ndarray,
    measurement_noise: np.ndarray,
    control_limit: float,
    reference: float,
    prefilter_gain: float,
    equilibrium_state: np.ndarray,
) -> _Run:
    interval_count = process_noise.shape[0]
    n = ad.shape[0]
    state = initial_state.copy()
    estimate = np.zeros(n, dtype=float) if observer_gain is not None else None
    states = np.zeros((interval_count + 1, n), dtype=float)
    estimates = (
        np.zeros_like(states) if observer_gain is not None else None
    )
    outputs = np.zeros(interval_count + 1, dtype=float)
    controls = np.zeros(interval_count + 1, dtype=float)
    saturation_count = 0

    for index in range(interval_count + 1):
        if index < interval_count:
            feedback_state = state if estimate is None else estimate
            raw_control = float(
                -(feedback_gain @ feedback_state).item()
                + prefilter_gain * reference
            )
            control = float(np.clip(raw_control, -control_limit, control_limit))
            saturation_count += int(abs(raw_control) > control_limit + 1e-12)
        else:
            # The last value is the command held over the final sample interval;
            # it is displayed but is not counted as a new control decision.
            control = float(controls[index - 1]) if index > 0 else 0.0

        noiseless_output = float((c @ state).item() + direct_gain * control)
        states[index] = state
        outputs[index] = noiseless_output
        controls[index] = control
        if estimates is not None and estimate is not None:
            estimates[index] = estimate

        if index == interval_count:
            continue

        if estimate is not None and observer_gain is not None:
            measured_output = noiseless_output + measurement_noise[index]
            predicted_output = float((c @ estimate).item() + direct_gain * control)
            innovation = measured_output - predicted_output
            estimate = (
                ad @ estimate
                + bd[:, 0] * control
                + observer_gain[:, 0] * innovation
            )
        state = ad @ state + bd[:, 0] * control + process_noise[index]

    state_norms = np.linalg.norm(states - equilibrium_state, axis=1)
    estimation_error_norms = (
        np.linalg.norm(states - estimates, axis=1) if estimates is not None else None
    )
    return _Run(
        states=states,
        estimates=estimates,
        outputs=outputs,
        controls=controls,
        state_norms=state_norms,
        estimation_error_norms=estimation_error_norms,
        saturation_count=saturation_count,
    )


def _run_metrics(
    method: str,
    run: _Run,
    state_weight: float,
    control_weight: float,
    reference: float,
    equilibrium_state: np.ndarray,
    equilibrium_control: float,
) -> OutputFeedbackMetrics:
    transition_states = run.states[:-1] - equilibrium_state
    transition_controls = run.controls[:-1]
    interval_count = max(1, transition_controls.size)
    state_cost = state_weight * np.sum(transition_states**2, axis=1)
    control_cost = control_weight * (transition_controls - equilibrium_control) ** 2
    tracking_errors = reference - run.outputs
    estimation_rmse = None
    final_estimation_error_norm = None
    if run.estimates is not None and run.estimation_error_norms is not None:
        estimation_rmse = float(
            np.sqrt(np.mean(np.sum((run.states - run.estimates) ** 2, axis=1)))
        )
        final_estimation_error_norm = float(run.estimation_error_norms[-1])
    return OutputFeedbackMetrics(
        method=method,
        state_rms=float(np.sqrt(np.mean(run.state_norms**2))),
        final_state_norm=float(run.state_norms[-1]),
        peak_state_norm=float(np.max(run.state_norms)),
        output_rms=float(np.sqrt(np.mean(run.outputs**2))),
        control_rms=float(np.sqrt(np.mean(transition_controls**2))),
        peak_control=float(np.max(np.abs(transition_controls))),
        saturation_percent=float(100.0 * run.saturation_count / interval_count),
        quadratic_cost_per_step=float(np.mean(state_cost + control_cost)),
        tracking_rmse=float(np.sqrt(np.mean(tracking_errors**2))),
        final_output=float(run.outputs[-1]),
        steady_state_error=float(tracking_errors[-1]),
        estimation_rmse=estimation_rmse,
        final_estimation_error_norm=final_estimation_error_norm,
    )


def _output_feedback_design(
    *,
    method: str,
    name: str,
    ad: np.ndarray,
    bd: np.ndarray,
    c: np.ndarray,
    feedback_gain: np.ndarray,
    controller_poles: np.ndarray,
    observer_gain: np.ndarray,
    observer_poles: np.ndarray,
    interpretation: str,
) -> OutputFeedbackDesign:
    n = ad.shape[0]
    augmented_matrix = np.block(
        [
            [ad - bd @ feedback_gain, bd @ feedback_gain],
            [np.zeros((n, n), dtype=float), ad - observer_gain @ c],
        ]
    )
    augmented_poles = np.linalg.eigvals(augmented_matrix)
    expected = np.concatenate([controller_poles, observer_poles])
    separation_matches = bool(
        np.allclose(
            np.sort_complex(augmented_poles),
            np.sort_complex(expected),
            rtol=1e-8,
            atol=1e-10,
        )
    )
    spectral_radius = float(np.max(np.abs(augmented_poles)))
    return OutputFeedbackDesign(
        method=method,
        name=name,
        feedback_gain=feedback_gain.tolist(),
        controller_poles=_complex_rows(controller_poles),
        observer_poles=_complex_rows(observer_poles),
        augmented_poles=_complex_rows(augmented_poles),
        spectral_radius=spectral_radius,
        asymptotically_stable=spectral_radius < 1.0,
        separation_matches=separation_matches,
        interpretation=interpretation,
    )


def run_output_feedback_experiment(
    request: OutputFeedbackRequest,
) -> OutputFeedbackResponse:
    system = assemble_state_space(request.diagram)
    n = int(system["state_dimension"])
    m = int(system["input_dimension"])
    p = int(system["output_dimension"])
    if n == 0:
        raise ValueError("LQG-контур требует динамическую модель хотя бы первого порядка.")
    if m == 0:
        raise ValueError("В модели нет канала управления StepInput.")
    if p == 0:
        raise ValueError("В модели нет измеряемого выхода Scope.")

    input_ids = list(system["input_blocks"])
    output_labels = list(system["output_labels"])
    input_id = request.input_block_id or input_ids[0]
    output_label = request.output_label or output_labels[0]
    if input_id not in input_ids:
        raise ValueError(f"Канал управления '{input_id}' не найден в модели.")
    if output_label not in output_labels:
        raise ValueError(f"Выход '{output_label}' не найден в модели.")
    input_index = input_ids.index(input_id)
    output_index = output_labels.index(output_label)

    matrices = system["matrices"]
    a = np.asarray(matrices["A"], dtype=float)
    b_all = np.asarray(matrices["B"], dtype=float)
    c_all = np.asarray(matrices["C"], dtype=float)
    d_all = np.asarray(matrices["D"], dtype=float)
    c = c_all[[output_index], :]
    d = d_all[[output_index], :]
    ad, bd_all, _, _, _ = cont2discrete((a, b_all, c, d), request.dt, method="zoh")
    bd = bd_all[:, [input_index]]
    direct_gain = float(d[0, input_index])

    controllability_rank = _matrix_rank_reachability(ad, bd)
    observability_rank = _matrix_rank_observability(ad, c)
    if controllability_rank != n:
        raise ValueError(
            f"Вход '{input_id}' не обеспечивает полную управляемость дискретной пары: "
            f"rank(C)={controllability_rank}, требуется {n}."
        )
    if observability_rank != n:
        raise ValueError(
            f"Выход '{output_label}' не обеспечивает полную наблюдаемость дискретной пары: "
            f"rank(O)={observability_rank}, требуется {n}."
        )

    feedback_gain, controller_poles, riccati = _discrete_lqr(
        ad, bd, request.state_weight, request.control_weight
    )
    tracking = _tracking_prefilter(
        ad=ad,
        bd=bd,
        c=c,
        direct_gain=direct_gain,
        feedback_gain=feedback_gain,
    )
    equilibrium_state = tracking.equilibrium_state_per_reference * request.reference
    equilibrium_control = tracking.equilibrium_control_per_reference * request.reference
    luenberger_gain, luenberger_poles, desired_poles = _luenberger_gain(
        a, ad, c, request.dt, request.observer_speed_factor
    )
    kalman_gain, kalman_poles, kalman_covariance = _kalman_gain(
        ad,
        c,
        request.process_noise_std**2,
        request.measurement_noise_std**2,
    )

    interval_count = int(round(request.horizon / request.dt))
    time = np.linspace(0.0, request.horizon, interval_count + 1)
    rng = np.random.default_rng(request.seed)
    direction = rng.normal(size=n)
    norm = float(np.linalg.norm(direction))
    if norm <= 1e-12:
        direction = np.ones(n, dtype=float)
        norm = float(np.sqrt(n))
    initial_state = request.initial_state_scale * direction / norm
    process_noise = rng.normal(
        scale=request.process_noise_std,
        size=(interval_count, n),
    )
    measurement_noise = rng.normal(
        scale=request.measurement_noise_std,
        size=interval_count + 1,
    )

    full_state = _simulate_controller(
        ad=ad,
        bd=bd,
        c=c,
        direct_gain=direct_gain,
        feedback_gain=feedback_gain,
        observer_gain=None,
        initial_state=initial_state,
        process_noise=process_noise,
        measurement_noise=measurement_noise,
        control_limit=request.control_limit,
        reference=request.reference,
        prefilter_gain=tracking.prefilter_gain,
        equilibrium_state=equilibrium_state,
    )
    luenberger = _simulate_controller(
        ad=ad,
        bd=bd,
        c=c,
        direct_gain=direct_gain,
        feedback_gain=feedback_gain,
        observer_gain=luenberger_gain,
        initial_state=initial_state,
        process_noise=process_noise,
        measurement_noise=measurement_noise,
        control_limit=request.control_limit,
        reference=request.reference,
        prefilter_gain=tracking.prefilter_gain,
        equilibrium_state=equilibrium_state,
    )
    kalman = _simulate_controller(
        ad=ad,
        bd=bd,
        c=c,
        direct_gain=direct_gain,
        feedback_gain=feedback_gain,
        observer_gain=kalman_gain,
        initial_state=initial_state,
        process_noise=process_noise,
        measurement_noise=measurement_noise,
        control_limit=request.control_limit,
        reference=request.reference,
        prefilter_gain=tracking.prefilter_gain,
        equilibrium_state=equilibrium_state,
    )

    controller_radius = float(np.max(np.abs(controller_poles)))
    designs = [
        OutputFeedbackDesign(
            method="full_state_lqr",
            name="LQR по полному состоянию",
            feedback_gain=feedback_gain.tolist(),
            controller_poles=_complex_rows(controller_poles),
            observer_poles=[],
            augmented_poles=_complex_rows(controller_poles),
            spectral_radius=controller_radius,
            asymptotically_stable=controller_radius < 1.0,
            separation_matches=None,
            interpretation="Эталон: регулятор использует истинное состояние x и тот же префильтр N.",
        ),
        _output_feedback_design(
            method="luenberger_lqr",
            name="LQR + Люенбергер",
            ad=ad,
            bd=bd,
            c=c,
            feedback_gain=feedback_gain,
            controller_poles=controller_poles,
            observer_gain=luenberger_gain,
            observer_poles=luenberger_poles,
            interpretation="Управление u = −Kx̂ + Nr, оценка по полюсам Ad − LC.",
        ),
        _output_feedback_design(
            method="lqg",
            name="LQG (LQR + Калман)",
            ad=ad,
            bd=bd,
            c=c,
            feedback_gain=feedback_gain,
            controller_poles=controller_poles,
            observer_gain=kalman_gain,
            observer_poles=kalman_poles,
            interpretation="Управление u = −Kx̂ + Nr, оценка стационарным фильтром Калмана.",
        ),
    ]
    metrics = [
        _run_metrics(
            "full_state_lqr",
            full_state,
            request.state_weight,
            request.control_weight,
            request.reference,
            equilibrium_state,
            equilibrium_control,
        ),
        _run_metrics(
            "luenberger_lqr",
            luenberger,
            request.state_weight,
            request.control_weight,
            request.reference,
            equilibrium_state,
            equilibrium_control,
        ),
        _run_metrics(
            "lqg",
            kalman,
            request.state_weight,
            request.control_weight,
            request.reference,
            equilibrium_state,
            equilibrium_control,
        ),
    ]

    warnings: list[str] = []
    saturated = [item for item in metrics if item.saturation_percent > 0.0]
    if saturated:
        methods = ", ".join(item.method for item in saturated)
        warnings.append(
            "Насыщение сработало в контурах: "
            f"{methods}. Принцип разделения доказывает только локальную линейную "
            "устойчивость в области, где ограничение управления не активно."
        )
    if request.process_noise_std == 0.0 and request.measurement_noise_std == 0.0:
        warnings.append(
            "Для синтеза Калмана использованы малые положительные проектные ковариации, "
            "поскольку оба заданных шума равны нулю."
        )
    if abs(equilibrium_control) > request.control_limit + 1e-12:
        warnings.append(
            "Для точного установившегося слежения требуется "
            f"u_ss={equilibrium_control:.6g}, что превышает заданное ограничение "
            f"|u|≤{request.control_limit:.6g}. Нулевая статическая ошибка недостижима."
        )
    if abs(request.reference) > 1e-12:
        warnings.append(
            "Префильтр N устраняет статическую ошибку для постоянного задания в номинальной "
            "линейной модели. Постоянное возмущение или ошибка параметров требуют интегрального действия."
        )

    assert luenberger.estimates is not None
    assert kalman.estimates is not None
    assert luenberger.estimation_error_norms is not None
    assert kalman.estimation_error_norms is not None
    return OutputFeedbackResponse(
        success=True,
        model={
            "state_dimension": n,
            "input_dimension": m,
            "output_dimension": p,
            "input_block_id": input_id,
            "output_label": output_label,
            "state_labels": system["state_labels"],
            "controllability_rank": controllability_rank,
            "observability_rank": observability_rank,
            "fully_controllable": True,
            "fully_observable": True,
            "Ad": ad.tolist(),
            "Bd_control": bd.tolist(),
            "C_measurement": c.tolist(),
            "D_measurement_control": direct_gain,
            "prefilter_gain": tracking.prefilter_gain,
            "equilibrium_state": equilibrium_state.tolist(),
            "equilibrium_control": equilibrium_control,
        },
        settings={
            "sample_time": request.dt,
            "horizon": request.horizon,
            "state_weight": request.state_weight,
            "control_weight": request.control_weight,
            "control_limit": request.control_limit,
            "reference": request.reference,
            "process_noise_std_per_sample": request.process_noise_std,
            "measurement_noise_std": request.measurement_noise_std,
            "initial_state_scale": request.initial_state_scale,
            "seed": request.seed,
            "luenberger_desired_poles": desired_poles,
            "lqr_riccati_matrix": riccati.tolist(),
            "kalman_covariance": kalman_covariance.tolist(),
        },
        designs=designs,
        metrics=metrics,
        trace=OutputFeedbackTrace(
            time=time.tolist(),
            state_labels=list(system["state_labels"]),
            full_state_states=full_state.states.T.tolist(),
            luenberger_states=luenberger.states.T.tolist(),
            kalman_states=kalman.states.T.tolist(),
            luenberger_estimates=luenberger.estimates.T.tolist(),
            kalman_estimates=kalman.estimates.T.tolist(),
            full_state_norm=full_state.state_norms.tolist(),
            luenberger_state_norm=luenberger.state_norms.tolist(),
            kalman_state_norm=kalman.state_norms.tolist(),
            luenberger_estimation_error_norm=luenberger.estimation_error_norms.tolist(),
            kalman_estimation_error_norm=kalman.estimation_error_norms.tolist(),
            full_state_output=full_state.outputs.tolist(),
            luenberger_output=luenberger.outputs.tolist(),
            kalman_output=kalman.outputs.tolist(),
            full_state_control=full_state.controls.tolist(),
            luenberger_control=luenberger.controls.tolist(),
            kalman_control=kalman.controls.tolist(),
        ),
        warnings=warnings,
    )
