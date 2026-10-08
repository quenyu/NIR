from __future__ import annotations

import numpy as np
from scipy.linalg import solve_discrete_are
from scipy.signal import cont2discrete, place_poles

from app.analysis.system import assemble_state_space
from app.models.observer import (
    ObserverExperimentRequest,
    ObserverExperimentResponse,
    ObserverMetrics,
    ObserverSummary,
    ObserverTrace,
)


def _rank_observability(a: np.ndarray, c: np.ndarray) -> int:
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


def _luenberger_gain(
    a: np.ndarray,
    ad: np.ndarray,
    c: np.ndarray,
    dt: float,
    speed_factor: float,
) -> tuple[np.ndarray, np.ndarray, list[float]]:
    n = ad.shape[0]
    continuous_poles = np.linalg.eigvals(a)
    characteristic_rate = max(
        1.0,
        float(np.max(np.abs(continuous_poles))) if continuous_poles.size else 1.0,
    )
    desired_s = -speed_factor * characteristic_rate * (
        1.0 + 0.15 * np.arange(n, dtype=float)
    )
    desired_z = np.exp(desired_s * dt)
    try:
        gain = place_poles(ad.T, c.T, desired_z, method="YT").gain_matrix.T
    except ValueError as exc:
        raise ValueError(
            "Не удалось разместить полюса наблюдателя для выбранного выхода. "
            "Проверьте полную наблюдаемость модели."
        ) from exc
    actual_poles = np.linalg.eigvals(ad - gain @ c)
    return gain, actual_poles, desired_z.tolist()


def _kalman_gain(
    ad: np.ndarray,
    c: np.ndarray,
    process_variance: float,
    measurement_variance: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = ad.shape[0]
    p = c.shape[0]
    q = np.eye(n, dtype=float) * max(process_variance, 1e-12)
    r = np.eye(p, dtype=float) * max(measurement_variance, 1e-12)
    try:
        covariance = solve_discrete_are(ad.T, c.T, q, r)
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            "Не удалось решить дискретное уравнение Риккати для фильтра Калмана."
        ) from exc
    innovation_covariance = c @ covariance @ c.T + r
    gain = ad @ covariance @ c.T @ np.linalg.inv(innovation_covariance)
    poles = np.linalg.eigvals(ad - gain @ c)
    return gain, poles, covariance


def _metrics(
    method: str,
    true_states: np.ndarray,
    estimates: np.ndarray,
    innovations: np.ndarray,
    covariance: np.ndarray | None,
) -> ObserverMetrics:
    errors = true_states - estimates
    norms = np.linalg.norm(errors, axis=1)
    baseline = np.linalg.norm(true_states, axis=1)
    burn_in = max(1, int(round(0.2 * errors.shape[0])))
    state_rmse = float(np.sqrt(np.mean(np.sum(errors**2, axis=1))))
    baseline_rmse = float(np.sqrt(np.mean(np.sum(true_states**2, axis=1))))
    improvement = (
        100.0 * (1.0 - state_rmse / baseline_rmse)
        if baseline_rmse > 1e-12
        else 0.0
    )
    coverage = None
    if covariance is not None:
        sigma = np.sqrt(np.maximum(np.diag(covariance), 0.0))
        steady_errors = np.abs(errors[burn_in:])
        coverage = float(100.0 * np.mean(steady_errors <= 3.0 * sigma))
    return ObserverMetrics(
        method=method,
        state_rmse=state_rmse,
        steady_state_rmse=float(
            np.sqrt(np.mean(np.sum(errors[burn_in:] ** 2, axis=1)))
        ),
        rmse_by_state=np.sqrt(np.mean(errors**2, axis=0)).tolist(),
        mean_error_norm=float(np.mean(norms)),
        max_error_norm=float(np.max(norms)),
        final_error_norm=float(norms[-1]),
        innovation_rms=float(np.sqrt(np.mean(innovations**2))),
        improvement_over_zero_estimate_percent=improvement,
        three_sigma_coverage_percent=coverage,
    )


