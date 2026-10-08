from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import numpy as np
from scipy.signal import butter, freqs

from app.analysis.frequency import analyze_frequency_response
from app.analysis.pid_tuning import _settling_time as pid_settling_time
from app.analysis.quality import compute_quality_metrics
from app.analysis.safe_learning import run_safe_learning
from app.analysis.observer import _rank_observability, run_observer_experiment
from app.analysis.output_feedback import run_output_feedback_experiment
from app.analysis.system import assemble_state_space
from app.core.block_specs import butterworth_coefficients, get_pid_coefficients
from app.examples.hierarchical_scenarios import SCENARIOS as HIERARCHICAL_SCENARIOS
from app.experiments.scenarios import build_scenarios
from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.models.learning import SafeLearningRequest
from app.models.observer import ObserverExperimentRequest
from app.models.output_feedback import OutputFeedbackRequest
from app.simulation.compiler import _tf2ss
from app.simulation.hierarchy import flatten_diagram
from app.simulation.service import simulate_request


def _assert_close(actual: Any, expected: Any, *, rtol: float = 1e-8, atol: float = 1e-10) -> None:
    if not np.allclose(actual, expected, rtol=rtol, atol=atol):
        raise AssertionError(f"actual={actual!r}, expected={expected!r}")


def _state_space_response(
    numerator: list[float],
    denominator: list[float],
    omega: np.ndarray,
) -> np.ndarray:
    a, b, c, d = _tf2ss(numerator, denominator)
    identity = np.eye(a.shape[0], dtype=complex)
    values = []
    for frequency in omega:
        dynamic = c @ np.linalg.solve(1j * frequency * identity - a, b)
        values.append(complex(dynamic + d))
    return np.asarray(values)


def main() -> None:
    checks: list[dict[str, Any]] = []

    def run(name: str, case_count: int, callback: Callable[[], dict[str, Any] | None]) -> None:
        details = callback() or {}
        checks.append({"name": name, "status": "passed", "cases": case_count, **details})

    def transfer_realizations() -> dict[str, Any]:
        cases = [
            ([1.0], [1.0, 1.0]),
            ([2.0, 3.0], [1.0, 4.0, 5.0]),
            ([1.0, 0.5, 2.0], [2.0, 3.0, 4.0]),
            ([0.0, 4.0], [3.0, 2.0]),
            ([1.0, -1.0], [1.0, 0.2, 2.0]),
        ]
        omega = np.logspace(-3, 3, 180)
        worst = 0.0
        for numerator, denominator in cases:
            expected = freqs(numerator, denominator, worN=omega)[1]
            actual = _state_space_response(numerator, denominator, omega)
            error = float(np.max(np.abs(actual - expected)))
            worst = max(worst, error)
            _assert_close(actual, expected, rtol=2e-10, atol=2e-10)
        return {"max_abs_error": worst}

    run("Передаточная функция -> пространство состояний", 5, transfer_realizations)

    def butterworth_models() -> dict[str, Any]:
        worst = 0.0
        cutoff = 7.5
        for order in range(1, 11):
            numerator, denominator = butterworth_coefficients(order, cutoff)
            expected_num, expected_den = butter(order, cutoff, analog=True, output="ba")
            numerator_array = np.asarray(numerator) / denominator[0]
            denominator_array = np.asarray(denominator) / denominator[0]
            expected_num = np.asarray(expected_num) / expected_den[0]
            expected_den = np.asarray(expected_den) / expected_den[0]
            error = max(
                float(np.max(np.abs(numerator_array - expected_num))),
                float(np.max(np.abs(denominator_array - expected_den))),
            )
            worst = max(worst, error)
            _assert_close(numerator_array, expected_num, rtol=2e-9, atol=2e-9)
            _assert_close(denominator_array, expected_den, rtol=2e-9, atol=2e-9)
        return {"orders": "1..10", "max_coefficient_error": worst}

    run("Аналоговый ФНЧ Баттерворта", 10, butterworth_models)

    def reference_responses() -> dict[str, Any]:
        worst = 0.0
        for scenario in build_scenarios():
            for solver in ("rk4", "solve_ivp"):
                result = simulate_request(
                    SimulationRequest(
                        diagram=scenario.load_diagram(),
                        t_end=scenario.t_end,
                        dt=scenario.default_dt,
                        solver=solver,
                    )
                )
                time = np.asarray(result.time)
                actual = np.asarray(result.outputs[scenario.scope_label])
                expected = scenario.reference(time)
                error = float(np.max(np.abs(actual - expected)))
                worst = max(worst, error)
                if error > 1e-4:
                    raise AssertionError(
                        f"{scenario.slug}/{solver}: max error {error:g} exceeds 1e-4"
                    )
        return {"scenarios": 4, "solvers": 2, "max_abs_error": worst}

    run("Переходные процессы против аналитических эталонов", 8, reference_responses)

    def hierarchy_equivalence() -> dict[str, Any]:
        for name, builder in HIERARCHICAL_SCENARIOS.items():
            diagram = Diagram.model_validate(builder())
            hierarchical = assemble_state_space(diagram)
            flat = assemble_state_space(flatten_diagram(diagram))
            for matrix in "ABCD":
                _assert_close(
                    hierarchical["matrices"][matrix],
                    flat["matrices"][matrix],
                )
            if not hierarchical["verification"]["passed"]:
                raise AssertionError(f"{name}: matrix/graph verification failed")
        return {"scenarios": list(HIERARCHICAL_SCENARIOS)}

    run("Иерархическая и плоская LTI-модели", 4, hierarchy_equivalence)

    def frequency_crossovers() -> dict[str, Any]:
        base = {
            "state_dimension": 1,
            "input_dimension": 1,
            "output_dimension": 1,
            "poles": [{"real": -1.0, "imag": 0.0}],
            "input_blocks": ["u"],
            "output_labels": ["y"],
        }
        gain_two = {
            **base,
            "matrices": {"A": [[-1.0]], "B": [[2.0]], "C": [[1.0]], "D": [[0.0]]},
        }
        first = analyze_frequency_response(gain_two, points=600)
        _assert_close(first["gain_crossovers_rad_s"], [np.sqrt(3.0)], rtol=3e-4)
        _assert_close(first["critical_phase_margin_deg"], 120.0, atol=0.05)

        high_gain = {
            **base,
            "matrices": {"A": [[-1.0]], "B": [[10_000.0]], "C": [[1.0]], "D": [[0.0]]},
        }
        second = analyze_frequency_response(high_gain, points=600)
        _assert_close(second["gain_crossovers_rad_s"], [np.sqrt(10_000.0**2 - 1.0)], rtol=3e-4)
        return {"high_gain_crossover_rad_s": second["gain_crossovers_rad_s"][0]}

    run("Частотные пересечения и адаптивный диапазон", 2, frequency_crossovers)

    def quality_metrics() -> dict[str, Any]:
        metrics = compute_quality_metrics(
            [5.0, 6.0, 7.0, 8.0],
            {"y": [0.0, 1.2, 1.0, 1.0]},
            references={"y": 1.0},
        )["y"]
        _assert_close(metrics["overshoot_percent"], 20.0)
        _assert_close(metrics["settling_time"], 2.0)
        unsettled = compute_quality_metrics(
            [0.0, 1.0, 2.0],
            {"y": [0.0, 0.4, 0.5]},
            references={"y": 1.0},
        )["y"]
        if unsettled["settling_time"] is not None:
            raise AssertionError("unfinished response was incorrectly marked as settled")
        return {"target_source": metrics["target_source"]}

    run("Показатели качества переходного процесса", 2, quality_metrics)

    def delayed_step() -> dict[str, Any]:
        scenario = next(item for item in build_scenarios() if item.slug == "first_order_lag")
        diagram = scenario.load_diagram().model_copy(deep=True)
        step = next(block for block in diagram.blocks if block.type == "StepInput")
        lag = next(block for block in diagram.blocks if block.type == "FirstOrderLag")
        step.parameters["t0"] = 0.505
        lag.parameters["T"] = 0.01
        lag.parameters["k"] = 1.0
        response = simulate_request(
            SimulationRequest(diagram=diagram, t_end=0.6, dt=0.01, solver="solve_ivp")
        )
        time = np.asarray(response.time)
        expected = np.where(time < 0.505, 0.0, 1.0 - np.exp(-(time - 0.505) / 0.01))
        error = float(np.max(np.abs(np.asarray(response.outputs["y"]) - expected)))
        if error > 1e-7:
            raise AssertionError(f"piecewise integration error {error:g}")
        return {"max_abs_error": error}

    run("Интегрирование разрыва StepInput", 1, delayed_step)

    def pid_conventions() -> dict[str, Any]:
        expected = [7.0, 23.0, 30.0]
        numerator, denominator = get_pid_coefficients(
            {"kp": 2.0, "ki": 3.0, "kd": 0.5, "filter_n": 10.0}
        )
        _assert_close(numerator, expected)
        _assert_close(denominator, [1.0, 10.0, 0.0])
        settling = pid_settling_time(
            np.asarray([0.0, 1.0, 2.0, 3.0, 4.0]),
            np.asarray([0.0, 0.0, 1.0, 0.1, 0.0]),
            1.0,
            2.0,
        )
        _assert_close(settling, 2.0)
        return {"derivative_filter": "Kd*N*s/(s+N)"}

    run("P/PI/PD/PID и отсчёт от момента задания", 2, pid_conventions)

    def sampled_data_learning() -> dict[str, Any]:
        scenario = next(item for item in build_scenarios() if item.slug == "first_order_lag")
        request = SafeLearningRequest(
            diagram=scenario.load_diagram(),
            horizon=0.4,
            dt=0.02,
            training_trajectories=2,
            validation_trajectories=4,
            input_limit=0.08,
            mpc_horizon_steps=8,
            on_policy_rounds=0,
            seed=11,
        )
        result = run_safe_learning(request)
        if result.safety.certificate_domain != "sampled_data":
            raise AssertionError("certificate domain is not sampled_data")
        if result.teacher.unconverged_queries != 0:
            raise AssertionError("MPC QP failed to reach tolerance")
        if result.safety.certified_backup_saturations != 0:
            raise AssertionError("backup saturated inside certified ellipsoid")
        expected_decisions = request.validation_trajectories * int(round(request.horizon / request.dt))
        if result.safety.decisions != expected_decisions:
            raise AssertionError("terminal state was counted as an applied control decision")
        for policy in result.policies:
            if not policy.asymptotically_stable or policy.pole_domain != "z":
                raise AssertionError(f"{policy.name}: invalid sampled-data local stability")
        for action in (
            result.trace.basis_action,
            result.trace.teacher_action,
            result.trace.learner_action,
            result.trace.supervised_action,
        ):
            if max(abs(value) for value in action) > 0.08 + 1e-12:
                raise AssertionError("input constraint was violated")
        return {
            "mpc_queries": result.teacher.solver_queries,
            "decisions": result.safety.decisions,
            "certificate": result.safety.certificate_kind,
        }

    run("Sampled-data MPC, LQR и Lyapunov-supervisor", 1, sampled_data_learning)

    def sampled_data_observers() -> dict[str, Any]:
        scenarios = [
            next(item for item in build_scenarios() if item.slug == "first_order_lag"),
            next(item for item in build_scenarios() if item.slug == "second_order_oscillator"),
        ]
        radii: dict[str, dict[str, float]] = {}
        for scenario in scenarios:
            request = ObserverExperimentRequest(
                diagram=scenario.load_diagram(),
                horizon=2.0,
                dt=0.02,
                process_noise_std=0.005,
                measurement_noise_std=0.03,
                seed=17,
            )
            first = run_observer_experiment(request)
            second = run_observer_experiment(request)
            if first.model["observability_rank"] != first.model["state_dimension"]:
                raise AssertionError(f"{scenario.slug}: observability rank mismatch")
            if first.trace.measured_output != second.trace.measured_output:
                raise AssertionError(f"{scenario.slug}: stochastic experiment is not reproducible")

            ad = np.asarray(first.model["Ad"], dtype=float)
            c = np.asarray(first.model["C_measurement"], dtype=float)
            radii[scenario.slug] = {}
            for observer in first.observers:
                gain = np.asarray(observer.gain, dtype=float)
                poles = np.linalg.eigvals(ad - gain @ c)
                radius = float(np.max(np.abs(poles)))
                _assert_close(radius, observer.spectral_radius, atol=1e-10)
                if radius >= 1.0 or not observer.asymptotically_stable:
                    raise AssertionError(f"{scenario.slug}/{observer.method}: unstable error dynamics")
                radii[scenario.slug][observer.method] = radius

            covariance = np.asarray(
                next(item.covariance for item in first.observers if item.method == "kalman"),
                dtype=float,
            )
            _assert_close(covariance, covariance.T, atol=1e-10)
            if float(np.min(np.linalg.eigvalsh(covariance))) < -1e-10:
                raise AssertionError(f"{scenario.slug}: Kalman covariance is not positive semidefinite")
        return {"spectral_radii": radii}

    run("ZOH-наблюдатель Люенбергера и фильтр Калмана", 2, sampled_data_observers)

    def sampled_observability_aliasing() -> dict[str, Any]:
        continuous_a = np.asarray([[0.0, -1.0], [1.0, 0.0]])
        sampled_ad = -np.eye(2)
        c = np.asarray([[1.0, 0.0]])
        continuous_rank = _rank_observability(continuous_a, c)
        sampled_rank = _rank_observability(sampled_ad, c)
        if continuous_rank != 2 or sampled_rank != 1:
            raise AssertionError("sampled mode aliasing was not detected")
        return {
            "continuous_rank": continuous_rank,
            "sampled_rank": sampled_rank,
            "sampling_example": "Ad = -I",
        }

    run("Потеря наблюдаемости при наложении дискретных мод", 1, sampled_observability_aliasing)

    def output_feedback_separation() -> dict[str, Any]:
        scenarios = [
            next(item for item in build_scenarios() if item.slug == "first_order_lag"),
            next(item for item in build_scenarios() if item.slug == "second_order_oscillator"),
        ]
        details: dict[str, Any] = {}
        for scenario in scenarios:
            request = OutputFeedbackRequest(
                diagram=scenario.load_diagram(),
                horizon=2.0,
                dt=0.02,
                process_noise_std=0.005,
                measurement_noise_std=0.03,
                control_limit=0.4,
                seed=23,
            )
            first = run_output_feedback_experiment(request)
            second = run_output_feedback_experiment(request)
            if first != second:
                raise AssertionError(f"{scenario.slug}: LQG experiment is not reproducible")
            if first.model["controllability_rank"] != first.model["state_dimension"]:
                raise AssertionError(f"{scenario.slug}: controllability rank mismatch")
            if first.model["observability_rank"] != first.model["state_dimension"]:
                raise AssertionError(f"{scenario.slug}: observability rank mismatch")
            for design in first.designs:
                if not design.asymptotically_stable or design.spectral_radius >= 1.0:
                    raise AssertionError(f"{scenario.slug}/{design.method}: unstable linear design")
                if design.method != "full_state_lqr" and not design.separation_matches:
                    raise AssertionError(f"{scenario.slug}/{design.method}: separation mismatch")
            for control in (
                first.trace.full_state_control,
                first.trace.luenberger_control,
                first.trace.kalman_control,
            ):
                if max(abs(value) for value in control) > request.control_limit + 1e-12:
                    raise AssertionError(f"{scenario.slug}: applied input violates saturation")
            details[scenario.slug] = {
                item.method: item.spectral_radius for item in first.designs
            }
        return {"closed_loop_spectral_radii": details}

    run("LQR/LQG, принцип разделения и насыщение", 2, output_feedback_separation)

    def output_feedback_reference_tracking() -> dict[str, Any]:
        scenarios = [
            (
                next(item for item in build_scenarios() if item.slug == "first_order_lag"),
                6.0,
                1e-6,
            ),
            (
                next(item for item in build_scenarios() if item.slug == "second_order_oscillator"),
                10.0,
                2e-4,
            ),
        ]
        reference = 2.0
        details: dict[str, Any] = {}
        for scenario, horizon, tolerance in scenarios:
            result = run_output_feedback_experiment(
                OutputFeedbackRequest(
                    diagram=scenario.load_diagram(),
                    horizon=horizon,
                    dt=0.02,
                    initial_state_scale=0.0,
                    process_noise_std=0.0,
                    measurement_noise_std=0.0,
                    control_limit=100.0,
                    reference=reference,
                )
            )
            errors = {
                item.method: abs(item.steady_state_error) for item in result.metrics
            }
            if max(errors.values()) >= tolerance:
                raise AssertionError(
                    f"{scenario.slug}: constant reference is not tracked: {errors}"
                )
            details[scenario.slug] = {
                "prefilter_gain": result.model["prefilter_gain"],
                "steady_state_errors": errors,
            }
        return {"tracking": details}

    run("Префильтр постоянного задания в LQR/LQG", 2, output_feedback_reference_tracking)

    print(
        json.dumps(
            {
                "passed": True,
                "check_groups": len(checks),
                "cases": sum(item["cases"] for item in checks),
                "checks": checks,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