def run_observer_experiment(
    request: ObserverExperimentRequest,
) -> ObserverExperimentResponse:
    system = assemble_state_space(request.diagram)
    n = int(system["state_dimension"])
    m = int(system["input_dimension"])
    p = int(system["output_dimension"])
    if n == 0:
        raise ValueError("Наблюдатель требует динамическую модель хотя бы первого порядка.")
    if m == 0:
        raise ValueError("В модели нет внешнего входа StepInput.")
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
    b = np.asarray(matrices["B"], dtype=float)
    c_all = np.asarray(matrices["C"], dtype=float)
    d_all = np.asarray(matrices["D"], dtype=float)
    c = c_all[[output_index], :]
    d = d_all[[output_index], :]
    ad, bd, _, _, _ = cont2discrete((a, b, c, d), request.dt, method="zoh")
    # The implemented observers run on the sampled ZOH model.  Continuous-time
    # observability alone is insufficient at exceptional sampling periods, where
    # distinct continuous modes can alias to the same discrete mode.
    rank = _rank_observability(ad, c)
    if rank != n:
        raise ValueError(
            f"Выход '{output_label}' не обеспечивает полную наблюдаемость: "
            f"rank(O)={rank}, требуется {n}. Добавьте или выберите другой Scope."
        )

    luenberger_gain, luenberger_poles, desired_poles = _luenberger_gain(
        a, ad, c, request.dt, request.observer_speed_factor
    )
    kalman_gain, kalman_poles, covariance = _kalman_gain(
        ad,
        c,
        request.process_noise_std**2,
        request.measurement_noise_std**2,
    )

    interval_count = int(round(request.horizon / request.dt))
    time = np.linspace(0.0, request.horizon, interval_count + 1)
    rng = np.random.default_rng(request.seed)
    direction = rng.normal(size=n)
    direction_norm = float(np.linalg.norm(direction))
    if direction_norm <= 1e-12:
        direction = np.ones(n, dtype=float)
        direction_norm = float(np.sqrt(n))
    true_state = request.initial_state_scale * direction / direction_norm
    luenberger_state = np.zeros(n, dtype=float)
    kalman_state = np.zeros(n, dtype=float)

    true_states = np.zeros((time.size, n), dtype=float)
    luenberger_states = np.zeros_like(true_states)
    kalman_states = np.zeros_like(true_states)
    applied_input = np.zeros(time.size, dtype=float)
    true_output = np.zeros(time.size, dtype=float)
    measured_output = np.zeros(time.size, dtype=float)
    luenberger_innovation = np.zeros(time.size, dtype=float)
    kalman_innovation = np.zeros(time.size, dtype=float)

    process_covariance = np.eye(n) * request.process_noise_std**2
    for index, current_time in enumerate(time):
        u = np.zeros(m, dtype=float)
        if current_time >= request.step_time:
            u[input_index] = request.input_amplitude
        noiseless_y = float((c @ true_state + d @ u).item())
        measurement_noise = float(rng.normal(scale=request.measurement_noise_std))
        measured_y = noiseless_y + measurement_noise
        innovation_l = measured_y - float((c @ luenberger_state + d @ u).item())
        innovation_k = measured_y - float((c @ kalman_state + d @ u).item())

        true_states[index] = true_state
        luenberger_states[index] = luenberger_state
        kalman_states[index] = kalman_state
        applied_input[index] = u[input_index]
        true_output[index] = noiseless_y
        measured_output[index] = measured_y
        luenberger_innovation[index] = innovation_l
        kalman_innovation[index] = innovation_k

        if index == interval_count:
            continue
        process_noise = (
            rng.multivariate_normal(np.zeros(n), process_covariance)
            if request.process_noise_std > 0.0
            else np.zeros(n, dtype=float)
        )
        true_state = ad @ true_state + bd @ u + process_noise
        luenberger_state = (
            ad @ luenberger_state + bd @ u + luenberger_gain[:, 0] * innovation_l
        )
        kalman_state = ad @ kalman_state + bd @ u + kalman_gain[:, 0] * innovation_k

    luenberger_errors = np.linalg.norm(true_states - luenberger_states, axis=1)
    kalman_errors = np.linalg.norm(true_states - kalman_states, axis=1)
    luenberger_radius = float(np.max(np.abs(luenberger_poles)))
    kalman_radius = float(np.max(np.abs(kalman_poles)))
    warnings: list[str] = []
    if request.measurement_noise_std == 0.0 and request.process_noise_std == 0.0:
        warnings.append(
            "Для фильтра Калмана использованы малые проектные ковариации, потому что оба заданных шума равны нулю."
        )

    return ObserverExperimentResponse(
        success=True,
        model={
            "state_dimension": n,
            "input_dimension": m,
            "output_dimension": p,
            "input_block_id": input_id,
            "output_label": output_label,
            "state_labels": system["state_labels"],
            "observability_rank": rank,
            "fully_observable": True,
            "A": a.tolist(),
            "B": b.tolist(),
            "C_measurement": c.tolist(),
            "D_measurement": d.tolist(),
            "Ad": ad.tolist(),
            "Bd": bd.tolist(),
        },
        settings={
            "sample_time": request.dt,
            "horizon": request.horizon,
            "input_amplitude": request.input_amplitude,
            "step_time": request.step_time,
            "process_noise_std_per_sample": request.process_noise_std,
            "measurement_noise_std": request.measurement_noise_std,
            "seed": request.seed,
            "luenberger_desired_poles": desired_poles,
        },
        observers=[
            ObserverSummary(
                method="luenberger",
                name="Наблюдатель Люенбергера",
                gain=luenberger_gain.tolist(),
                error_dynamics_poles=_complex_rows(luenberger_poles),
                spectral_radius=luenberger_radius,
                asymptotically_stable=luenberger_radius < 1.0,
                design="Размещение полюсов матрицы Ad − LC в z-плоскости.",
            ),
            ObserverSummary(
                method="kalman",
                name="Стационарный фильтр Калмана",
                gain=kalman_gain.tolist(),
                error_dynamics_poles=_complex_rows(kalman_poles),
                spectral_radius=kalman_radius,
                asymptotically_stable=kalman_radius < 1.0,
                design="Дискретное уравнение Риккати для заданных Q и R.",
                covariance=covariance.tolist(),
            ),
        ],
        metrics=[
            _metrics(
                "luenberger",
                true_states,
                luenberger_states,
                luenberger_innovation,
                None,
            ),
            _metrics(
                "kalman",
                true_states,
                kalman_states,
                kalman_innovation,
                covariance,
            ),
        ],
        trace=ObserverTrace(
            time=time.tolist(),
            state_labels=list(system["state_labels"]),
            input=applied_input.tolist(),
            true_output=true_output.tolist(),
            measured_output=measured_output.tolist(),
            true_states=true_states.T.tolist(),
            luenberger_states=luenberger_states.T.tolist(),
            kalman_states=kalman_states.T.tolist(),
            luenberger_error_norm=luenberger_errors.tolist(),
            kalman_error_norm=kalman_errors.tolist(),
            luenberger_innovation=luenberger_innovation.tolist(),
            kalman_innovation=kalman_innovation.tolist(),
            kalman_three_sigma=(3.0 * np.sqrt(np.maximum(np.diag(covariance), 0.0))).tolist(),
        ),
        warnings=warnings,
    )
